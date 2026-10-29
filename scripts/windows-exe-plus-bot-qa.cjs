// Integration acceptance: actual Windows EXE (host UI) + a genuine WebSocket bot.
// Does not require a second GPU-rendered Electron window and does not mock the server.
'use strict';
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const {WebSocket}=require('ws');
const {resolveExecutable}=require('./qa-executable.cjs');
const out=path.resolve(process.env.XTANK_QA_OUT||'qa-evidence/native-bot');
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const trace={name:'one-native-exe-plus-actual-websocket-client',status:'FAIL',events:[]};
const record=(step,value)=>{trace.events.push({step,value});console.log('QA',step,JSON.stringify(value));};
let proc,browser,page,bot;
async function clickReal(selector){
 await page.bringToFront();
 const loc=page.locator(selector);
 await page.evaluate(sel=>{
  const e=document.querySelector(sel);
  if(!e)throw Error('Missing control '+sel);
  e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
 },selector);
 const r=await loc.boundingBox();
 assert(r&&r.width>0&&r.height>0,'Control has no hit area: '+selector);
 await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
}
async function wait(fn,timeout=30000){
 const end=Date.now()+timeout;
 while(Date.now()<end){if(await fn())return;await sleep(125);}
 throw Error('Timed out waiting for acceptance state');
}
function wsClient(url){
 const ws=new WebSocket(url);
 ws.queue=[];
 ws.on('message',raw=>{try{ws.queue.push(JSON.parse(String(raw)))}catch{}});
 return new Promise((resolve,reject)=>{
  ws.once('open',()=>resolve(ws));
  ws.once('error',reject);
 });
}
async function got(ws,type,timeout=13000){
 let found=null;
 await wait(async()=>{
  const i=ws.queue.findIndex(x=>x.type===type);
  if(i>=0){found=ws.queue.splice(i,1)[0];return true;}
  return false;
 },timeout);
 return found;
}
(async()=>{
 try{
  assert.equal(process.platform,'win32');
  const exe=resolveExecutable({releaseDir:path.resolve('release'),clientIndex:0});
  const stdout=fs.openSync(path.join(out,'native-process.log'),'w');
  proc=spawn(exe,[
   '--remote-debugging-port=9222',
   '--user-data-dir='+path.join(os.tmpdir(),'xtank-native-bot-'+process.pid),
   '--disable-features=CalculateNativeWinOcclusion',
   '--disable-background-timer-throttling'
  ],{stdio:['ignore',stdout,stdout]});
  for(let i=0;i<80;i++){
   try{browser=await chromium.connectOverCDP('http://127.0.0.1:9222');break;}catch{await sleep(750);}
  }
  assert(browser,'Native Windows EXE did not open Chrome DevTools');
  page=browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(15000);
  await wait(()=>page.evaluate(()=>window.xtankDiagnostics?.().render?.frame>1),45000);
  await page.bringToFront();
  // Close the actual account overlay with the real Escape input if needed.
  if(await page.evaluate(()=>!document.querySelector('#xtankAccountOverlay')?.hidden)){
   await page.keyboard.press('Escape');
   await wait(()=>page.evaluate(()=>document.querySelector('#xtankAccountOverlay')?.hidden),15000);
  }
  record('EXE_RENDER',await page.evaluate(()=>window.xtankDiagnostics().gpuRenderer));
  await clickReal('#hostServerButton');
  await wait(()=>page.evaluate(()=>document.querySelector('#networkStatus')?.textContent?.includes('已啟動')),30000);
  record('SERVER_RUNNING','127.0.0.1:8787');
  await clickReal('#makeRoomButton');
  await wait(()=>page.evaluate(()=>document.querySelector('#roomCode')?.value?.length===6));
  const room=await page.locator('#roomCode').inputValue();
  record('REAL_EXE_ROOM_CREATED',room);
  bot=await wsClient('ws://127.0.0.1:8787');
  bot.send(JSON.stringify({type:'JOIN',name:'QA-WebSocket-Bot',tank:'D',roomId:room}));
  const joined=await got(bot,'JOINED');
  assert.equal(joined.roomId,room);
  await got(bot,'LOBBY');
  record('BOT_JOINED',joined.playerId);
  await wait(()=>page.evaluate(()=>document.querySelector('#roomPeople')?.textContent?.includes('QA-WebSocket-Bot')));
  await clickReal('#startNetworkButton');
  const started=await got(bot,'START',30000);
  const initial=await got(bot,'SNAPSHOT',12000);
  assert(initial.tanks.length>=2,'Authoritative game must have both actual players');
  assert.equal(initial.mapId,'desk');
  await wait(()=>page.evaluate(()=>window.xtankDiagnostics().match?.tanks?.length>1),25000);
  const state=await page.evaluate(()=>window.xtankDiagnostics());
  assert.equal(state.networkRoomId,room);
  record('NATIVE_UI_AND_SERVER_SYNC',{botSlot:started.slotId,roundId:started.roundId,tanks:initial.tanks.length,uiTankCount:state.match.tanks.length});
  const before=initial.tanks.find(t=>t.id===started.slotId);
  assert(before,'Bot must exist in authoritative snapshot');
  for(let seq=1;seq<=12;seq++){
   bot.send(JSON.stringify({type:'INPUT',seq,dx:0,dz:1,aimYaw:0,weapon:'vulcan',fire:true}));
   await sleep(90);
  }
  await wait(async()=>bot.queue.some(m=>m.type==='SNAPSHOT'&&m.tick>initial.tick+0.6),15000);
  const snapshots=bot.queue.filter(m=>m.type==='SNAPSHOT');
  const after=snapshots.at(-1)?.tanks.find(t=>t.id===started.slotId);
  assert(after,'Bot must remain in authoritative state');
  assert(after.z>before.z+0.1,'Server did not process actual bot movement');
  record('SERVER_AUTHORITY_MOVEMENT',{zBefore:before.z,zAfter:after.z});
  // A real disconnected socket must resume the same reserved player slot.
  const oldToken=joined.token,botId=joined.playerId;
  await new Promise(resolve=>{bot.once('close',resolve);bot.close();});
  bot=await wsClient('ws://127.0.0.1:8787');
  bot.send(JSON.stringify({type:'RESUME',roomId:room,playerId:botId,token:oldToken}));
  const resumed=await got(bot,'JOINED',12000);
  assert.equal(resumed.playerId,botId);
  assert.notEqual(resumed.token,oldToken);
  const resumedStart=await got(bot,'START',12000);
  assert.equal(resumedStart.slotId,started.slotId);
  record('RESUME_SAME_SLOT',{slot:resumedStart.slotId});
  const screen=await page.screenshot({timeout:20000});
  fs.writeFileSync(path.join(out,'native-lan-actual.png'),screen);
  trace.status='PASS';
 }catch(e){trace.error=e.stack||String(e);console.error('NATIVE_BOT_FAIL',trace.error);process.exitCode=1;
  try{const ss=await page?.screenshot({timeout:5000});if(ss)fs.writeFileSync(path.join(out,'native-fail.png'),ss);}catch{}
 }finally{
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(trace,null,2));
  try{bot?.terminate();}catch{}
  try{await browser?.close();}catch{}
  try{if(proc?.pid)execFileSync('taskkill',['/pid',String(proc.pid),'/t','/f']);}catch{}
 }
})();
