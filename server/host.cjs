'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {WebSocketServer,WebSocket}=require('ws');
const {officialService}=require('./official.cjs');
const {createFixedStepClock}=require('./fixed-step-clock.cjs');
const id=()=>crypto.randomBytes(8).toString('hex');
const MAX_BUFFERED_BYTES=1024*1024;
const send=(ws,msg)=>{
 if(ws?.readyState!==WebSocket.OPEN)return false;
 // A client reading too slowly must not accumulate unbounded queued snapshots,
 // which would otherwise exhaust the always-on authoritative host memory.
 if(ws.bufferedAmount>MAX_BUFFERED_BYTES){
  ws.close(1013,'slow consumer');
  return false;
 }
 ws.send(JSON.stringify(msg));
 return true;
};
const sanitizeInput=m=>{
 if(!['dx','dz','aimYaw'].every((k)=>typeof m[k]==='number'&&Number.isFinite(m[k])))return null;
 if(Math.abs(m.dx)>1||Math.abs(m.dz)>1||Math.abs(m.aimYaw)>Math.PI*2)return null;
 return {dx:m.dx,dz:m.dz,aimYaw:m.aimYaw,fire:m.fire===true,
  weapon:['hurricane','death_knight','vulcan','plasma','chemical','ion_missile','mine'].includes(m.weapon)?m.weapon:undefined,
  item:[1,2,3,4,5,6].includes(m.item)?m.item:0,ability:m.ability===true};
};
async function createHost({port=8787,host='0.0.0.0',testRoundSeconds=null,maxConnections=512,unjoinedTimeoutMs=45000}={}){
 if(!Number.isSafeInteger(maxConnections)||maxConnections<1||maxConnections>4096)throw Error('INVALID_CONNECTION_CAPACITY');
 if(!Number.isSafeInteger(unjoinedTimeoutMs)||unjoinedTimeoutMs<40||unjoinedTimeoutMs>300000)throw Error('INVALID_JOIN_TIMEOUT');
 // Controlled accelerated *full* simulation for automated WSS integration tests only.
 // Client input cannot change the time limit. Production rejects this option.
 if(testRoundSeconds!==null && (process.env.NODE_ENV!=='test'||!Number.isFinite(testRoundSeconds)
   ||testRoundSeconds<0.5||testRoundSeconds>20))throw Error('TEST_ROUND_SECONDS_FORBIDDEN');
 let engine;
 try{engine=require('./engine.cjs');}
 catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;
  engine=await import(pathToFileURL(path.join(__dirname,'../src/simulation.js')).href);}
 const {Game,TANKS,MAPS}=engine;
 const rooms=new Map();
 let shuttingDown=false;
 const official=officialService({onSettlement:(payload,saved)=>{
   const room=[...rooms.values()].find(r=>r.roundId===payload.round_id);
   if(!room||room.officialMatchId||!saved?.match_id)return;
   room.officialMatchId=saved.match_id;
   broadcast(room,{type:'MATCH_SAVED',matchId:saved.match_id,players:saved.players});
 }});
 let serviceStatus={enabled:!!official,notice:'正在確認官方服務狀態'};
 async function refreshMaintenance(){
  if(!official)return;
  try{serviceStatus=await official.maintenanceStatus();}
  catch(error){
   serviceStatus={enabled:true,notice:'官方服務狀態暫時無法確認，已停止接受新對戰'};
   console.error('Official maintenance status:',error.message);
  }
 }
 if(official)await refreshMaintenance();
 const httpServer=http.createServer((req,res)=>{
  if(req.url==='/health'){
    const states=[...rooms.values()];
    let settlementQueue=null,storageHealthy=true;
    try{settlementQueue=official?.outboxStats?.()||null;}
    catch(error){
     storageHealthy=false;
     console.error('Official settlement storage unavailable:',error.message);
    }
    const ready=storageHealthy&&!shuttingDown;
    res.writeHead(ready?200:503,{'content-type':'application/json','cache-control':'no-store'});
    res.end(JSON.stringify({ok:ready,maintenance:serviceStatus.enabled,
      maintenanceNotice:serviceStatus.notice,rooms:rooms.size,connectedClients:[...wss.clients].filter(ws=>ws.readyState===WebSocket.OPEN).length,
      liveMatches:states.filter(room=>room.phase==='live').length,
      pendingSettlements:official?states.filter(room=>room.phase==='finished'&&!room.officialMatchId).length:0,
      pendingSettlementFiles:settlementQueue?.pendingFiles||0,
      oldestPendingSettlementSeconds:settlementQueue?.oldestPendingSeconds??null,
      refundPendingRooms:states.filter(room=>room.phase==='aborting'||room.phase==='closing').length,
      uptimeSeconds:Math.floor(process.uptime()),rssMb:Math.round(process.memoryUsage().rss/1048576)}));
   }
  else{res.writeHead(404);res.end();}
 });
 const wss=new WebSocketServer({server:httpServer,maxPayload:4096,perMessageDeflate:false});
 const members=r=>[...r.people.values()];
 const roomSummary=r=>({roomId:r.id,name:r.name||'未命名房間',mode:r.mode,mapId:r.mapId,ruleClass:r.ruleClass||'growth',phase:r.phase,
   players:members(r).filter(p=>p.ws).length,capacity:8,passwordRequired:!!r.password});
 function passwordDigest(password,salt){return new Promise((resolve,reject)=>crypto.scrypt(password,salt,32,(error,key)=>error?reject(error):resolve(key)));}
 async function roomPasswordValid(r,password){
   if(!r.password)return true;
   if(typeof password!=='string'||password.length>64)return false;
   // PBKDF must run off the event loop: synchronous scrypt here stalls every
   // active combat room whenever someone retries a password-protected JOIN.
   const attempt=await passwordDigest(password,r.password.salt);
   return crypto.timingSafeEqual(r.password.hash,attempt);
 }
 function broadcast(r,msg){for(const p of members(r))send(p.ws,msg);}
 function broadcastSpectators(r,msg){for(const ws of r.spectators||[])send(ws,msg);}
 function lobby(r){broadcast(r,{type:'LOBBY',roomId:r.id,name:r.name||'未命名房間',mode:r.mode,mapId:r.mapId,ruleClass:r.ruleClass||'growth',phase:r.phase,hostId:r.hostId,slowModeMs:r.slowModeMs||0,
  people:members(r).map(p=>({id:p.id,name:p.name,tank:p.tank,team:p.team,connected:!!p.ws,ready:!!p.ready,host:p.id===r.hostId}))});}
 function selectTeam(r,requested){
   if(r.mode==='FFA')return 0;
   const counts=[0,0];for(const x of members(r))if(x.team===0||x.team===1)counts[x.team]++;
   if((requested===0||requested===1)&&counts[requested]<4)return requested;
   return counts[0]<=counts[1]&&counts[0]<4?0:1;
 }
 function maybeReturnToLobby(r){
  if(r.phase!=='finished'||(official&&!r.officialMatchId))return false;
  const connected=members(r).filter(player=>player.ws?.readyState===WebSocket.OPEN);
  if(connected.length&&connected.some(player=>!player.returned))return false;
  r.phase='lobby';r.game=null;r.inputs=null;r.events=[];r.roundId=null;
  r.persistStarted=false;r.officialMatchId=null;r.accountBySlot=null;
  for(const player of members(r)){
   if(player.ws?.readyState!==WebSocket.OPEN)r.people.delete(player.id);
   else{player.slot=null;player.ready=false;player.returned=false;}
  }
  if(!r.hostId||!r.people.has(r.hostId))r.hostId=connected[0]?.id||null;
  lobby(r);
  return true;
 }
 function cancelCountdown(r){
   if(r.phase!=='countdown')return;
   r.phase='lobby';delete r.countdownDeadline;
   broadcast(r,{type:'COUNTDOWN_CANCELLED'});lobby(r);
 }
 function start(r,p){
  if(official&&serviceStatus.enabled)
   return send(p.ws,{type:'ERROR',code:'SERVER_MAINTENANCE',message:serviceStatus.notice});
  if(p.id!==r.hostId||r.phase!=='lobby')return send(p.ws,{type:'ERROR',code:'NOT_HOST_OR_PHASE'});
  if(members(r).filter(v=>v.ws).length<2)return send(p.ws,{type:'ERROR',code:'NEED_TWO_PLAYERS'});
   if(official&&members(r).some(v=>v.ws&&!v.ready))return send(p.ws,{type:'ERROR',code:'PLAYERS_NOT_READY'});
   if(r.mode!=='FFA'){
     const live=members(r).filter(v=>v.ws);
     if(!live.some(v=>v.team===0)||!live.some(v=>v.team===1))
       return send(p.ws,{type:'ERROR',code:'NEED_BOTH_TEAMS'});
   }
  if(official){
   r.phase='countdown';r.countdownDeadline=Date.now()+5000;r.lastCountdownSecond=5;
   broadcast(r,{type:'COUNTDOWN',seconds:5});lobby(r);
   return;
  }
  launch(r);
 }
 async function refundAbortedRoom(r){
  if(r.phase!=='aborting'||r.refundTask)return r.refundTask;
  const roundId=r.roundId;
  const task=(async()=>{
   try{
    if(official&&roundId)await official.release(roundId);
    else await Promise.resolve();
    if(r.phase!=='aborting'||r.roundId!==roundId)return;
    r.roundId=null;r.game=null;r.inputs=null;r.events=[];r.phase='lobby';
    r.refundAttempts=0;r.nextRefundAt=0;
    for(const player of members(r)){player.slot=null;player.ready=false;}
    broadcast(r,{type:'ROUND_REFUNDED'});
    lobby(r);
   }catch(error){
    console.error('Aborted round refund awaiting retry:',roundId,error.message);
    if(r.phase!=='aborting'||r.roundId!==roundId)return;
    r.refundAttempts=(r.refundAttempts||0)+1;
    const retryMs=Math.min(60000,5000*Math.pow(2,Math.min(r.refundAttempts-1,4)));
    r.nextRefundAt=Date.now()+retryMs;
    broadcast(r,{type:'ROUND_REFUND_PENDING',retrySeconds:Math.ceil(retryMs/1000)});
   }
  })();
  r.refundTask=task;
  try{await task}finally{if(r.refundTask===task)r.refundTask=null;}
 }
 async function prepareOfficialLaunch(r){
  if(!official||r.phase!=='countdown')return;
  r.phase='allocating';
  r.roundId=id()+id();
  const roundId=r.roundId;
  const prepared=members(r).filter(p=>p.ws);
  try{
   // Reserve per-player stocks in the database before any client enters the
   // official match. Failure rolls back all previously reserved players.
   for(const p of prepared){
    if(r.phase!=='allocating'||r.roundId!==roundId)
      throw Error('RESERVATION_CANCELLED_DURING_SHUTDOWN');
    if(!p.accountUserId)throw Error('PLAYER_NOT_AUTHENTICATED');
    // Refetch from DB every round: last round's consumed/refunded stock
    // cannot be reused as the next round's authoritative quantity.
    const currentProfile=await official.currentLoadout(p.accountUserId,p.tank);
    p.allowedWeapons=currentProfile.allowedWeapons;
    p.upgrades=currentProfile.upgrades;
    p.itemsAvailable=currentProfile.itemsAvailable;
    await official.reserve(roundId,p.accountUserId,p.itemsAvailable);
   }
   if(r.phase!=='allocating'||r.roundId!==roundId||
      prepared.length<2||prepared.some(p=>!p.ws||!p.ready||!r.people.has(p.id)))
      throw Error('ROOM_CHANGED_DURING_RESERVATION');
   launch(r);
  }catch(error){
   console.error('Official reservation rejected:',error.message);
   if(r.roundId!==roundId||r.phase==='closing')return;
   r.phase='aborting';
   broadcast(r,{type:'ERROR',code:'MATCH_RESERVATION_FAILED',message:error.message});
   lobby(r);
   await refundAbortedRoom(r);
  }
 }
 function launch(r){
  if(!['lobby','countdown','allocating'].includes(r.phase))return;
  // Prepare all participant slots before publishing START or switching phase.
  // An invalid loadout/slot must not strand some players inside a phantom match.
  const seed=crypto.randomBytes(4).readUInt32LE();
  const rulesetCode='prototype_0_2_2';
  const game=new Game({mode:r.mode,mapId:r.mapId,selectedTank:'X',size:8,seed});
  if(testRoundSeconds!==null)game.time=testRoundSeconds;
  game.humanIds=new Set();
  const inputs=new Map(),accountBySlot=new Map(),starts=[];
  const slots=r.mode==='FFA'?[0,1,2,3,4,5,6,7]:[0,4,1,5,2,6,3,7];
  const chosen=new Set();
  const connected=members(r).filter(x=>x.ws?.readyState===WebSocket.OPEN);
  if(connected.length<2)throw Error('MATCH_PLAYERS_DISCONNECTED');
  for(let i=0;i<connected.length;i++){
   const player=connected[i];
   if(!TANKS[player.tank])throw Error('INVALID_TANK');
   let slot=slots[i];
   if(r.mode!=='FFA'){
    const found=game.tanks.findIndex((tank,index)=>
      !chosen.has(index)&&tank.team===player.team);
    if(found<0)throw Error('TEAM_SLOT_MISSING');
    slot=found;
   }
   if(chosen.has(slot))throw Error('DUPLICATE_PLAYER_SLOT');
   chosen.add(slot);
   const tank=game.tanks[slot],cfg=TANKS[player.tank];
   tank.kind=player.tank;tank.hp=tank.maxHp=cfg.hp;
   tank.upgrades=official&&r.ruleClass==='growth'?{...player.upgrades}:undefined;
   tank.maxShield=Math.round(cfg.shield*(1+.02*(tank.upgrades?.energy||0)));
   tank.shield=tank.maxShield;tank.ammo={chemical:18,ion_missile:8,mine:5};
   if(official){
    if(!player.accountUserId)throw Error('OFFICIAL_PLAYER_NOT_AUTHENTICATED');
    if(!player.allowedWeapons?.size)throw Error('OFFICIAL_EMPTY_LOADOUT');
    tank.itemsRemaining={...player.itemsAvailable};
    tank.itemsUsed={};
    tank.repair=Math.min(tank.repair,tank.itemsRemaining.repair||0);
    tank.shieldCells=Math.min(tank.shieldCells,tank.itemsRemaining.shield_cell||0);
    tank.weapon=player.allowedWeapons.values().next().value;
    accountBySlot.set(tank.id,player.accountUserId);
   }
   game.humanIds.add(tank.id);
   inputs.set(tank.id,{dx:0,dz:0,aimYaw:0,fire:false,item:0,ability:false});
   starts.push({player,slotId:tank.id});
  }
  const roundId=r.roundId||id();
  // All validations succeeded: commit one coherent match state and publish START.
  r.game=game;r.inputs=inputs;r.accountBySlot=accountBySlot;
  r.phase='live';r.roundId=roundId;r.events=[];r.snapCount=0;
  r.seed=seed;r.rulesetCode=rulesetCode;r.startedAt=Date.now();
  r.persistStarted=false;r.officialMatchId=null;
  for(const {player,slotId} of starts){
   player.slot=slotId;player.seq=-1;player.returned=false;
   send(player.ws,{type:'START',mode:r.mode,mapId:r.mapId,slotId,
    roundId,roomId:r.id,seed,rulesetCode,ruleClass:r.ruleClass,
    official:!!official,allowedWeapons:official?[...player.allowedWeapons]:null});
  }
  lobby(r);
  broadcastSpectators(r,{type:'START',mode:r.mode,mapId:r.mapId,
    slotId:game.tanks[0].id,roundId,roomId:r.id,seed,rulesetCode,
    ruleClass:r.ruleClass,official:!!official,spectator:true});
 }
 wss.on('connection',ws=>{
  if(shuttingDown){ws.close(1012,'server restarting');return;}
  // Limit anonymous sockets before they can use game / authentication state.
  if(wss.clients.size>maxConnections){ws.close(1013,'server full');return;}
  let p=null,r=null,observedRoom=null,received=0,windowStart=Date.now();
  const joinTimeout=setTimeout(()=>{
   if(!p&&!observedRoom&&ws.readyState===WebSocket.OPEN)ws.close(1008,'join timeout');
  },unjoinedTimeoutMs);
  joinTimeout.unref?.();
  ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});
  ws.on('message',async raw=>{
   if(Date.now()-windowStart>1000){received=0;windowStart=Date.now();}
   if(++received>60){ws.close(1008,'rate limit');return;}
   let m;try{m=JSON.parse(raw.toString());}catch{return send(ws,{type:'ERROR',code:'BAD_JSON'});}
   if(!m||typeof m.type!=='string')return;
   if(official&&serviceStatus.enabled&&['CREATE','JOIN','QUICK_MATCH','SPECTATE'].includes(m.type))
    return send(ws,{type:'ERROR',code:'SERVER_MAINTENANCE',message:serviceStatus.notice});
   if(observedRoom){
     if(m.type==='PING')send(ws,{type:'PONG',serverTime:Date.now(),clientTime:Number.isSafeInteger(m.clientTime)?m.clientTime:null});
     else send(ws,{type:'ERROR',code:'SPECTATOR_READ_ONLY'});
     return;
   }
   if(ws._xtankResumePending)return send(ws,{type:'ERROR',code:'RESUME_PENDING'});
   // Creating a password-protected room hashes off-thread. Reject concurrent packets.
   if(ws._xtankCreatePending)return send(ws,{type:'ERROR',code:'CREATE_PENDING'});
   if(official&&(m.type==='CREATE'||m.type==='JOIN'||m.type==='QUICK_MATCH'||m.type==='SPECTATE')&&!p){
      if(ws._xtankAuthPending)return send(ws,{type:'ERROR',code:'AUTH_PENDING'});
      ws._xtankAuthPending=true;
      try{
        const verified=await official.authenticate(m.accessToken,m.tank);
        m.name=verified.name;m.accountUserId=verified.player_id;m.allowedWeapons=verified.allowedWeapons;m.upgrades=verified.upgrades;m.itemsAvailable=verified.itemsAvailable;
      }catch(err){ws._xtankAuthPending=false;return send(ws,{type:'ERROR',code:'AUTH_FAILED',message:err.message});}
      ws._xtankAuthPending=false;
      if(ws.readyState!==WebSocket.OPEN)return;
       if([...rooms.values()].some(room=>members(room).some(member=>member.accountUserId===m.accountUserId))){
         return send(ws,{type:'ERROR',code:'ACCOUNT_ALREADY_IN_ROOM'});
       }
    }
    if(m.type==='QUICK_MATCH'&&!p){
      const candidates=[...rooms.values()].filter(room=>room.phase==='lobby'&&!room.password&&members(room).length<8&&room.mode===m.mode
        &&(m.mapId==null||room.mapId===m.mapId));
      candidates.sort((a,b)=>members(b).length-members(a).length);
      if(candidates.length){m.type='JOIN';m.roomId=candidates[0].id;}
      else m.type='CREATE';
    }
    if(m.type==='LIST_ROOMS'&&!p){
      send(ws,{type:'ROOMS',rooms:[...rooms.values()].filter(room=>room.phase==='lobby'&&!room.password).map(roomSummary).slice(0,32)});
    }else if(m.type==='SPECTATE'&&!p){
      const target=rooms.get(String(m.roomId||'').toUpperCase());
      if(!target||target.password||target.phase!=='live')return send(ws,{type:'ERROR',code:'SPECTATE_UNAVAILABLE'});
      if(!target.spectators)target.spectators=new Set();
      if(target.spectators.size>=8)return send(ws,{type:'ERROR',code:'SPECTATOR_LIMIT'});
      observedRoom=target;target.spectators.add(ws);
      if(official)ws._xtankAccountUserId=m.accountUserId;
      send(ws,{type:'JOINED',roomId:target.id,playerId:null,token:null,host:false,spectator:true});
      send(ws,{type:'START',mode:target.mode,mapId:target.mapId,
        slotId:target.game?.tanks[0]?.id||null,roundId:target.roundId,roomId:target.id,seed:target.seed,rulesetCode:target.rulesetCode,ruleClass:target.ruleClass,
        official:!!official,spectator:true});
    }else if(m.type==='CREATE'&&!p){
    if(rooms.size>=32)return send(ws,{type:'ERROR',code:'SERVER_FULL'});
    let code;do{code=crypto.randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));
    const requestedName=typeof m.roomName==='string'?m.roomName.trim():'';
    if(requestedName.length>32||/[\u0000-\u001f\u007f]/.test(requestedName))return send(ws,{type:'ERROR',code:'INVALID_ROOM_NAME'});
    r={id:code,name:requestedName||String(m.name||'Player').slice(0,20)+' 的房間',ruleClass:['growth','standard'].includes(m.ruleClass)?m.ruleClass:'growth',spectators:new Set(),slowModeMs:0,mode:['FFA','TDM','FLAG_HOLD'].includes(m.mode)?m.mode:'FFA',
      mapId:typeof m.mapId==='string'&&Object.hasOwn(MAPS,m.mapId)?m.mapId:'desk',
      phase:'lobby',people:new Map(),hostId:null,game:null,inputs:null,roundId:null,events:[],snapCount:0,created:Date.now()};
    if(typeof m.password==='string'&&m.password.length>0){
      if(m.password.length>40)return send(ws,{type:'ERROR',code:'PASSWORD_TOO_LONG'});
      ws._xtankCreatePending=true;
      try{
       const salt=crypto.randomBytes(16);
       r.password={salt,hash:await passwordDigest(m.password,salt)};
      }catch(error){return send(ws,{type:'ERROR',code:'PASSWORD_CREATE_FAILED'});}
      finally{ws._xtankCreatePending=false;}
      if(ws.readyState!==WebSocket.OPEN||p)return;
     }
     if(rooms.size>=32)return send(ws,{type:'ERROR',code:'SERVER_FULL'});
     while(rooms.has(r.id))r.id=crypto.randomBytes(3).toString('hex').toUpperCase();
     rooms.set(r.id,r);
    p=makePlayer(m,ws);p.team=selectTeam(r,m.team);r.people.set(p.id,p);r.hostId=p.id;
    send(ws,{type:'JOINED',roomId:r.id,playerId:p.id,token:p.token,host:true});lobby(r);
   }else if(m.type==='JOIN'&&!p){
    if(ws._xtankJoinPending)return send(ws,{type:'ERROR',code:'JOIN_PENDING'});
    const found=rooms.get(String(m.roomId||'').toUpperCase());
    if(!found)return send(ws,{type:'ERROR',code:'ROOM_NOT_FOUND'});
    if(found.phase!=='lobby')return send(ws,{type:'ERROR',code:'ROUND_RUNNING'});
    if(found.people.size>=8)return send(ws,{type:'ERROR',code:'ROOM_FULL'});
    ws._xtankJoinPending=true;
    let correct;
    try{correct=await roomPasswordValid(found,m.password);}
    catch(error){ws._xtankJoinPending=false;return send(ws,{type:'ERROR',code:'PASSWORD_CHECK_FAILED'});}
    ws._xtankJoinPending=false;
    if(ws.readyState!==WebSocket.OPEN||p)return;
    if(!correct)return send(ws,{type:'ERROR',code:'BAD_ROOM_PASSWORD'});
    // Verify mutable room state again after asynchronous password checking.
    if(found.phase!=='lobby')return send(ws,{type:'ERROR',code:'ROUND_RUNNING'});
    if(found.people.size>=8)return send(ws,{type:'ERROR',code:'ROOM_FULL'});
    r=found;p=makePlayer(m,ws);p.team=selectTeam(r,m.team);r.people.set(p.id,p);
    if(!r.hostId)r.hostId=p.id;
    send(ws,{type:'JOINED',roomId:r.id,playerId:p.id,token:p.token,host:p.id===r.hostId});lobby(r);
   }else if(m.type==='RESUME'&&!p){
    const found=rooms.get(String(m.roomId||'').toUpperCase());
    const old=found&&members(found).find(x=>x.id===m.playerId&&x.token===m.token
      &&(x.ws||Date.now()-x.lastSeen<=30000));
    if(!old)return send(ws,{type:'ERROR',code:'INVALID_SESSION'});
    if(old.resumePending)return send(ws,{type:'ERROR',code:'RESUME_PENDING'});
    // Hold this authoritative slot during network auth; two simultaneous
    // reconnect attempts cannot consume the same resumption token.
    old.resumePending=true;
    ws._xtankResumePending=true;
    try{
     let verified;
     if(official){
      try{verified=await official.authenticate(m.accessToken,old.tank);}
      catch(error){return send(ws,{type:'ERROR',code:'AUTH_FAILED'});}
      if(verified.player_id!==old.accountUserId)return send(ws,{type:'ERROR',code:'WRONG_ACCOUNT'});
     }
     if(ws.readyState!==WebSocket.OPEN||p)return;
     if(rooms.get(found.id)!==found||found.people.get(old.id)!==old||old.token!==m.token
       ||(!old.ws&&Date.now()-old.lastSeen>30000))
      return send(ws,{type:'ERROR',code:'INVALID_SESSION'});
     if(verified&&found.phase==='lobby'){
      old.allowedWeapons=verified.allowedWeapons;
      old.upgrades=verified.upgrades;
      old.itemsAvailable=verified.itemsAvailable;
     }
     if(old.ws?.readyState===WebSocket.OPEN)old.ws.close(4001,'replaced');
     r=found;p=old;p.ws=ws;p.token=id()+id();p.seq=-1;p.lastSeen=Date.now();
     if(!r.hostId||!members(r).some(member=>member.id===r.hostId&&member.ws))r.hostId=p.id;
     send(ws,{type:'JOINED',roomId:r.id,playerId:p.id,token:p.token,host:p.id===r.hostId});
     lobby(r);
     if(r.phase==='live')send(ws,{type:'START',mode:r.mode,mapId:r.mapId,slotId:p.slot,roundId:r.roundId,roomId:r.id,seed:r.seed,rulesetCode:r.rulesetCode,ruleClass:r.ruleClass,official:!!official,allowedWeapons:official?[...p.allowedWeapons]:null});
    }finally{
     old.resumePending=false;
     ws._xtankResumePending=false;
    }
   }else if(!p||p.ws!==ws){send(ws,{type:'ERROR',code:'NOT_JOINED'});}
   else if(m.type==='START')start(r,p);
   else if(m.type==='ROOM_SETTINGS'){
    if(r.phase!=='lobby'||p.id!==r.hostId)return send(ws,{type:'ERROR',code:'ROOM_SETTINGS_DENIED'});
    if(typeof m.name!=='string'||m.name.trim().length<2||m.name.trim().length>32||/[\u0000-\u001f\u007f]/.test(m.name))
      return send(ws,{type:'ERROR',code:'INVALID_ROOM_NAME'});
    if(!['FFA','TDM','FLAG_HOLD'].includes(m.mode)||!Object.hasOwn(MAPS,m.mapId)||
       !['growth','standard'].includes(m.ruleClass))
      return send(ws,{type:'ERROR',code:'INVALID_ROOM_RULES'});
    const previousMode=r.mode;
    const changed=r.mode!==m.mode||r.mapId!==m.mapId||r.ruleClass!==m.ruleClass;
    r.name=m.name.trim();r.mode=m.mode;r.mapId=m.mapId;r.ruleClass=m.ruleClass;
    if(changed){
      let nextTeam=0;
      for(const member of members(r)){
        member.ready=false;
        if(r.mode==='FFA')member.team=0;
        else if((member.team!==0&&member.team!==1)||previousMode!==r.mode){member.team=nextTeam;nextTeam=1-nextTeam;}
      }
    }
    lobby(r);
   }
    else if(m.type==='READY'&&(r.phase==='lobby'||r.phase==='countdown')){
      if(r.phase==='countdown'&&m.ready!==true)cancelCountdown(r);
      p.ready=m.ready===true;lobby(r);
    }
    else if(m.type==='TEAM'&&r.phase==='lobby'){
      if(r.mode==='FFA')return send(ws,{type:'ERROR',code:'NO_TEAMS_IN_FFA'});
      if(m.team!==0&&m.team!==1)return send(ws,{type:'ERROR',code:'INVALID_TEAM'});
      const teamSize=members(r).filter(member=>member.id!==p.id&&member.team===m.team).length;
      if(teamSize>=4)return send(ws,{type:'ERROR',code:'TEAM_FULL'});
      p.team=m.team;p.ready=false;lobby(r);
    }
    else if(m.type==='CHAT'&&(r.phase==='lobby'||r.phase==='live')){
      if((p.globalMutedUntil||0)>Date.now())
        return send(ws,{type:'ERROR',code:'GLOBAL_CHAT_MUTED',until:p.globalMutedUntil});
      if((p.mutedUntil||0)>Date.now())
        return send(ws,{type:'ERROR',code:'ROOM_CHAT_MUTED',until:p.mutedUntil});
      const text=typeof m.text==='string'?m.text.trim():'';
      if(text.length<1||text.length>140||/[\u0000-\u001f\u007f]/.test(text))
        return send(ws,{type:'ERROR',code:'INVALID_CHAT'});
      if(Date.now()-(p.lastChatAt||0)<Math.max(950,r.slowModeMs||0))
        return send(ws,{type:'ERROR',code:'CHAT_RATE_LIMIT'});
      if(p.chatPending)return send(ws,{type:'ERROR',code:'CHAT_REQUEST_PENDING'});
      p.chatPending=true;
      try{
       if(official){
        const globalUntil=await official.chatMutedUntil(p.accountUserId);
        if(globalUntil>Date.now())
          return send(ws,{type:'ERROR',code:'GLOBAL_CHAT_MUTED',until:globalUntil});
       }
       if(p.ws!==ws||r.people.get(p.id)!==p)return;
       if((p.mutedUntil||0)>Date.now())
         return send(ws,{type:'ERROR',code:'ROOM_CHAT_MUTED',until:p.mutedUntil});
       if(Date.now()-(p.lastChatAt||0)<Math.max(950,r.slowModeMs||0))
         return send(ws,{type:'ERROR',code:'CHAT_RATE_LIMIT'});
       p.lastChatAt=Date.now();
       broadcast(r,{type:'ROOM_CHAT',playerId:p.id,name:p.name,text,at:Date.now()});
      }catch(error){
       send(ws,{type:'ERROR',code:'CHAT_POLICY_UNAVAILABLE'});
       console.error('Global chat moderation lookup:',error.message);
      }finally{p.chatPending=false;}
    }
   else if(m.type==='MODERATE'&&(r.phase==='lobby'||r.phase==='live')){
     if(p.id!==r.hostId)return send(ws,{type:'ERROR',code:'HOST_ONLY'});
     if(m.action==='slowmode'){
       if(![0,2000,5000,10000].includes(m.milliseconds))return send(ws,{type:'ERROR',code:'INVALID_CHAT_SLOWMODE'});
       r.slowModeMs=m.milliseconds;
       lobby(r);
       return;
     }
     const target=members(r).find(member=>member.id===m.targetId&&member.id!==p.id);
     if(!target)return send(ws,{type:'ERROR',code:'PLAYER_NOT_FOUND'});
     if(m.action==='mute'){
       if(![0,60,300,900].includes(m.seconds))return send(ws,{type:'ERROR',code:'INVALID_MUTE_LENGTH'});
       target.mutedUntil=m.seconds?Date.now()+m.seconds*1000:0;
       send(target.ws,{type:'ROOM_MODERATION',action:'mute',until:target.mutedUntil});
       return;
     }
     if(m.action==='kick'){
       send(target.ws,{type:'ROOM_MODERATION',action:'kick'});
       target.ws?.close(1008,'removed by room host');
       target.ws=null;target.token=null;target.lastSeen=Date.now()-31000;
       if(r.inputs&&target.slot)r.inputs.delete(target.slot);
       if(r.game&&target.slot)r.game.humanIds.delete(target.slot);
       // A kicked player's reconnect token must not recreate a room seat.
       r.people.delete(target.id);
       if(r.phase==='countdown')cancelCountdown(r);
       lobby(r);return;
     }
     send(ws,{type:'ERROR',code:'INVALID_MODERATION'});
   }
   else if(m.type==='INPUT'&&r.phase==='live'&&p.slot){
    if(!Number.isSafeInteger(m.seq)||m.seq<=p.seq)return;
    const input=sanitizeInput(m);
    if(!input)return send(ws,{type:'ERROR',code:'INVALID_INPUT'});
    if(official&&input.weapon&&!p.allowedWeapons?.has(input.weapon))return send(ws,{type:'ERROR',code:'WEAPON_NOT_OWNED'});
     p.seq=m.seq;r.inputs.set(p.slot,input);
   }else if(m.type==='BACK_TO_LOBBY'&&r.phase==='finished'){
    // A player cannot force everyone else's results screen to close.
    if(official&&!r.officialMatchId)return send(ws,{type:'ERROR',code:'MATCH_SETTLEMENT_PENDING'});
    p.returned=true;
    if(!maybeReturnToLobby(r)){
      const waiting=members(r).filter(v=>v.ws?.readyState===WebSocket.OPEN&&!v.returned).length;
      broadcast(r,{type:'REMATCH_WAITING',playersRemaining:waiting});
    }
   }else if(m.type==='PING')send(ws,{type:'PONG',serverTime:Date.now(),clientTime:Number.isSafeInteger(m.clientTime)?m.clientTime:null});
  });
  ws.on('close',()=>{
   clearTimeout(joinTimeout);
   if(observedRoom)observedRoom.spectators?.delete(ws);
   if(!p||p.ws!==ws)return;
   p.ws=null;p.lastSeen=Date.now();
   if(r.inputs&&p.slot)r.inputs.set(p.slot,{dx:0,dz:0,aimYaw:0,fire:false});
   if(r.phase==='countdown')cancelCountdown(r);
   if(p.id===r.hostId)r.hostId=members(r).find(x=>x.ws?.readyState===WebSocket.OPEN)?.id||null;
   if(r.phase==='finished'&&maybeReturnToLobby(r))return;
   lobby(r);
  });
  ws.on('error',()=>{});
 });
 function makePlayer(m,ws){
  const tank=TANKS[m.tank]?m.tank:'X';
  return {id:id(),token:id()+id(),name:String(m.name||'Player').replace(/[<>]/g,'').slice(0,20),
   tank,ready:false,ws,seq:-1,slot:null,lastSeen:Date.now(),accountUserId:m.accountUserId||null,allowedWeapons:m.allowedWeapons||null,upgrades:m.upgrades||null,itemsAvailable:m.itemsAvailable||null};
 }
 // Drive exactly 50 ms of simulation per fixed step, including catch-up after
 // short scheduler stalls. Poll at 25 ms to reduce jitter without doubling ticks.
 const elapsedSteps=createFixedStepClock({periodMs:50,maxCatchUpSteps:5});
 const ticking=setInterval(()=>{
  const steps=elapsedSteps();
  for(let step=0;step<steps;step++)for(const r of rooms.values()){
   if(r.phase==='aborting'&&!r.refundTask&&Date.now()>=(r.nextRefundAt||0))
    void refundAbortedRoom(r);
   if(r.phase==='countdown'){
     const live=members(r).filter(member=>member.ws);
     if(live.length<2||live.some(member=>!member.ready))cancelCountdown(r);
     else if(Date.now()>=r.countdownDeadline){
       const task=prepareOfficialLaunch(r);
       r.allocationTask=task;
       void task.finally(()=>{if(r.allocationTask===task)r.allocationTask=null;});
     }
     else{
       const seconds=Math.max(1,Math.ceil((r.countdownDeadline-Date.now())/1000));
       if(seconds!==r.lastCountdownSecond){
         r.lastCountdownSecond=seconds;
         broadcast(r,{type:'COUNTDOWN',seconds});
       }
     }
   }
   for(const p of members(r)){
    if(!p.ws&&Date.now()-p.lastSeen>30000){
     if(r.game&&p.slot){r.game.humanIds.delete(p.slot);r.inputs?.delete(p.slot);}
     r.people.delete(p.id);
    }
   }
   if(r.phase==='live'&&r.game){
    const inputs=Object.fromEntries(r.inputs);
    try{const events=r.game.update(.05,{},inputs);r.events.push(...events);}
    catch(err){
     console.error('X-TANK room tick:',err);
     r.phase='aborting';
     broadcast(r,{type:'ROUND_ABORTED',reason:'GAME_ENGINE_FAILED'});
     lobby(r);
     void refundAbortedRoom(r);
     continue;
    }
    for(const v of r.inputs.values()){v.item=0;v.ability=false;}
    r.snapCount++;
    if(r.game.ended){
       r.phase='finished';
       if(official&&!r.persistStarted){
         r.persistStarted=true;
         (async()=>{
           for(let attempt=1;attempt<=4;attempt++){
             try{await official.settle(r);return}
             catch(error){console.error('Official settlement attempt',attempt,error.message);await new Promise(ok=>setTimeout(ok,attempt*700))}
           }
           console.error('X-TANK official settlement requires recovery',r.roundId);
         })();
       }
     }
    if(r.snapCount%2===0||r.phase==='finished'){
     const g=r.game;
     const snapshot={type:'SNAPSHOT',mode:g.mode,mapId:g.mapId,roundId:r.roundId,time:g.time,tick:g.tick,
       ended:g.ended,score:[...g.scores],target:g.target,flag:{...g.flag},
       tanks:g.tanks.map(x=>({...x,ammo:{...x.ammo}})),
       projectiles:g.projectiles.map(x=>({...x})),smokes:g.smokes.map(x=>({...x})),
       repairFields:g.repairFields.map(x=>({...x})),events:r.events.splice(0)};
     broadcast(r,snapshot);broadcastSpectators(r,snapshot);

     if(r.phase==='finished')lobby(r);
    }
   }
   // Do not discard an active round just because every socket timed out: the
   // authoritative engine must finish it and persist official results first.
   if(!r.people.size&&!(r.spectators?.size)&&
      !['live','allocating','aborting','closing'].includes(r.phase)&&
      (!official||r.phase!=='finished'||r.officialMatchId)&&
      Date.now()-r.created>20000)rooms.delete(r.id);
  }
 },25);
 ticking.unref?.();
 const heartbeat=setInterval(()=>{
  for(const ws of wss.clients){if(!ws.isAlive)ws.terminate();else{ws.isAlive=false;ws.ping();}}
 },10000);
 heartbeat.unref?.();
 try{await new Promise((ok,fail)=>{
  httpServer.once('error',fail);httpServer.listen(port,host,()=>{httpServer.off('error',fail);ok();});
 });}catch(err){clearInterval(ticking);clearInterval(heartbeat);wss.close();throw err;}
 // Live moderator enforcement (suspension, chat mute) across room changes.
 // Clients cannot spoof server-level policies; the official server queries DB itself.
 let moderationBusy=false;
 async function refreshOnlineModeration(){
   if(!official||moderationBusy)return;
   moderationBusy=true;
   try{
     const online=[...rooms.values()].flatMap(room=>members(room)
       .filter(player=>player.ws?.readyState===WebSocket.OPEN&&player.accountUserId)
       .map(player=>({room,player})));
     if(!online.length)return;
     const observing=[...rooms.values()].flatMap(room=>[...(room.spectators||[])]
       .filter(ws=>ws.readyState===WebSocket.OPEN&&ws._xtankAccountUserId)
       .map(ws=>({ws,accountUserId:ws._xtankAccountUserId})));
     const uniqueIds=[...new Set([...online.map(({player})=>player.accountUserId),
       ...observing.map(x=>x.accountUserId)])];
     for(let i=0;i<uniqueIds.length;i+=512){
       const ids=uniqueIds.slice(i,i+512);
       const result=await official.onlineModeration(ids);
       const suspended=new Set(result.suspended||[]);
       for(const observer of observing){
         if(ids.includes(observer.accountUserId)&&suspended.has(observer.accountUserId)
           &&observer.ws.readyState===WebSocket.OPEN){
           send(observer.ws,{type:'ROOM_MODERATION',action:'suspend'});
           observer.ws.close(1008,'account suspended');
         }
       }
       for(const {room,player} of online){
         if(!ids.includes(player.accountUserId)||player.ws?.readyState!==WebSocket.OPEN)continue;
         if(suspended.has(player.accountUserId)){
           send(player.ws,{type:'ROOM_MODERATION',action:'suspend'});
           player.ws.close(1008,'account suspended');
           // 'close' listener transfers host rights and cancels countdown.
         }else{
           const until=result.muted?.[player.accountUserId];
           player.globalMutedUntil=until?Date.parse(until)||0:0;
         }
       }
     }
   }catch(error){console.error('Official live moderation:',error.message);}
   finally{moderationBusy=false;}
 }
 const maintenanceTimer=official?setInterval(()=>void refreshMaintenance(),15000):null;
 maintenanceTimer?.unref?.();
 const moderationTimer=official?setInterval(()=>void refreshOnlineModeration(),15000):null;
 moderationTimer?.unref?.();
 // Periodically reconcile abandoned consumables across crashed official hosts.
 // Skip recovery while this host has any undelivered result on disk.
 const recoveryTimer=official?setInterval(()=>{
   official.recoverConsumables().catch(e=>console.error('Official escrow maintenance:',e.message));
 },60*60*1000):null;
 recoveryTimer?.unref?.();
 if(official)void official.recoverConsumables().catch(e=>console.error('Escrow startup recovery:',e.message));
 let shutdownPromise=null;
 async function shutdown(){
  if(shutdownPromise)return shutdownPromise;
  shuttingDown=true;
  shutdownPromise=(async()=>{
   clearInterval(ticking);
   clearInterval(heartbeat);
   if(recoveryTimer)clearInterval(recoveryTimer);
   if(moderationTimer)clearInterval(moderationTimer);
   if(maintenanceTimer)clearInterval(maintenanceTimer);
   const abandoned=[];
   for(const room of rooms.values()){
    if(!official||!room.roundId)continue;
    if(room.phase==='allocating'||room.phase==='live'||room.phase==='aborting'){
      abandoned.push(room);
      room.phase='closing';
    }else if(room.phase==='countdown')room.phase='closing';
   }
   // Finish pending atomic reservations before refunding.
   await Promise.allSettled(abandoned.flatMap(room=>[room.allocationTask,room.refundTask]).filter(Boolean));
   if(official){
    // Release independent rounds concurrently to meet cloud shutdown grace
    // periods. All DB releases are individually idempotent and transactional.
    await Promise.allSettled(abandoned.map(async room=>{
      try{await official.release(room.roundId);}
      catch(error){console.error('Item refund deferred to abandoned-round recovery:',room.roundId,error.message);}
    }));
   }
   official?.close?.();
   for(const socket of wss.clients)socket.terminate();
   await new Promise(resolve=>wss.close(()=>httpServer.close(resolve)));
  })();
  return shutdownPromise;
 }
 return {port:httpServer.address().port,rooms,close:shutdown};
}
module.exports={createHost,sanitizeInput,send,MAX_BUFFERED_BYTES};
