'use strict';
// Real 8-player WebSocket soak against the authoritative 20Hz server.
// Run: XTANK_SOAK_SECONDS=1800 node scripts/soak-wss.cjs
// No Supabase/service-role credentials or external network endpoints are used.
const {createHost}=require('../server/host.cjs');
const {WebSocket}=require('ws');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const seconds=Number(process.env.XTANK_SOAK_SECONDS||30);
if(!Number.isInteger(seconds)||seconds<10||seconds>3600)throw Error('INVALID_SOAK_DURATION');
const intervalMs=50;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const send=(ws,msg)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));};
const clients=[];
let host=null,heartbeat=null,sampling=null,closed=false;
const stats={durationSeconds:seconds,players:8,packets:0,snapshots:0,rounds:0,
  maxGapMs:0,maxRssMb:0,maxHeapMb:0,errors:[],disconnected:0,
  lastServerTick:0,firstStartedAt:null,lastSnapshotAt:null,roomId:null};
async function dial(port,name){
 const ws=new WebSocket('ws://127.0.0.1:'+port);
 const member={ws,name,id:null,slot:null,seq:0,snapshots:0,lastSeenAt:null,
   deferred:[],lastTick:0};
 clients.push(member);
 ws.on('message',raw=>{
  let msg;try{msg=JSON.parse(raw.toString())}catch{stats.errors.push('INVALID_JSON_FROM_SERVER');return}
  if(msg.type==='ERROR'){stats.errors.push(name+': '+msg.code);return}
  if(msg.type==='SNAPSHOT'){
   if(msg.roundId!==member.roundId)member.lastTick=0;
   member.roundId=msg.roundId;
   if(msg.tick<member.lastTick-.001)stats.errors.push('NON_MONOTONIC_TICK '+name);
   member.lastTick=msg.tick;
   stats.lastServerTick=Math.max(stats.lastServerTick,msg.tick);
   const now=Date.now();
   if(member.lastSeenAt)stats.maxGapMs=Math.max(stats.maxGapMs,now-member.lastSeenAt);
   member.lastSeenAt=now;stats.lastSnapshotAt=now;
   member.snapshots++;stats.snapshots++;stats.packets++;
   if(msg.ended&&member===clients[0])restart().catch(error=>stats.errors.push(error.message));
  }else{
   const found=member.deferred.find(x=>x.type===msg.type&&(!x.check||x.check(msg)));
   if(found){member.deferred.splice(member.deferred.indexOf(found),1);found.resolve(msg)}
  }
 });
 ws.on('close',()=>{if(!closed)stats.disconnected++});
 ws.on('error',error=>{if(!closed)stats.errors.push('SOCKET_ERROR '+name+': '+error.message)});
 await new Promise((ok,fail)=>{ws.once('open',ok);ws.once('error',fail)});
 return member;
}
function take(member,type,check,timeout=7000){
 return new Promise((resolve,reject)=>{
  const waiter={type,check,resolve:value=>{clearTimeout(timer);resolve(value)}};
  member.deferred.push(waiter);
  const timer=setTimeout(()=>{
   member.deferred.splice(member.deferred.indexOf(waiter),1);
   reject(Error('TIMED_OUT '+member.name+' '+type));
  },timeout);
 });
}
let changing=false;
async function restart(){
 if(changing||closed||!stats.roomId)return;
 changing=true;
 try{
  const owner=clients[0];
  const received=take(owner,'LOBBY',m=>m.phase==='lobby',7000);
  send(owner.ws,{type:'BACK_TO_LOBBY'});
  await received;
  const starts=clients.map(c=>take(c,'START',null,7000));
  send(owner.ws,{type:'START'});
  const messages=await Promise.all(starts);
  if(new Set(messages.map(x=>x.slotId)).size!==8)throw Error('DUPLICATE_SLOTS_ON_NEW_ROUND');
  stats.rounds++;
 }finally{changing=false}
}
async function run(){
 if(process.env.XTANK_OFFICIAL_MODE==='1')throw Error('SOAK_REQUIRES_ISOLATED_LAN_SERVER');
 host=await createHost({host:'127.0.0.1',port:0});
 const kinds=['X','D','M','R','H','A','O','S'];
 const owner=await dial(host.port,'soak-0');
 const first=take(owner,'JOINED');
 send(owner.ws,{type:'CREATE',name:'soak-0',mode:'TDM',mapId:'chess',tank:kinds[0]});
 const joined=await first;owner.id=joined.playerId;stats.roomId=joined.roomId;
 for(let i=1;i<8;i++){
  const member=await dial(host.port,'soak-'+i);
  const ready=take(member,'JOINED');
  send(member.ws,{type:'JOIN',roomId:joined.roomId,name:member.name,tank:kinds[i]});
  member.id=(await ready).playerId;
 }
 const starts=clients.map(c=>take(c,'START'));
 send(owner.ws,{type:'START'});
 const initial=await Promise.all(starts);
 if(new Set(initial.map(m=>m.slotId)).size!==8)throw Error('DUPLICATE_PLAYER_SLOTS');
 clients.forEach((c,i)=>{c.slot=initial[i].slotId;c.seq=0;});
 stats.rounds=1;stats.firstStartedAt=new Date().toISOString();
 const begin=Date.now();
 const until=begin+seconds*1000;
 heartbeat=setInterval(()=>{
  for(const [i,c] of clients.entries()){
   const angle=(c.seq/15+i)%6.28;
   // 8 independent real client INPUT packets at 20Hz = 160 packets/s aggregate.
   send(c.ws,{type:'INPUT',seq:++c.seq,dx:Math.sin(angle),dz:Math.cos(angle),
     aimYaw:angle,weapon:i%3?'hurricane':'vulcan',fire:c.seq%4!==0,item:0,ability:c.seq%120===0});
  }
 },intervalMs);
 sampling=setInterval(()=>{
  const mem=process.memoryUsage();
  stats.maxRssMb=Math.max(stats.maxRssMb,Math.round(mem.rss/1048576));
  stats.maxHeapMb=Math.max(stats.maxHeapMb,Math.round(mem.heapUsed/1048576));
  if(stats.lastSnapshotAt&&Date.now()-stats.lastSnapshotAt>5000)stats.errors.push('SNAPSHOTS_STALLED');
 },1000);
 while(Date.now()<until&&!stats.errors.length)await delay(500);
 closed=true;
 clearInterval(heartbeat);clearInterval(sampling);
 const elapsed=Math.max(1,(Date.now()-begin)/1000);
 stats.elapsedSeconds=Math.round(elapsed*100)/100;
 stats.averageSnapshotsPerClientPerSecond=Math.round(stats.snapshots/clients.length/elapsed*100)/100;
 stats.clientSnapshotCounts=clients.map(c=>({name:c.name,count:c.snapshots}));
 stats.finalRoomPhase=host.rooms.get(stats.roomId)?.phase;
 const threshold=Math.floor(elapsed*5);
 for(const c of clients)if(c.snapshots<threshold)stats.errors.push('TOO_FEW_SNAPSHOTS '+c.name+' '+c.snapshots);
 if(stats.disconnected)stats.errors.push('UNEXPECTED_DISCONNECT '+stats.disconnected);
 if(stats.maxGapMs>8000)stats.errors.push('EXCESSIVE_SNAPSHOT_GAP '+stats.maxGapMs);
 if(stats.maxRssMb>600)stats.errors.push('MEMORY_CAP_EXCEEDED '+stats.maxRssMb);
 const output=path.resolve(process.env.XTANK_SOAK_REPORT||'qa-evidence/server-soak.json');
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({...stats,sha:process.env.GITHUB_SHA||null},null,2));
 console.log(JSON.stringify(stats,null,2));
 if(stats.errors.length)process.exitCode=1;
}
run().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{
 closed=true;
 clearInterval(heartbeat);clearInterval(sampling);
 clients.forEach(c=>{c.deferred.splice(0);c.ws.terminate()});
 await host?.close();
});
