// Executes the actual portable Windows EXE, never a development web server.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const out=path.resolve('qa-evidence');fs.mkdirSync(out,{recursive:true});
const results=[],clients=[];let current='boot';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const safe=s=>s.replace(/[^a-zA-Z0-9_-]/g,'_');
async function snap(p,name){await p.screenshot({path:path.join(out,safe(name)+'.png')});fs.writeFileSync(path.join(out,safe(name)+'.json'),JSON.stringify(await state(p),null,2));}
const state=p=>p.evaluate(()=>window.xtankDiagnostics?.());
async function wait(p,fn,timeout=15000){await p.waitForFunction(fn,null,{timeout});}
async function step(name,p,fn){current=name;try{await fn();await snap(p,name);results.push({name,status:'PASS'});console.log('PASS',name);}catch(e){await snap(p,name+'-FAIL').catch(()=>{});results.push({name,status:'FAIL',error:e.stack});console.error('FAIL',name,e.message);}save();}
function save(){fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({platform:process.platform,exe:process.env.XTANK_EXE,sha:process.env.GITHUB_SHA,results},null,2));}
async function launch(i){
 const exe=path.resolve(process.env.XTANK_EXE||fs.readdirSync('release').filter(x=>x.endsWith('.exe'))[0]&&'release/'+fs.readdirSync('release').find(x=>x.endsWith('.exe')));
 const log=fs.openSync(path.join(out,'client-'+i+'.log'),'w');
 const proc=spawn(exe,[`--remote-debugging-port=${9222+i}`,`--user-data-dir=${path.join(out,'profile-'+i)}`,'--no-first-run','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows'],{stdio:['ignore',log,log]});
 clients.push({proc});let browser;
 for(let n=0;n<90;n++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+(9222+i));break;}catch{await delay(1000);}}
 if(!browser)throw Error('Portable EXE failed to expose a running Electron renderer');
 const context=browser.contexts()[0];await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 const p=context.pages()[0]||await context.waitForEvent('page');p.setDefaultTimeout(10000);
 const c=clients[clients.length-1];Object.assign(c,{browser,context,p});
 p.on('pageerror',e=>fs.appendFileSync(path.join(out,'renderer-errors.log'),e.stack+'\n'));
 p.on('console',m=>{if(m.type()==='error')fs.appendFileSync(path.join(out,'console-errors.log'),m.text()+'\n');});
 await wait(p,()=>typeof window.xtankDiagnostics==='function');return p;
}
async function home(p){await p.reload();await wait(p,()=>typeof window.xtankDiagnostics==='function');}
async function start(p,tank='X',mode='FFA',map='desk'){
 await home(p);await p.selectOption('#tankSelect',tank);await p.selectOption('#modeSelect',mode);await p.selectOption('#mapSelect',map);await p.click('#startButton');await wait(p,()=>window.xtankDiagnostics().match?.tick>.2);
}
async function key(p,k,ms){await p.keyboard.down(k);await delay(ms);await p.keyboard.up(k);}
(async()=>{try{
 assert.equal(process.platform,'win32','Windows GUI tests require native Windows');
 const p=await launch(0);
 await step('A-portable-exe-home-WebGL',p,async()=>{assert(await p.isVisible('#startMenu'));const s=await state(p);assert(s.render.triangles>100);});
 for(const tank of ['X','D','M','R','H','A','O','S'])for(const mode of ['FFA','TDM','FLAG_HOLD'])for(const map of ['desk','chess','circuit']){
  await step(`B-${tank}-${mode}-${map}`,p,async()=>{await start(p,tank,mode,map);const s=await state(p);assert.equal(s.match.tanks[0].kind,tank);assert.equal(s.match.mode,mode);assert.equal(s.match.mapId,map);assert(s.render.calls>0);assert(await p.isVisible('#hud'));});
 }
 await step('C-WASD-camera',p,async()=>{await start(p);for(const [k,axis,sign] of [['w','z',-1],['s','z',1],['a','x',-1],['d','x',1]]){const a=await state(p);await key(p,k,350);const b=await state(p);assert((b.match.tanks[0][axis]-a.match.tanks[0][axis])*sign>.2,k+' direction');} });
 await step('C-seven-weapons-mouse-fire',p,async()=>{await start(p);await p.mouse.move(700,350);const weapons=['hurricane','death_knight','vulcan','plasma','chemical','ion_missile','mine'];for(let i=0;i<7;i++){await p.keyboard.press(''+(i+1));await p.mouse.down();await delay(2800);await p.mouse.up();const s=await state(p);assert(s.events.some(e=>e.type==='fire'&&e.owner==='player'&&e.weapon===weapons[i]),weapons[i]);await snap(p,'weapon-'+weapons[i]);}});
 await step('C-items-and-skill',p,async()=>{await start(p);await p.keyboard.press('e');await p.keyboard.press('F1');await p.keyboard.press('F2');await delay(150);await p.keyboard.press('F4');await delay(150);await p.keyboard.press('F5');await delay(150);await p.keyboard.press('F6');await delay(300);const s=await state(p);for(const type of ['ability','repair','boost','radar','smoke','teamRepair'])assert(s.events.some(e=>e.type===type&&e.id==='player'),type);});
 await step('C-AI-damage-death-respawn-score-result',p,async()=>{await start(p);await p.mouse.move(650,300);await p.mouse.down();const first=await state(p);let sawDeath=false,sawRespawn=false;const deadline=Date.now()+390000;while(Date.now()<deadline){const s=await state(p);sawDeath ||= s.events.some(e=>e.type==='death');sawRespawn ||= s.events.some(e=>e.type==='respawn');if(s.match?.ended)break;await delay(2000);}await p.mouse.up();const s=await state(p);assert(s.events.some(e=>e.type==='fire'&&e.owner!=='player'),'AI fires');assert(s.events.some(e=>e.type==='hit'),'damage');assert(sawDeath,'death');assert(sawRespawn,'respawn');assert(s.match.ended,'natural match completion');assert(await p.isVisible('#resultMenu'));assert(s.match.tanks.some((t,i)=>i&&Math.hypot(t.x-first.match.tanks[i].x,t.z-first.match.tanks[i].z)>1),'AI movement');await snap(p,'natural-result');await p.click('#againButton');await wait(p,()=>window.xtankDiagnostics().match?.tick>.1);});
 await step('C-Escape-return-home',p,async()=>{await p.keyboard.press('Escape');await p.click('#pauseHomeButton',{timeout:3000});assert(await p.isVisible('#startMenu'));});
 const q=await launch(1);
 await step('D-LAN-create-join-start-sync-reconnect',p,async()=>{
 await home(p);await home(q);await p.click('#hostServerButton');await p.waitForFunction(()=>document.querySelector('#networkStatus').textContent.includes('已啟動'));
 await p.fill('#playerName','QA-A');await p.selectOption('#mapSelect','chess');await p.click('#makeRoomButton');await wait(p,()=>document.querySelector('#roomCode').value.length===6);const code=await p.inputValue('#roomCode');
 await q.fill('#playerName','QA-B');await q.fill('#roomCode','000000');await q.click('#joinRoomButton');await q.waitForFunction(()=>document.querySelector('#networkStatus').textContent.includes('ROOM_NOT_FOUND'));await snap(q,'wrong-room');
 await q.fill('#roomCode',code);await q.click('#joinRoomButton');await p.waitForFunction(()=>document.querySelector('#roomPeople').textContent.includes('QA-B'));await p.click('#startNetworkButton');await wait(q,()=>window.xtankDiagnostics().match?.tanks.length>1);
 for(const page of [p,q])assert.equal((await state(page)).match.mapId,'chess');
 const a=await state(p);await key(p,'s',700);await delay(400);const b=await state(p),c=await state(q);assert(b.match.tanks[0].z>a.match.tanks[0].z+.5);const remote=c.match.tanks.find(t=>t.id==='remote-host');assert(Math.abs(remote.z-b.match.tanks[0].z)<1);
 await p.mouse.move(650,300);await p.mouse.down();await delay(1600);await p.mouse.up();await delay(300);assert((await state(q)).events.some(e=>e.type==='fire'&&e.owner==='remote-host'));
 await q.context().setOffline(true);await delay(2000);await q.context().setOffline(false);await delay(5000);assert((await state(q)).match?.tick>0);await snap(q,'client-B-sync');
 });
 await step('D-natural-end-lobby-second-round',p,async()=>{await p.waitForSelector('#resultMenu:not([hidden])',{timeout:390000});await q.waitForSelector('#resultMenu:not([hidden])',{timeout:15000});await snap(q,'B-network-result');await p.click('#againButton');await p.waitForSelector('#startNetworkButton:not([hidden])');await p.click('#startNetworkButton');await wait(q,()=>!document.querySelector('#hud').hidden&&!document.querySelector('#resultMenu:not([hidden])'));});
 for(const name of ['C-F3-shield-consumption','C-wall-tank-collision','C-mine-trigger-splash','D-room-full','D-bidirectional-hit-hp-score'])results.push({name,status:'BLOCKED',reason:'Dedicated GUI scenario not yet executed; broad combat coverage does not prove this assertion.'});
 }catch(e){results.push({name:current,status:'BLOCKED',error:e.stack});console.error(e);}finally{
 for(const c of clients){try{await c.context?.tracing.stop({path:path.join(out,'trace-'+clients.indexOf(c)+'.zip')});}catch{}try{await c.browser?.close();}catch{}try{execFileSync('taskkill',['/pid',String(c.proc.pid),'/t','/f']);}catch{}}
 save();const md=['# Native Windows EXE GUI results','',...results.map(r=>`- **${r.status}** ${r.name}${r.error?' — '+r.error.split('\n')[0]:r.reason?' — '+r.reason:''}`)].join('\n');fs.writeFileSync(path.join(out,'REPORT.md'),md);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);process.exitCode=results.some(r=>r.status!=='PASS')?1:0;
 }} )();
