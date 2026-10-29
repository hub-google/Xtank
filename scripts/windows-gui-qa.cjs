// Executes the actual portable Windows EXE, never a development web server.
const {chromium}=require('playwright');
const {needsNetworkClient}=require('./qa-scope.cjs');
const {resolveExecutable}=require('./qa-executable.cjs');
const fs=require('node:fs');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const net=require('node:net');
const {WebSocket}=require('ws');
let proxy=null;const tunnels=new Set();const fillers=[];
const assert=require('node:assert/strict');
const out=path.resolve(process.env.XTANK_QA_OUT||'qa-evidence');fs.mkdirSync(out,{recursive:true});
const filter=process.env.XTANK_QA_FILTER?new RegExp(process.env.XTANK_QA_FILTER):null;
const results=[],clients=[],metrics={};let current='boot',executablePath=null,exeSha256=null;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function bounded(p,ms){let timer;return Promise.race([p,new Promise((_,bad)=>{timer=setTimeout(()=>bad(Error('cleanup timeout')),ms);})]).finally(()=>clearTimeout(timer));}
const safe=s=>s.replace(/[^a-zA-Z0-9_-]/g,'_');
async function snap(p,name){
 const session=await p.context().newCDPSession(p);
 try{const result=await session.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});fs.writeFileSync(path.join(out,safe(name)+'.png'),Buffer.from(result.data,'base64'));}finally{await session.detach();}
 fs.writeFileSync(path.join(out,safe(name)+'.json'),JSON.stringify(await state(p),null,2));
}
const state=p=>p.evaluate(()=>window.xtankDiagnostics?.());
async function wait(p,fn,timeout=15000){await p.waitForFunction(fn,null,{timeout});}
async function step(name,p,fn){if(filter&&!filter.test(name))return;current=name;try{await fn();await snap(p,name);results.push({name,status:'PASS'});console.log('PASS',name);}catch(e){await snap(p,name+'-FAIL').catch(()=>{});results.push({name,status:'FAIL',error:e.stack});console.error('FAIL',name,e.message);}save();}
function save(){fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({mode:filter?'TARGETED':'FULL',filter:process.env.XTANK_QA_FILTER,platform:process.platform,exe:executablePath,exeSha256,os:require('node:os').version(),osRelease:require('node:os').release(),metrics,sha:process.env.GITHUB_SHA,results},null,2));}
async function launch(i){
 const exe=resolveExecutable({
  releaseDir:path.resolve('release'),clientIndex:i,
  portableOverride:process.env.XTANK_EXE,unpackedOverride:process.env.XTANK_SECONDARY_EXE
 });
 executablePath=exe;exeSha256=require('node:crypto').createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
 const log=fs.openSync(path.join(out,'client-'+i+'.log'),'w');
 const proc=spawn(exe,[`--remote-debugging-port=${9222+i}`,`--user-data-dir=${path.join(require('node:os').tmpdir(),'xtank-qa-profile-'+process.pid+'-'+i)}`,'--no-first-run','--disable-features=CalculateNativeWinOcclusion','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows'],{stdio:['ignore',log,log]});
 clients.push({proc});let browser;
 for(let n=0;n<90;n++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+(9222+i));break;}catch{await delay(1000);}}
 if(!browser){
  const status={client:i,exe,exists:fs.existsSync(exe),pid:proc.pid,exitCode:proc.exitCode,signalCode:proc.signalCode,failedCDP:'127.0.0.1:'+(9222+i)};
  fs.writeFileSync(path.join(out,'client-'+i+'-launch-failure.json'),JSON.stringify(status,null,2));
  throw Error('Independent native EXE client failed to expose CDP: '+JSON.stringify(status));
 }
 const context=browser.contexts()[0];await context.tracing.start({screenshots:true,snapshots:true,sources:true});
 const p=context.pages()[0]||await context.waitForEvent('page');p.setDefaultTimeout(30000);
 const c=clients[clients.length-1];Object.assign(c,{browser,context,p});
 p.on('pageerror',e=>fs.appendFileSync(path.join(out,'renderer-errors.log'),e.stack+'\n'));
 p.on('console',m=>{if(m.type()==='error')fs.appendFileSync(path.join(out,'console-errors.log'),m.text()+'\n');});
 // Two Electron windows can contend for the same software-rendered GPU.
 // Explicitly foreground each real native window before asserting WebGL frames.
 // A failed boot gets one genuine reload and a diagnostic snapshot, never a
 // fabricated PASS or a silent skip of the second client.
 let ready=false;
 for(let attempt=0;attempt<2&&!ready;attempt++){
  try{
   await p.bringToFront();
   await wait(p,()=>window.xtankDiagnostics?.().render?.frame>1,45000);
   ready=true;
  }catch(error){
   const diagnostic=await p.evaluate(()=>({
    url:location.href,readyState:document.readyState,
    diagnosticsType:typeof window.xtankDiagnostics,
    diagnostics:typeof window.xtankDiagnostics==='function'?window.xtankDiagnostics():null,
    visibleText:document.body?.innerText?.slice(0,800)
   })).catch(e=>({readError:e.message}));
   fs.writeFileSync(path.join(out,'client-'+i+'-boot-attempt-'+attempt+'.json'),
     JSON.stringify({error:error.message,diagnostic},null,2));
   await snap(p,'client-'+i+'-boot-attempt-'+attempt).catch(()=>{});
   if(attempt===0)await p.reload({waitUntil:'domcontentloaded'});
   else throw error;
  }
 }
 if(await p.locator('#xtankAccountOverlay').count()) {try{await ensureGuestEntry(p);}catch(error){await snap(p,'client-'+i+'-guest-entry-FAIL').catch(()=>{});throw error;}}try{execFileSync('powershell',['-NoProfile','-Command',`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $im=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($im); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $im.Save('${path.join(out,'desktop-'+i+'.png').replace(/'/g,"''")}'); $g.Dispose(); $im.Dispose();`]);}catch(e){fs.writeFileSync(path.join(out,'desktop-capture-error.txt'),e.message);}return p;
}
async function ensureGuestEntry(p){
 // The second real Electron window can change its account view while GPU
 // initialization is still underway. A Playwright visibility wait on a
 // transient close button must not block the entire LAN acceptance.
 const inspect=()=>p.evaluate(()=>{
  const overlay=document.querySelector('#xtankAccountOverlay');
  const visible=el=>{
   if(!el||el.hidden)return false;
   const style=getComputedStyle(el),r=el.getBoundingClientRect();
   return style.display!=='none'&&style.visibility!=='hidden'&&r.width>0&&r.height>0;
  };
  const controls={};
  for(const selector of ['#xtankAccountClose','#xtankGuestContinue']){
   const el=document.querySelector(selector);
   if(visible(el)){
    const r=el.getBoundingClientRect();
    controls[selector]={x:r.x+r.width/2,y:r.y+r.height/2};
   }
  }
  return {overlayVisible:visible(overlay),overlayExists:!!overlay,
   overlayHidden:overlay?.hidden,controls,
   documentReady:document.readyState};
 });
 let info=await inspect();
 if(!info.overlayVisible)return;
 await p.bringToFront();
 for(let attempt=0;attempt<3;attempt++){
  console.log('QA account overlay attempt',attempt,JSON.stringify(info));
  await p.keyboard.press('Escape');
  await delay(400);
  info=await inspect();
  if(!info.overlayVisible)return;
  for(const selector of ['#xtankAccountClose','#xtankGuestContinue']){
   const point=info.controls[selector];
   if(!point)continue;
   await p.mouse.click(point.x,point.y);
   await delay(400);
   info=await inspect();
   if(!info.overlayVisible)return;
  }
  await delay(600);
  info=await inspect();
  if(!info.overlayVisible)return;
 }
 throw Error('Real EXE guest overlay could not close: '+JSON.stringify(info));
}
// In two independent native Electron windows, the second window may be in
// front of the first. The LAN controls also sit below a scrollable home panel.
// Playwright's auto-scroll click can stall under Windows software rendering.
// Foreground the actual EXE, scroll only for visibility, then send a genuine
// mouse input event; never invoke the button's DOM click handler directly.
async function clickForeground(p,selector){
 await p.bringToFront();
 const target=p.locator(selector);
 await target.waitFor({state:'visible',timeout:15000});
 await p.evaluate(sel=>{
  const el=document.querySelector(sel);
  if(!el)throw Error('Missing native control: '+sel);
  el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
 },selector);
 const box=await target.boundingBox();
 const viewport=await p.evaluate(()=>({width:innerWidth,height:innerHeight}));
 assert(box&&box.width>0&&box.height>0,'Native control has no hit area: '+selector);
 const x=box.x+box.width/2,y=box.y+box.height/2;
 assert(x>=0&&y>=0&&x<viewport.width&&y<viewport.height,
  'Native control outside visible EXE viewport: '+selector+' '+JSON.stringify({box,viewport}));
 const hit=await p.evaluate(({sel,x,y})=>{
  const el=document.querySelector(sel),top=document.elementFromPoint(x,y);
  return !!el&&!!top&&(el===top||el.contains(top));
 },{sel:selector,x,y});
 assert(hit,'Native control is obscured: '+selector);
 await p.mouse.click(x,y);
}
async function home(p){
 await ensureGuestEntry(p);
 let s;
 try{s=await state(p)}catch(error){
  // Prior scenario remains FAIL. Recover only to test subsequent cases independently.
  console.error('Renderer diagnostics unavailable, attempting reload:',error.message);
  await p.reload({waitUntil:'domcontentloaded'});
  await wait(p,()=>typeof window.xtankDiagnostics==='function');
  await ensureGuestEntry(p);
  s=await state(p);
 }
 if(s?.match){
  if(await p.isVisible('#resultMenu'))await p.click('#returnButton');
  else if(await p.locator('#pauseHomeButton').count()){
   if(!await p.isVisible('#pauseBadge'))await p.keyboard.press('Escape');
   const homeButton=p.locator('#pauseHomeButton');
   await homeButton.waitFor({state:'visible',timeout:60000});
   const box=await homeButton.boundingBox();
   assert(box&&box.width>0&&box.height>0,'Pause return button has no visible hit area');
   // Send a genuine CDP mouse click on the already-visible button. Avoid
   // Playwright's automatic scrollIntoView action freezing under Windows
   // software GPU load, without bypassing the DOM click handler.
   await p.mouse.click(box.x+box.width/2,box.y+box.height/2);
  }else await p.reload();
 }
 // On Windows software rendering the app can finish the transition on a
 // late frame. Wait for the actual app state first, then verify visibility.
 await p.waitForFunction(()=>!document.querySelector('#startMenu')?.hidden,null,{timeout:60000});
 assert(await p.isVisible('#startMenu'),'Home overlay must be visible after returning from battle');
 await wait(p,()=>typeof window.xtankDiagnostics==='function');
 await ensureGuestEntry(p);
}
async function start(p,tank='X',mode='FFA',map='desk'){
 await home(p);await p.selectOption('#tankSelect',tank);await p.selectOption('#modeSelect',mode);await p.selectOption('#mapSelect',map);await p.click('#startButton');await wait(p,()=>window.xtankDiagnostics().match?.tick>.2);
}
async function key(p,k,ms){await p.keyboard.down(k);await delay(ms);await p.keyboard.up(k);}

async function testMockedNativeAccount(p){
 // UI integration through the real packaged EXE, with isolated HTTP mocks.
 // This is NOT a test of genuine Supabase authorization or database writes.
 const tanks=['X','D','M','R','H','A','O','S'];
 const wallet={balance:1000};
 const data={name:'QA-UI',volume:1,inventory:[{item_id:'repair',quantity:2}],loadouts:[],slots:[],points:1};
 const offer='00000000-0000-4000-8000-000000000333';
 const calls=[];
 const backend='https://fanffwnhkxpfhttylntw.supabase.co/**';
 await p.route(backend,async route=>{
  const request=route.request(),url=new URL(request.url());
  let input={};try{input=request.postDataJSON()||{}}catch{}
  const action=input.p_action||url.pathname;
  calls.push(action);
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type',
    'access-control-allow-methods':'POST,GET,OPTIONS'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  const ok=value=>route.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify(value)});
  if(url.pathname.startsWith('/auth/v1/token'))return ok({access_token:'mocked-gui-jwt',refresh_token:'mocked-gui-refresh',expires_in:3600});
  if(url.pathname.endsWith('/xtank_player_api')){
   if(action==='initialize')return ok({ok:true});
   if(action==='dashboard')return ok({
    profile:{player_id:'00000000-0000-4000-8000-000000000111',display_name:data.name},
    progress:{level:1,total_xp:0,unspent_points:data.points},stats:{matches_played:0,wins:0,kills:0},
    settings:{master_volume:data.volume,mouse_sensitivity:1},
    wallet:[{currency_code:'COIN',balance:wallet.balance}],
    tanks:tanks.map(tank_id=>({tank_id,level:1})),inventory:data.inventory,upgrades:[],
    loadouts:data.loadouts,slots:data.slots,history:[]});
   if(action==='catalog')return ok({
    tanks:tanks.map(tank_id=>({tank_id,base_hp:100,base_shield:40,speed:7})),
    weapons:['hurricane','vulcan','plasma','death_knight','mine'].map(weapon_id=>({weapon_id,display_name:weapon_id})),
    items:[{item_id:'repair',display_name:'維修工具'}],offers:[{offer_id:offer,offer_key:'test-mine',weapon_id:'mine',unit_price:100,quantity:1,currency_code:'COIN'}]});
   if(action==='buy'){assert.equal(input.p_payload.offer_id,offer);wallet.balance-=100;data.inventory.push({weapon_id:'mine',quantity:1});return ok({ok:true,order_id:'mock-order'});}
   if(action==='rename'){data.name=input.p_payload.name;return ok({ok:true});}
   if(action==='settings'){data.volume=input.p_payload.master_volume;return ok({ok:true});}
   if(action==='leaderboard')return ok({players:[]});
   if(action==='upgrade'){data.points--;return ok({ok:true});}
  }
  if(url.pathname.endsWith('/xtank_save_loadout')){
   data.loadouts=[{loadout_id:'mock-loadout',tank_id:input.p_tank_id,name:input.p_name,is_selected:true}];
   data.slots=(input.p_slots||[]).map(s=>({slot_type:s.slot_type,slot_number:s.slot_number,weapon_id:s.slot_type==='weapon'?s.ref:null,item_id:s.slot_type==='item'?s.ref:null,loadout_id:'mock-loadout'}));
   return ok('mock-loadout');
  }
  if(url.pathname.endsWith('/xtank_social_api'))return ok({friends:[]});
  return route.fulfill({status:404,body:'Unmocked API endpoint'});
 });
 try{
  await p.click('#xtankAccountOpen');
  await p.fill('#xtankAuthForm input[name=email]','mock-user@example.test');
  await p.fill('#xtankAuthForm input[name=password]','mock-password-only');
  await p.click('#xtankAuthForm button[value=login]');
  await p.waitForFunction(()=>document.querySelector('#xtankAccountContent')?.textContent?.includes('QA-UI'));
  assert((await p.locator('#xtankAccountContent').innerText()).includes('1000'),'starting balance');
  await p.click('[data-action="tab:garage"]');
  assert.equal(await p.locator('.xtank-card-grid article').count(),8);
  await p.click('[data-action="tab:shop"]');
  // The production shop now requires explicit human confirmation.
  // Accept the real native confirmation once, rather than bypassing
  // the purchase control or expecting payment without consent.
  let confirmationText='';
  // Handle the dialog concurrently with the click: Chromium blocks the
  // originating JS event until a real confirm dialog is accepted.
  const confirmation=p.waitForEvent('dialog',{timeout:10000}).then(async dialog=>{
   confirmationText=dialog.message();
   await dialog.accept();
  });
  await p.click('[data-action="buy:'+offer+'"]');
  await confirmation;
  assert.match(confirmationText,/確定購買/);
  await p.waitForFunction(()=>document.querySelector('#xtankAccountStatus')?.textContent?.includes('購買成功'));
  assert.equal(wallet.balance,900);
  await p.click('[data-action="tab:inventory"]');
  assert((await p.locator('.xtank-inventory').innerText()).includes('mine'));
  await p.fill('#xtankLoadoutForm input[name=name]','QA preset');
  await p.selectOption('#xtankLoadoutForm select[name=weapon_1]','mine');
  await p.selectOption('#xtankLoadoutForm select[name=item_1]','repair');
  await p.click('#xtankLoadoutForm button[type=submit]');
  await p.waitForFunction(()=>document.querySelector('#xtankAccountStatus')?.textContent?.includes('配裝已儲存'));
  assert.equal(data.slots[0].weapon_id,'mine');
  assert(data.slots.some(s=>s.slot_type==='item'&&s.slot_number===1&&s.item_id==='repair'),'equipped repair reaches loadout RPC');
  await p.click('[data-action="tab:settings"]');
  await p.fill('#xtankSettingsForm input[name=name]','QA-UI-NEW');
  await p.fill('#xtankSettingsForm input[name=master_volume]','0.7');
  await p.click('#xtankSettingsForm button[type=submit]');
  await p.waitForFunction(()=>document.querySelector('#xtankAccountStatus')?.textContent?.includes('設定已儲存'));
  assert.equal(data.name,'QA-UI-NEW');assert.equal(data.volume,0.7);
  await p.click('[data-action=logout]');
  assert(await p.isVisible('#xtankAuthForm'));
  await p.click('#xtankGuestContinue');
  assert(await p.isVisible('#startMenu'));
  for(const action of ['initialize','dashboard','catalog','buy','settings'])assert(calls.includes(action),'missing '+action);
  metrics.accountGui={type:'REAL_EXE_MOCK_BACKEND',actions:calls,remainingBalance:wallet.balance};
 }finally{
  await p.unroute(backend);
 }
}

(async()=>{try{
 assert.equal(process.platform,'win32','Windows GUI tests require native Windows');
 const p=await launch(0);
 await step('A-portable-exe-home-WebGL',p,async()=>{assert(await p.isVisible('#startMenu'));const s=await state(p);assert(s.render.triangles>100);});
 await step('A-account-frontend-mocked-backend',p,async()=>testMockedNativeAccount(p));
 await step('A-five-camera-modes',p,async()=>{
  await start(p,'X','FFA','desk');
  const initial=(await state(p)).camera;
  const positions=[];
  for(let i=1;i<=5;i++){
   await p.keyboard.press('c');
   await delay(400);
   assert((await p.locator('#cameraModeBadge').textContent()).includes(i+'/5'));
   positions.push((await state(p)).camera);
  }
  assert.equal(new Set(positions.map(x=>JSON.stringify(x))).size,5,'camera transforms must differ');
  assert.notDeepEqual(initial,positions[0]);
  await home(p);
 });
 await step('A-custom-keybindings-persist-reload-reset',p,async()=>{
  await home(p);
  await p.locator('.control-settings summary').click();
  const forward=p.locator('[aria-label="修改前進的快捷鍵"]');
  assert.equal(await forward.textContent(),'W');
  await forward.click();
  await p.keyboard.press('ArrowUp');
  assert.equal(await forward.textContent(),'↑');
  const saved=await p.evaluate(()=>localStorage.getItem('xtankKeyboardBindingsV1'));
  assert.equal(JSON.parse(saved).forward,'ArrowUp');
  await p.reload({waitUntil:'domcontentloaded'});
  await wait(p,()=>window.xtankDiagnostics?.().render.frame>1);
  await ensureGuestEntry(p);
  assert.equal(await p.locator('[aria-label="修改前進的快捷鍵"]').textContent(),'↑');
  await p.locator('.control-settings summary').click();
  await p.click('#resetControlBindings');
  assert.equal(await p.locator('[aria-label="修改前進的快捷鍵"]').textContent(),'W');
 });
 await step('A-display-settings-save-reload',p,async()=>{
  await home(p);
  await p.selectOption('#graphicsQuality','low');
  await p.check('#highContrastToggle');
  const chosen=await state(p);
  assert.equal(chosen.graphics.quality,'low');
  assert.equal(chosen.graphics.shadows,false);
  assert.equal(chosen.graphics.highContrast,true);
  assert.equal(await p.evaluate(()=>localStorage.getItem('xtankGraphicsQualityV1')),'low');
  await p.reload({waitUntil:'domcontentloaded'});
  await wait(p,()=>window.xtankDiagnostics?.().render.frame>1);
  await ensureGuestEntry(p);
  assert.equal(await p.inputValue('#graphicsQuality'),'low');
  assert(await p.isChecked('#highContrastToggle'));
  await p.selectOption('#graphicsQuality','high');
  await p.uncheck('#highContrastToggle');
  assert.equal((await state(p)).graphics.quality,'high');
 });
 for(const tank of ['X','D','M','R','H','A','O','S'])for(const mode of ['FFA','TDM','FLAG_HOLD'])for(const map of ['desk','chess','circuit']){
  await step(`B-${tank}-${mode}-${map}`,p,async()=>{
   await start(p,tank,mode,map);
   const s=await state(p);
   assert.equal(s.match.tanks[0].kind,tank);
   assert.equal(s.match.mode,mode);
   assert.equal(s.match.mapId,map);
   assert(s.render.calls>0);
   assert(await p.isVisible('#hud'));
   metrics.peakGeometries=Math.max(metrics.peakGeometries||0,s.render.geometries||0);
   // A 72-round matrix must not exhaust graphics memory as arenas are rebuilt.
   assert((s.render.geometries||0)<450,'Excess GPU geometry: '+s.render.geometries);
   if(mode==='FFA'&&map==='desk'){
    const deadline=Date.now()+15000;
    let triggered=false,lastTank=null,lastSample=null;
    // The native Windows software renderer sometimes processes a very short
    // press between rare render frames. Hold the real key long enough for a
    // simulation frame, and explicitly remove stale focus from form controls.
    await p.evaluate(()=>document.activeElement?.blur());
    while(Date.now()<deadline){
     const sample=await state(p);lastSample=sample;
     lastTank=sample.match?.tanks[0];
     if(sample.events.some(e=>e.type==='ability'&&e.id==='player')||lastTank?.abilityTime>0){triggered=true;break}
     if(lastTank?.alive&&lastTank.hp>14&&lastTank.abilityCooldown<=0){
      await p.keyboard.down('e');await delay(250);await p.keyboard.up('e');
     }
     await delay(200);
    }
    assert(triggered,'tank ability '+tank+' not triggered '+JSON.stringify({hp:lastTank?.hp,alive:lastTank?.alive,cooldown:lastTank?.abilityCooldown,paused:lastSample?.paused,tick:lastSample?.match?.tick,activeElement:await p.evaluate(()=>document.activeElement?.tagName)}));
   }
  });
 }
 await step('C-wall-clock-simulation-rate',p,async()=>{await start(p);await delay(2500);const a=await state(p);await delay(5000);const b=await state(p);const ratio=(b.match.tick-a.match.tick)/(b.now-a.now);metrics.clock={ratio,simulationSeconds:b.match.tick-a.match.tick,wallSeconds:b.now-a.now,frameMs:b.frameMs,gpu:b.gpuRenderer};assert(ratio>.7&&ratio<1.3,'simulation / real time = '+ratio);});
 await step('C-WASD-camera',p,async()=>{
 metrics.movement=[];
 for(const [k,axis,sign] of [['w','z',-1],['s','z',1],['a','x',-1],['d','x',1]]){
   // Every direction begins from a fresh known spawn. Otherwise previous input may
   // have moved the player against a wall, AI, or an obstacle.
   let passed=false;
   for(let attempt=0;attempt<4&&!passed;attempt++){
     await start(p);
     const a=await state(p);
     await key(p,k,420);
     const b=await state(p);
     const before=a.match.tanks[0],after=b.match.tanks[0];
     const delta=(after[axis]-before[axis])*sign;
     metrics.movement.push({key:k,attempt,axis,expectedSign:sign,before:{x:before.x,z:before.z,alive:before.alive},
       after:{x:after.x,z:after.z,alive:after.alive},delta,tickAdvance:b.match.tick-a.match.tick,paused:b.paused});
     passed=before.alive&&after.alive&&b.match.tick>a.match.tick&&delta>.2;
   }
   assert(passed,'No safe movement observed for '+k+' across four independent matches');
 }
});
 await step('C-wall-boundary-blocking',p,async()=>{await start(p);await key(p,'a',1500);const a=await state(p);await key(p,'a',500);const b=await state(p);assert(a.match.tanks[0].x>=1.49);assert(Math.abs(b.match.tanks[0].x-a.match.tanks[0].x)<.1);});
 await step('C-mine-trigger-splash',p,async()=>{await start(p);await p.keyboard.press('7');await p.mouse.move(700,350);await p.mouse.down();await delay(150);await p.mouse.up();await key(p,'w',750);await p.waitForFunction(()=>window.xtankDiagnostics().events.some(e=>e.type==='explosion'&&e.weapon==='mine'),null,{timeout:45000});const s=await state(p);const boom=s.events.find(e=>e.type==='explosion'&&e.weapon==='mine');assert(s.events.some(e=>e.type==='hit'&&e.tick===boom.tick),'mine splash damage');});
 await step('C-seven-weapons-mouse-fire',p,async()=>{
  const weapons=['hurricane','death_knight','vulcan','plasma','chemical','ion_missile','mine'];
  for(let i=0;i<weapons.length;i++){
   // Every weapon must produce its own authoritative fire event while the
   // player is alive. A dead player cannot fire; a multi-minute sequence of
   // unprotected bot attacks is not evidence of a broken weapon.
   await start(p);
   await p.keyboard.press(String(i+1));
   await p.mouse.move(700,350);
   let fired=false;
   await p.mouse.down();
   try{
    const until=Date.now()+5000;
    while(Date.now()<until){
     const snapshot=await state(p);
     if(snapshot.events.some(e=>e.type==='fire'&&e.owner==='player'&&e.weapon===weapons[i])){
      fired=true;break;
     }
     if(!snapshot.match?.tanks[0]?.alive)break;
     await delay(100);
    }
   }finally{await p.mouse.up();}
   assert(fired,'Live player did not fire weapon '+weapons[i]);
   await snap(p,'weapon-'+weapons[i]);
  }
 });
 await step('C-items-and-skill',p,async()=>{await start(p,'D');await p.keyboard.down('w');for(const [key,type] of [['e','ability'],['F1','repair'],['F2','boost'],['F4','radar'],['F5','smoke'],['F6','teamRepair']]){
 const deadline=Date.now()+30000;let done=false;
 while(Date.now()<deadline){const a=await state(p);if(a.events.some(e=>e.type===type&&e.id==='player')){done=true;break;}const t=a.match.tanks[0];if(t.alive&&(key!=='e'||t.hp>14)&&(key!=='F1'||t.hp<t.maxHp))await p.keyboard.press(key);await delay(300);}
 assert(done,'confirmed action '+type);
} const s=await state(p);await p.keyboard.up('w');for(const type of ['ability','repair','boost','radar','smoke','teamRepair'])assert(s.events.some(e=>e.type===type&&e.id==='player'),type);});
 await step('C-F3-shield-consumption',p,async()=>{await start(p);await p.waitForFunction(()=>{const t=window.xtankDiagnostics().match.tanks[0];return t.alive&&t.shield<t.maxShield-10;},null,{timeout:45000});const before=(await state(p)).match.tanks[0];await p.keyboard.press('F3');await delay(250);const after=(await state(p)).match.tanks[0];assert.equal(after.shieldCells,before.shieldCells-1);assert(after.shieldCooldown>0);});
 for(const [digit,weapon] of [[1,'hurricane'],[2,'death_knight'],[3,'vulcan'],[4,'plasma'],[5,'chemical'],[6,'ion_missile']])await step('C-target-hit-'+weapon,p,async()=>{await start(p);await p.keyboard.press(''+digit);const deadline=Date.now()+45000;await p.mouse.down();try{while(Date.now()<deadline){const s=await state(p);if(s.events.some(e=>e.type==='hit'&&e.owner==='player'&&e.id!=='player'&&e.weapon===weapon))return;const own=s.match.tanks[0];const target=s.match.tanks.filter(t=>t.id!=='player'&&t.alive).sort((a,b)=>Math.hypot(a.x-own.x,a.z-own.z)-Math.hypot(b.x-own.x,b.z-own.z))[0];const pt=s.screen.find(t=>t.id===target?.id);if(pt&&pt.x>0&&pt.x<s.viewport.width&&pt.y>65&&pt.y<s.viewport.height)await p.mouse.move(pt.x,pt.y);await delay(150);}throw Error('No confirmed player hit using '+weapon);}finally{await p.mouse.up();}});
 await step('C-AI-damage-death-respawn-score-result',p,async()=>{await start(p);await p.mouse.move(650,300);await p.mouse.down();const first=await state(p);let sawDeath=false,sawRespawn=false;const deadline=Date.now()+390000;while(Date.now()<deadline){const s=await state(p);sawDeath ||= s.events.some(e=>e.type==='death');sawRespawn ||= s.events.some(e=>e.type==='respawn');if(s.match?.ended)break;await delay(2000);}await p.mouse.up();const s=await state(p);assert(s.events.some(e=>e.type==='fire'&&e.owner!=='player'),'AI fires');assert(s.events.some(e=>e.type==='hit'),'damage');if(s.events.some(e=>e.type==='ram'))results.push({name:'C-tank-ram-collision',status:'PASS'});assert(sawDeath,'death');assert(sawRespawn,'respawn');assert(s.match.ended,'natural match completion');assert(await p.isVisible('#resultMenu'));assert(s.match.tanks.some((t,i)=>i&&Math.hypot(t.x-first.match.tanks[i].x,t.z-first.match.tanks[i].z)>1),'AI movement');await snap(p,'natural-result');await p.click('#againButton');await wait(p,()=>window.xtankDiagnostics().match?.tick>.1);});
 await step('C-Escape-return-home',p,async()=>{if(!await p.isVisible('#pauseBadge'))await p.keyboard.press('Escape');await p.click('#resumeButton');assert(!(await state(p)).paused);await p.keyboard.press('Escape');await p.click('#pauseHomeButton');assert(await p.isVisible('#startMenu'));});
 // A tank matrix regex such as ^B-D- must NOT launch a second network client.
  const q=needsNetworkClient(filter)?await launch(1):null;
 await step('D-LAN-create-join-start-sync-reconnect',p,async()=>{
 // The second native EXE was last foregrounded; return focus to the host.
 await home(p);await home(q);await clickForeground(p,'#hostServerButton');await p.waitForFunction(()=>document.querySelector('#networkStatus').textContent.includes('已啟動'));
 await p.fill('#playerName','QA-A');await p.selectOption('#mapSelect','chess');await clickForeground(p,'#makeRoomButton');await wait(p,()=>document.querySelector('#roomCode').value.length===6);await clickForeground(p,'#leaveNetworkButton');assert(!await p.isVisible('#networkLobby'));await p.fill('#roomCode','');await clickForeground(p,'#makeRoomButton');await wait(p,()=>document.querySelector('#roomCode').value.length===6);const code=await p.inputValue('#roomCode');
 proxy=net.createServer(client=>{const upstream=net.connect(8787,'127.0.0.1');tunnels.add(client);tunnels.add(upstream);client.pipe(upstream);upstream.pipe(client);for(const sock of [client,upstream]){sock.on('error',()=>{});sock.on('close',()=>{tunnels.delete(sock);client.destroy();upstream.destroy();});}});await new Promise(r=>proxy.listen(8788,'127.0.0.1',r));await q.fill('#serverAddress','ws://127.0.0.1:8788');
 await q.fill('#playerName','QA-B');await q.fill('#roomCode','000000');await clickForeground(q,'#joinRoomButton');await q.waitForFunction(()=>document.querySelector('#networkStatus').textContent.includes('ROOM_NOT_FOUND'));await snap(q,'wrong-room');
 for(let i=0;i<7;i++){const w=new WebSocket('ws://127.0.0.1:8787');fillers.push(w);await new Promise((ok,bad)=>{w.once('open',()=>w.send(JSON.stringify({type:'JOIN',roomId:code,name:'Capacity-'+i,tank:'X'})));w.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='JOINED')ok();if(m.type==='ERROR')bad(Error(m.code));});w.once('error',bad);});}
 await q.fill('#roomCode',code);await clickForeground(q,'#joinRoomButton');await q.waitForFunction(()=>document.querySelector('#networkStatus').textContent.includes('ROOM_FULL'));await snap(q,'room-full');results.push({name:'D-room-full',status:'PASS'});for(const w of fillers)w.close();await delay(32000);for(let i=0;i<6;i++){const w=new WebSocket('ws://127.0.0.1:8787');fillers.push(w);await new Promise((ok,bad)=>{w.once('open',()=>w.send(JSON.stringify({type:'JOIN',roomId:code,name:'Idle-helper-'+i,tank:'D'})));w.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='JOINED')ok();if(m.type==='ERROR')bad(Error(m.code));});w.once('error',bad);});}await clickForeground(q,'#joinRoomButton');await p.waitForFunction(()=>document.querySelector('#roomPeople').textContent.includes('QA-B'));await clickForeground(p,'#startNetworkButton');await wait(q,()=>window.xtankDiagnostics().match?.tanks.length>1);
 for(const page of [p,q])assert.equal((await state(page)).match.mapId,'chess');
 const a=await state(p);await key(p,'s',700);await delay(400);const b=await state(p),c=await state(q);assert(b.match.tanks[0].z>a.match.tanks[0].z+.5);const remote=c.match.tanks.find(t=>t.id==='remote-host');assert(Math.abs(remote.z-b.match.tanks[0].z)<1);
 await p.mouse.move(650,300);await p.mouse.down();await delay(1600);await p.mouse.up();await delay(300);assert((await state(q)).events.some(e=>e.type==='fire'&&e.owner==='remote-host'));
 const prior=await state(q);for(const socket of tunnels)socket.destroy();await q.waitForFunction(()=>document.querySelector('#networkStatus').textContent.includes('斷線'));await snap(q,'B-real-disconnect');await delay(4000);const resumed=await state(q);assert.equal(resumed.networkRoomId,prior.networkRoomId);assert.equal(resumed.networkSlot,prior.networkSlot);assert(resumed.match.tick>prior.match.tick);await key(q,'s',500);await q.mouse.move(650,300);await q.mouse.down();await delay(1500);await q.mouse.up();await delay(250);const aa=await state(p),bb=await state(q);assert(aa.events.some(e=>e.type==='fire'&&e.owner===bb.networkSlot),'B fire received by A');const shared=aa.networkFrames.find(a=>bb.networkFrames.some(b=>a.tick===b.tick));assert(shared,'shared authoritative tick');const other=bb.networkFrames.find(b=>b.tick===shared.tick);assert.deepEqual(shared.tanks,other.tanks);assert.deepEqual(shared.score,other.score);await snap(q,'client-B-sync');results.push({name:'D-bidirectional-authoritative-state-sync',status:'PASS'});
 });
 if(results.find(r=>r.name==='D-LAN-create-join-start-sync-reconnect')?.status==='PASS')await step('D-human-vs-human-hit-damage',p,async()=>{
 async function moveTo(page,axis,target){const deadline=Date.now()+12000;let held=null;try{while(Date.now()<deadline){const t=(await state(page)).match.tanks[0];if(!t.alive){await delay(250);continue;}const diff=target-t[axis];if(Math.abs(diff)<.7)return;const k=axis==='x'?(diff>0?'d':'a'):(diff>0?'s':'w');if(k!==held){if(held)await page.keyboard.up(held);await page.keyboard.down(k);held=k;}await delay(120);}throw Error('Could not reach duel position');}finally{if(held)await page.keyboard.up(held);}}
 await Promise.all([moveTo(p,'z',2),moveTo(q,'z',2)]);await Promise.all([moveTo(p,'x',18),moveTo(q,'x',28)]);
 await p.mouse.down();await q.mouse.down();let hitA=false,hitB=false;try{const deadline=Date.now()+20000;while(Date.now()<deadline){const a=await state(p),b=await state(q);hitA ||= a.events.some(e=>e.type==='hit'&&e.owner==='player'&&e.id===b.networkSlot);hitB ||= b.events.some(e=>e.type==='hit'&&e.owner==='player'&&e.id==='remote-host');if(hitA&&hitB){await q.mouse.up();const deadline2=Date.now()+15000;while(Date.now()<deadline2){const aa=await state(p),bb=await state(q);if(!bb.match.tanks[0].alive){await snap(q,'B-PvP-death');await q.waitForFunction(()=>window.xtankDiagnostics().match.tanks[0].alive,null,{timeout:10000});assert((await state(p)).match.tanks[0].kills>0);return;}const pt=aa.screen.find(t=>t.id===bb.networkSlot);if(pt)await p.mouse.move(Math.min(aa.viewport.width-1,Math.max(1,pt.x)),Math.min(aa.viewport.height-1,Math.max(65,pt.y)));await delay(100);}throw Error('PvP kill/respawn not observed');}for(const [page,s,id] of [[p,a,b.networkSlot],[q,b,'remote-host']]){const pt=s.screen.find(t=>t.id===id);if(pt&&pt.x>0&&pt.y>62)await page.mouse.move(Math.min(s.viewport.width-1,pt.x),Math.min(s.viewport.height-1,pt.y));}await delay(100);}assert(hitA&&hitB,'both humans must actually hit the other');}finally{await p.mouse.up();await q.mouse.up();}
 });
 if(results.find(r=>r.name==='D-LAN-create-join-start-sync-reconnect')?.status==='PASS')
 await step('D-natural-end-lobby-second-round',p,async()=>{await p.waitForSelector('#resultMenu:not([hidden])',{timeout:390000});await q.waitForSelector('#resultMenu:not([hidden])',{timeout:15000});await snap(q,'B-network-result');await q.click('#returnButton');assert(await q.isVisible('#startMenu'));await p.waitForFunction(()=>document.querySelector('#roomPeople').textContent.includes('QA-B ○'));await p.click('#againButton');await p.waitForSelector('#startNetworkButton:not([hidden])');await q.click('#joinRoomButton');await p.waitForFunction(()=>document.querySelector('#roomPeople').textContent.includes('QA-B ●'));await p.click('#startNetworkButton');await wait(q,()=>!document.querySelector('#hud').hidden&&!document.querySelector('#resultMenu:not([hidden])'));});

 }catch(e){results.push({name:current,status:'BLOCKED',error:e.stack});console.error(e);}finally{
 for(const w of fillers)w.terminate();for(const socket of tunnels)socket.destroy();proxy?.close();
 for(const name of ['A-portable-exe-home-WebGL','C-WASD-camera','C-wall-clock-simulation-rate','C-wall-boundary-blocking','C-mine-trigger-splash','C-seven-weapons-mouse-fire','C-items-and-skill','C-AI-damage-death-respawn-score-result','C-Escape-return-home','D-LAN-create-join-start-sync-reconnect','D-natural-end-lobby-second-round','C-F3-shield-consumption','C-tank-ram-collision','D-human-vs-human-hit-damage','D-room-full','D-bidirectional-authoritative-state-sync'])if(!results.some(r=>r.name===name))results.push({name,status:'BLOCKED',reason:'Scenario did not complete.'});
 for(const tank of ['X','D','M','R','H','A','O','S'])for(const mode of ['FFA','TDM','FLAG_HOLD'])for(const map of ['desk','chess','circuit']){const name=`B-${tank}-${mode}-${map}`;if(!results.some(r=>r.name===name))results.push({name,status:'BLOCKED',reason:'Matrix scenario did not execute.'});}
 for(const weapon of ['hurricane','death_knight','vulcan','plasma','chemical','ion_missile']){const name='C-target-hit-'+weapon;if(!results.some(r=>r.name===name))results.push({name,status:'BLOCKED',reason:'Target hit scenario did not execute.'});}
 for(const c of clients){try{await bounded(c.context?.tracing.stop({path:path.join(out,'trace-'+clients.indexOf(c)+'.zip')}),30000);}catch{}try{await bounded(c.browser?.close(),10000);}catch{}try{execFileSync('taskkill',['/pid',String(c.proc.pid),'/t','/f']);}catch{}}
 save();const md=['# Native Windows EXE GUI results',filter?'TARGETED regression only; not full-suite acceptance.':'FULL suite','',...results.map(r=>`- **${r.status}** ${r.name}${r.error?' — '+r.error.split('\n')[0]:r.reason?' — '+r.reason:''}`)].join('\n');fs.writeFileSync(path.join(out,'REPORT.md'),md);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md);process.exitCode=results.filter(r=>!filter||filter.test(r.name)).some(r=>r.status!=='PASS')?1:0;
 }} )();
