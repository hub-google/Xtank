'use strict';
const http=require('node:http');
const crypto=require('node:crypto');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {WebSocketServer,WebSocket}=require('ws');
const id=()=>crypto.randomBytes(8).toString('hex');
const send=(ws,msg)=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));};
const sanitizeInput=m=>{
 if(!['dx','dz','aimYaw'].every((k)=>typeof m[k]==='number'&&Number.isFinite(m[k])))return null;
 if(Math.abs(m.dx)>1||Math.abs(m.dz)>1||Math.abs(m.aimYaw)>Math.PI*2)return null;
 return {dx:m.dx,dz:m.dz,aimYaw:m.aimYaw,fire:m.fire===true,
  weapon:['hurricane','death_knight','vulcan','plasma','chemical','ion_missile','mine'].includes(m.weapon)?m.weapon:undefined,
  item:[1,2,3,4,5,6].includes(m.item)?m.item:0,ability:m.ability===true};
};
async function createHost({port=8787,host='0.0.0.0'}={}){
 let engine;
 try{engine=require('./engine.cjs');}
 catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;
  engine=await import(pathToFileURL(path.join(__dirname,'../src/simulation.js')).href);}
 const {Game,TANKS}=engine;
 const rooms=new Map();
 const httpServer=http.createServer((req,res)=>{
  if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,rooms:rooms.size}));}
  else{res.writeHead(404);res.end();}
 });
 const wss=new WebSocketServer({server:httpServer,maxPayload:4096,perMessageDeflate:false});
 const members=r=>[...r.people.values()];
 function broadcast(r,msg){for(const p of members(r))send(p.ws,msg);}
 function lobby(r){broadcast(r,{type:'LOBBY',roomId:r.id,mode:r.mode,phase:r.phase,hostId:r.hostId,
  people:members(r).map(p=>({id:p.id,name:p.name,tank:p.tank,connected:!!p.ws,host:p.id===r.hostId}))});}
 function start(r,p){
  if(p.id!==r.hostId||r.phase!=='lobby')return send(p.ws,{type:'ERROR',code:'NOT_HOST_OR_PHASE'});
  if(r.people.size<2)return send(p.ws,{type:'ERROR',code:'NEED_TWO_PLAYERS'});
  const game=new Game({mode:r.mode,selectedTank:'X',size:8,seed:crypto.randomBytes(4).readUInt32LE()});
  game.humanIds=new Set();
  r.game=game;r.inputs=new Map();r.phase='live';r.roundId=id();r.events=[];
  const slots=r.mode==='FFA'?[0,1,2,3,4,5,6,7]:[0,4,1,5,2,6,3,7];
  members(r).forEach((x,i)=>{
   const t=game.tanks[slots[i]],cfg=TANKS[x.tank];
   x.slot=t.id;x.seq=-1;
   t.kind=x.tank;t.hp=t.maxHp=cfg.hp;t.shield=t.maxShield=cfg.shield;t.ammo={chemical:18,ion_missile:8,mine:5};
   game.humanIds.add(t.id);
   r.inputs.set(t.id,{dx:0,dz:0,aimYaw:0,fire:false,item:0,ability:false});
   send(x.ws,{type:'START',mode:r.mode,slotId:t.id,roundId:r.roundId,roomId:r.id});
  });
  lobby(r);
 }
 wss.on('connection',ws=>{
  let p=null,r=null,received=0,windowStart=Date.now();
  ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true;});
  ws.on('message',raw=>{
   if(Date.now()-windowStart>1000){received=0;windowStart=Date.now();}
   if(++received>60){ws.close(1008,'rate limit');return;}
   let m;try{m=JSON.parse(raw.toString());}catch{return send(ws,{type:'ERROR',code:'BAD_JSON'});}
   if(!m||typeof m.type!=='string')return;
   if(m.type==='CREATE'&&!p){
    if(rooms.size>=32)return send(ws,{type:'ERROR',code:'SERVER_FULL'});
    let code;do{code=crypto.randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));
    r={id:code,mode:['FFA','TDM','FLAG_HOLD'].includes(m.mode)?m.mode:'FFA',
      phase:'lobby',people:new Map(),hostId:null,game:null,inputs:null,roundId:null,events:[],snapCount:0,created:Date.now()};
    rooms.set(code,r);
    p=makePlayer(m,ws);r.people.set(p.id,p);r.hostId=p.id;
    send(ws,{type:'JOINED',roomId:r.id,playerId:p.id,token:p.token,host:true});lobby(r);
   }else if(m.type==='JOIN'&&!p){
    const found=rooms.get(String(m.roomId||'').toUpperCase());
    if(!found)return send(ws,{type:'ERROR',code:'ROOM_NOT_FOUND'});
    if(found.phase!=='lobby')return send(ws,{type:'ERROR',code:'ROUND_RUNNING'});
    if(found.people.size>=8)return send(ws,{type:'ERROR',code:'ROOM_FULL'});
    r=found;p=makePlayer(m,ws);r.people.set(p.id,p);
    send(ws,{type:'JOINED',roomId:r.id,playerId:p.id,token:p.token,host:false});lobby(r);
   }else if(m.type==='RESUME'&&!p){
    const found=rooms.get(String(m.roomId||'').toUpperCase());
    const old=found&&members(found).find(x=>x.id===m.playerId&&x.token===m.token);
    if(!old)return send(ws,{type:'ERROR',code:'INVALID_SESSION'});
    if(old.ws?.readyState===WebSocket.OPEN)old.ws.close(4001,'replaced');
    r=found;p=old;p.ws=ws;p.token=id()+id();p.seq=-1;p.lastSeen=Date.now();
    send(ws,{type:'JOINED',roomId:r.id,playerId:p.id,token:p.token,host:p.id===r.hostId});
    lobby(r);if(r.phase==='live')send(ws,{type:'START',mode:r.mode,slotId:p.slot,roundId:r.roundId,roomId:r.id});
   }else if(!p||p.ws!==ws){send(ws,{type:'ERROR',code:'NOT_JOINED'});}
   else if(m.type==='START')start(r,p);
   else if(m.type==='INPUT'&&r.phase==='live'&&p.slot){
    if(!Number.isSafeInteger(m.seq)||m.seq<=p.seq)return;
    const input=sanitizeInput(m);
    if(!input)return send(ws,{type:'ERROR',code:'INVALID_INPUT'});
    p.seq=m.seq;r.inputs.set(p.slot,input);
   }else if(m.type==='BACK_TO_LOBBY'&&p.id===r.hostId&&r.phase==='finished'){
    r.phase='lobby';r.game=null;r.inputs=null;
    for(const other of members(r))if(!other.ws)r.people.delete(other.id);else other.slot=null;
    lobby(r);
   }else if(m.type==='PING')send(ws,{type:'PONG',serverTime:Date.now()});
  });
  ws.on('close',()=>{
   if(!p||p.ws!==ws)return;
   p.ws=null;p.lastSeen=Date.now();
   if(r.inputs&&p.slot)r.inputs.set(p.slot,{dx:0,dz:0,aimYaw:0,fire:false});
   if(p.id===r.hostId)r.hostId=members(r).find(x=>x.ws)?.id||null;
   lobby(r);
  });
  ws.on('error',()=>{});
 });
 function makePlayer(m,ws){
  const tank=TANKS[m.tank]?m.tank:'X';
  return {id:id(),token:id()+id(),name:String(m.name||'Player').replace(/[<>]/g,'').slice(0,20),
   tank,ws,seq:-1,slot:null,lastSeen:Date.now()};
 }
 const ticking=setInterval(()=>{
  for(const r of rooms.values()){
   for(const p of members(r)){
    if(!p.ws&&Date.now()-p.lastSeen>30000){
     if(r.game&&p.slot){r.game.humanIds.delete(p.slot);r.inputs?.delete(p.slot);}
     r.people.delete(p.id);
    }
   }
   if(r.phase==='live'&&r.game){
    const inputs=Object.fromEntries(r.inputs);
    try{const events=r.game.update(.05,{},inputs);r.events.push(...events);}
    catch(err){console.error('X-TANK room tick:',err);r.phase='finished';}
    for(const v of r.inputs.values()){v.item=0;v.ability=false;}
    r.snapCount++;
    if(r.game.ended)r.phase='finished';
    if(r.snapCount%2===0||r.phase==='finished'){
     const g=r.game;
     broadcast(r,{type:'SNAPSHOT',mode:g.mode,roundId:r.roundId,time:g.time,tick:g.tick,
      ended:g.ended,score:[...g.scores],target:g.target,flag:{...g.flag},
      tanks:g.tanks.map(x=>({...x,ammo:{...x.ammo}})),
      projectiles:g.projectiles.map(x=>({...x})),smokes:g.smokes.map(x=>({...x})),repairFields:g.repairFields.map(x=>({...x})),events:r.events.splice(0)});
     if(r.phase==='finished')lobby(r);
    }
   }
   if(!r.people.size&&Date.now()-r.created>20000)rooms.delete(r.id);
  }
 },50);
 ticking.unref?.();
 const heartbeat=setInterval(()=>{
  for(const ws of wss.clients){if(!ws.isAlive)ws.terminate();else{ws.isAlive=false;ws.ping();}}
 },10000);
 heartbeat.unref?.();
 try{await new Promise((ok,fail)=>{
  httpServer.once('error',fail);httpServer.listen(port,host,()=>{httpServer.off('error',fail);ok();});
 });}catch(err){clearInterval(ticking);clearInterval(heartbeat);wss.close();throw err;}
 return {port:httpServer.address().port,rooms,close:async()=>{
  clearInterval(ticking);clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();
  await new Promise(ok=>wss.close(()=>httpServer.close(ok)));
 }};
}
module.exports={createHost,sanitizeInput};
