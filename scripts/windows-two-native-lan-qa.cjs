// Real TWO independent Windows Electron executables, not mock windows or HTML harness.
// Start host before second renderer to minimize 2x software-GPU contention.
// GUI buttons use CDP physical mouse; form fields are test fixtures with input/change.
'use strict';
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {resolveExecutable}=require('./qa-executable.cjs');
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const out=path.resolve(process.env.XTANK_QA_OUT||'qa-evidence/dual-native');
fs.mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const result={name:'two independent native Windows EXEs LAN integration',status:'FAIL',events:[]};
const clients=[],tunnels=new Set();let proxy;
function record(phase,evidence){result.events.push({phase,evidence});console.log('NATIVE_DUAL',phase,JSON.stringify(evidence));}
async function until(label,fn,ms=30000){
 const end=Date.now()+ms;let last;
 while(Date.now()<end){try{let v=await fn();if(v)return v;}catch(e){last=e.message;}await sleep(170);}
 throw Error('Timed out: '+label+(last?' ('+last+')':''));
}
async function diag(p){return p.evaluate(()=>({
  readyState:document.readyState,
  accountOverlay:!!document.querySelector('#xtankAccountOverlay')&&!document.querySelector('#xtankAccountOverlay').hidden,
  networkStatus:document.querySelector('#networkStatus')?.textContent,
  roomCode:document.querySelector('#roomCode')?.value,
  roomPeople:document.querySelector('#roomPeople')?.textContent,
  game:typeof window.xtankDiagnostics==='function'?window.xtankDiagnostics():null,
}));}
async function screenshot(p,name){try{fs.writeFileSync(path.join(out,name+'.png'),await p.screenshot({timeout:20000}));}catch(e){record('SCREENSHOT_FAILED',{name,error:e.message});}}
async function launch(i){
 const exe=resolveExecutable({releaseDir:path.resolve('release'),clientIndex:i});
 assert(fs.existsSync(exe),'missing EXE '+exe);
 const log=fs.openSync(path.join(out,'electron-'+i+'.log'),'w');
 const process=spawn(exe,[
  '--remote-debugging-port='+String(9222+i),
  '--user-data-dir='+path.join(os.tmpdir(),'xtank-2native-'+processId+'-'+i),
  '--disable-features=CalculateNativeWinOcclusion',
  // Do not force both windows to run background WebGL at full rate.
 ],{stdio:['ignore',log,log]});
 const item={process,exe};clients.push(item);
 item.browser=await until('real EXE CDP '+i,async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:'+(9222+i),{timeout:3000});}catch{return null;}},90000);
 const p=item.p=item.browser.contexts()[0].pages()[0];
 p.setDefaultTimeout(16000);
 p.on('pageerror',e=>fs.appendFileSync(path.join(out,'renderer-errors.log'),i+' '+e.stack+'\n'));
 await until('real WebGL frames client '+i,()=>p.evaluate(()=>window.xtankDiagnostics?.().render?.frame>1),60000);
 // The actual app supports this persisted native low-graphics preset.
 await p.evaluate(()=>localStorage.setItem('xtankGraphicsQualityV1','low'));
 await p.reload({waitUntil:'domcontentloaded'});
 await until('low graphics active '+i,()=>p.evaluate(()=>window.xtankDiagnostics?.().render?.frame>1),50000);
 await p.bringToFront();
 if(await p.evaluate(()=>{const e=document.querySelector('#xtankAccountOverlay');return !!e&&!e.hidden;})){
  await p.keyboard.press('Escape');
  await until('dismiss account overlay '+i,()=>p.evaluate(()=>document.querySelector('#xtankAccountOverlay')?.hidden),20000);
 }
 record('NATIVE_EXE_READY',{client:i,exe:path.basename(exe),renderer:(await p.evaluate(()=>window.xtankDiagnostics())).gpuRenderer});
 return p;
}
const processId=process.pid;
async function fixture(p,sel,value){
 const actual=await p.evaluate(({sel,value})=>{
  const input=document.querySelector(sel);if(!input||!('value'in input))throw Error('Missing form control '+sel);
  if(input instanceof HTMLSelectElement&&!Array.from(input.options).some(o=>o.value===value))throw Error('Missing option '+value);
  input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return input.value;
 },{sel,value});
 assert.equal(actual,value);
}
async function nativeClick(p,sel){
 await p.bringToFront();
 const rect=await p.evaluate(sel=>{
  const e=document.querySelector(sel);if(!e||e.hidden)throw Error('Missing or hidden actual GUI control '+sel);
  e.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
  const r=e.getBoundingClientRect();
  return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,viewport:[innerWidth,innerHeight],
   obscured:!e.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))&&e!==document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)};
 },sel);
 assert(rect.w>0&&rect.h>0&&rect.x>=0&&rect.x<rect.viewport[0]&&rect.y>=0&&rect.y<rect.viewport[1]&&!rect.obscured,
   'not physically clickable '+sel+' '+JSON.stringify(rect));
 await p.mouse.click(rect.x,rect.y);
}
(async()=>{
 try{
  assert.equal(process.platform,'win32');
  const a=await launch(0);
  await nativeClick(a,'#hostServerButton');
  await until('native host started',()=>a.evaluate(()=>document.querySelector('#networkStatus').textContent.includes('已啟動')));
  await fixture(a,'#playerName','QA-A');
  await fixture(a,'#mapSelect','chess');
  await nativeClick(a,'#makeRoomButton');
  const room=await until('native EXE room code',()=>a.evaluate(()=>{const v=document.querySelector('#roomCode').value;return v.length===6?v:null;}));
  record('HOST_NATIVE_ROOM',{room});
  await screenshot(a,'host-room');
  // Second executable has its own program binary, process and user-data directory.
  const b=await launch(1);
  proxy=net.createServer(client=>{
   const upstream=net.connect(8787,'127.0.0.1');
   tunnels.add(client);tunnels.add(upstream);
   client.pipe(upstream);upstream.pipe(client);
   for(const sock of [client,upstream])sock.on('error',()=>{}).on('close',()=>{tunnels.delete(sock);client.destroy();upstream.destroy();});
  });
  await new Promise((resolve,reject)=>proxy.once('error',reject).listen(8788,'127.0.0.1',resolve));
  await fixture(b,'#serverAddress','ws://127.0.0.1:8788');
  await fixture(b,'#roomCode',room);
  await fixture(b,'#playerName','QA-B');
  await nativeClick(b,'#joinRoomButton');
  await until('both actual native EXEs in same room',()=>a.evaluate(()=>document.querySelector('#roomPeople')?.textContent?.includes('QA-B')),45000);
  const joined=await diag(b);
  assert.equal(joined.game.networkRoomId,room);
  record('NATIVE_TO_NATIVE_ROOM_JOIN',{room,guest:joined.game.networkRoomId,slot:joined.game.networkSlot});
  await screenshot(b,'guest-joined');
  await nativeClick(a,'#startNetworkButton');
  await until('two native EXEs in same live match',async()=>{
   const x=await a.evaluate(()=>window.xtankDiagnostics?.());
   const y=await b.evaluate(()=>window.xtankDiagnostics?.());
   return x?.match?.tanks?.length>1&&y?.match?.tanks?.length>1&&x.networkRoomId===room&&y.networkRoomId===room&&x.match.mapId==='chess'&&y.match.mapId==='chess';
  },70000);
  const a0=await a.evaluate(()=>window.xtankDiagnostics()),b0=await b.evaluate(()=>window.xtankDiagnostics());
  record('SHARED_AUTHORITATIVE_MATCH',{room,aTick:a0.match.tick,bTick:b0.match.tick,tanks:a0.match.tanks.length,aSlot:a0.networkSlot,bSlot:b0.networkSlot});
  // Native keyboard input on second real EXE must be observable on first GUI.
  await b.bringToFront();
  await b.keyboard.down('s');await sleep(1700);await b.keyboard.up('s');
  await until('guest movement synchronized back to host',async()=>{
   const x=await a.evaluate(()=>window.xtankDiagnostics?.());
   const y=await b.evaluate(()=>window.xtankDiagnostics?.());
   const t=x?.match?.tanks?.find(v=>v.id===y?.networkSlot);
   // Local snapshots alias the player's authoritative ID to `player`.
   const origin=b0.match.tanks.find(v=>v.id==='player');
   return t&&origin&&Math.abs(t.z-origin.z)>0.2;
  },25000);
  const a1=await a.evaluate(()=>window.xtankDiagnostics()),b1=await b.evaluate(()=>window.xtankDiagnostics());
  record('REAL_GUI_KEYBOARD_SYNC',{secondPlayerSlot:b1.networkSlot,serverTick:a1.match.tick});
  await screenshot(a,'host-match');
  await screenshot(b,'guest-match');
  // Interrupt actual network tunnel. Both sides must preserve player identity
  // and the guest client must resume its previous authoritative slot.
  const oldSlot=b1.networkSlot,oldRoom=b1.networkRoomId,oldTick=b1.match.tick;
  for(const sock of tunnels)sock.destroy();
  await until('guest native EXE resumes its same slot',async()=>{
   const x=await b.evaluate(()=>window.xtankDiagnostics?.());
   return x?.networkSlot===oldSlot&&x.networkRoomId===oldRoom&&x.match?.tick>oldTick+1.5;
  },30000);
  const after=await b.evaluate(()=>window.xtankDiagnostics());
  assert.equal(after.networkSlot,oldSlot);assert.equal(after.networkRoomId,oldRoom);
  record('NATIVE_TO_NATIVE_RESUME',{slot:oldSlot,room:oldRoom,tickBefore:oldTick,tickAfter:after.match.tick});
  result.status='PASS';
 }catch(e){
  result.error=e.stack||String(e);console.error('NATIVE_DUAL_FAIL',result.error);
  for(let i=0;i<clients.length;i++){const p=clients[i].p;if(p){try{fs.writeFileSync(path.join(out,'failure-'+i+'.json'),JSON.stringify(await diag(p),null,2));await screenshot(p,'failure-'+i);}catch{}}}
  process.exitCode=1;
 }finally{
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));
  for(const socket of tunnels)try{socket.destroy();}catch{}
  try{proxy?.close();}catch{}
  for(const client of clients){try{await client.browser?.close();}catch{}try{if(client.process?.pid)execFileSync('taskkill',['/pid',String(client.process.pid),'/t','/f'],{timeout:15000});}catch{}}
 }
})();
