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
function record(phase,evidence){result.events.push({phase,evidence});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log('NATIVE_DUAL',phase,JSON.stringify(evidence));}
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
// Screenshots are supporting evidence, never a prerequisite for network resume.
async function screenshot(p,name){try{fs.writeFileSync(path.join(out,name+'.png'),await p.screenshot({timeout:5000,animations:'disabled'}));}catch(e){record('SCREENSHOT_FAILED',{name,error:e.message});}}
async function quick(p){return p.evaluate(()=>{
 const d=window.xtankDiagnostics?.();return {room:d?.networkRoomId,slot:d?.networkSlot,tick:d?.match?.tick??null,
 ended:d?.match?.ended??null,tanks:d?.match?.tanks?.map(t=>({id:t.id,x:t.x,z:t.z,alive:t.alive}))||[],
 status:document.querySelector('#networkStatus')?.textContent,frameMs:d?.frameMs};
});}
async function checkpoint(label,a,b){const [host,guest]=await Promise.all([quick(a),quick(b)]);record(label,{host,guest});return {host,guest};}
async function launch(i){
 const exe=resolveExecutable({releaseDir:path.resolve('release'),clientIndex:i});
 assert(fs.existsSync(exe),'missing EXE '+exe);
 const log=fs.openSync(path.join(out,'electron-'+i+'.log'),'w');
 const proc=spawn(exe,[
  '--remote-debugging-port='+String(9222+i),
  '--user-data-dir='+path.join(os.tmpdir(),'xtank-2native-'+processId+'-'+i),
  // Do not disable Chromium's native window-occlusion optimizations.
 ],{stdio:['ignore',log,log],env:{...process.env,XTANK_QA_DUAL_NATIVE:'1'}});
 const item={process:proc,exe};clients.push(item);
 item.browser=await until('real EXE CDP '+i,async()=>{try{return await chromium.connectOverCDP('http://127.0.0.1:'+(9222+i),{timeout:3000});}catch{return null;}},90000);
 const p=item.p=item.browser.contexts()[0].pages()[0];
 p.setDefaultTimeout(12000);
 // Keep both actual Electron windows/renderers, but reduce SwiftShader pixel load
 // on the headless-GPU Windows CI machine; never mock the network or game.
 await p.setViewportSize({width:640,height:420});
 p.on('websocket',ws=>{
  let snapshots=0;
  for(const [event,direction] of [['framesent','sent'],['framereceived','received']]){
   ws.on(event,frame=>{
    try{
     const msg=JSON.parse(frame.payload);
     if(msg.type==='SNAPSHOT'){if(++snapshots%100!==1)return;}
     else if(!['JOINED','START','RESUME','ERROR','LOBBY','MATCH_END','PING'].includes(msg.type))return;
     if(msg.type==='PING')return;
     const info={at:new Date().toISOString(),client:i,direction,type:msg.type,code:msg.code,
       roomId:msg.roomId,slotId:msg.slotId,tick:msg.state?.tick??msg.tick};
     fs.appendFileSync(path.join(out,'network-frames.jsonl'),JSON.stringify(info)+'\\n');
    }catch{}
   });
  }
 });
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
  const joined=await quick(b);
  assert.equal(joined.room,room);
  record('NATIVE_TO_NATIVE_ROOM_JOIN',{room,guest:joined.room,slot:joined.slot});
  await screenshot(b,'guest-joined');
  await nativeClick(a,'#startNetworkButton');
  // Old QA only checked that both games existed: it incorrectly marked
  // host tick=0, tanks=0 and guest tick=0.6 as a synchronized match.
  await until('two live native EXEs with advancing synchronized snapshots',async()=>{
   const [x,y]=await Promise.all([quick(a),quick(b)]);
   return x.room===room&&y.room===room&&x.slot&&y.slot&&x.slot!==y.slot&&
    x.tick>2&&y.tick>2&&!x.ended&&!y.ended&&
    x.tanks.length>1&&y.tanks.length>1&&
    x.tanks.some(t=>t.id===y.slot)&&Math.abs(x.tick-y.tick)<3;
  },45000);
  const {host:a0,guest:b0}=await checkpoint('SHARED_AUTHORITATIVE_MATCH',a,b);
  // Native keyboard input on second real EXE must be observable on first GUI.
  await b.bringToFront();
  await b.keyboard.down('s');await sleep(1700);await b.keyboard.up('s');
  const origin=a0.tanks.find(v=>v.id===b0.slot);
  assert(origin,'guest slot missing in authoritative host snapshot');
  await until('guest physical keyboard movement synchronized to host',async()=>{
   const [x,y]=await Promise.all([quick(a),quick(b)]);
   const t=x.tanks.find(v=>v.id===y.slot);
   return t&&x.tick>a0.tick+1&&y.tick>b0.tick+1&&
     Math.hypot(t.x-origin.x,t.z-origin.z)>0.2;
  },20000);
  const {host:a1,guest:b1}=await checkpoint('REAL_GUI_KEYBOARD_SYNC',a,b);
  // Interrupt actual network tunnel. Both sides must preserve player identity
  // and the guest client must resume its previous authoritative slot.
  const oldSlot=b1.slot,oldRoom=b1.room,oldTick=b1.tick;
  record('INTERRUPT_PROXY',{slot:oldSlot,room:oldRoom,tickBefore:oldTick,sockets:tunnels.size});
  for(const sock of [...tunnels])sock.destroy();
  await until('guest native EXE resumes its same slot with fresh snapshots',async()=>{
   const x=await quick(b);
   return x.slot===oldSlot&&x.room===oldRoom&&x.tick>oldTick+1.5&&
     !/INVALID_SESSION|連線中斷/.test(x.status||'');
  },25000);
  const {host,guest:after}=await checkpoint('NATIVE_TO_NATIVE_RESUME',a,b);
  assert.equal(after.slot,oldSlot);assert.equal(after.room,oldRoom);
  assert(after.tick>oldTick+1.5,'reconnected guest did not receive fresh authoritative ticks');
  assert(host.tanks.some(t=>t.id===oldSlot),'guest seat lost on authoritative host');
  result.status='PASS';
  record('PASS',{slot:oldSlot,room:oldRoom,tickBefore:oldTick,tickAfter:after.tick});
  await screenshot(a,'host-match');
  await screenshot(b,'guest-match');
 }catch(e){
  result.error=e.stack||String(e);console.error('NATIVE_DUAL_FAIL',result.error);
  for(let i=0;i<clients.length;i++){const p=clients[i].p;if(p){try{fs.writeFileSync(path.join(out,'failure-'+i+'.json'),JSON.stringify(await diag(p),null,2));await screenshot(p,'failure-'+i);}catch{}}}
  process.exitCode=1;
 }finally{
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));
  for(const socket of tunnels)try{socket.destroy();}catch{}
  try{proxy?.close();}catch{}
  // Kill native renderer trees first: CDP browser.close can otherwise hang
  // indefinitely when two software-GPU windows are saturated.
  for(const client of clients){try{if(client.process?.pid)execFileSync('taskkill',['/pid',String(client.process.pid),'/t','/f'],{timeout:12000});}catch{}}
  for(const client of clients){try{await Promise.race([client.browser?.close(),sleep(2500)]);}catch{}}
 }
})();
