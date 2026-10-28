'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {WebSocket}=require('ws');
const {createHost}=require('../server/host.cjs');
const A='a'.repeat(120),uid='00000000-0000-4000-8000-000000000042';
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
async function dial(port){
 const ws=new WebSocket('ws://127.0.0.1:'+port);ws.queue=[];
 ws.on('message',raw=>ws.queue.push(JSON.parse(String(raw))));
 await new Promise((ok,fail)=>{ws.once('open',ok);ws.once('error',fail)});
 return ws;
}
async function take(ws,type,{code,timeout=6000}={}){
 const until=Date.now()+timeout;
 while(Date.now()<until){
  const i=ws.queue.findIndex(m=>m.type===type&&(code===undefined||m.code===code));
  if(i>=0)return ws.queue.splice(i,1)[0];
  await wait(10);
 }
 throw Error('Timed out '+type+'/'+code+' '+JSON.stringify(ws.queue));
}
test('simultaneous official RESUME attempts cannot both consume a live JWT-protected slot',async()=>{
 const names=['XTANK_OFFICIAL_MODE','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','XTANK_SETTLEMENT_DIR'];
 const prev=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 const previousFetch=global.fetch;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xtank-resume-race-'));
 let pending=false,started=()=>{},release=()=>{};
 const authRequested=new Promise(ok=>started=ok),unblock=new Promise(ok=>release=ok);
 global.fetch=async(url,opts)=>{
  if(String(url).endsWith('/auth/v1/user')){
   if(pending){started();await unblock}
   return new Response(JSON.stringify({id:uid}),{status:200});
  }
  if(String(url).endsWith('/rest/v1/rpc/xtank_service_maintenance'))
   return new Response(JSON.stringify({enabled:false,notice:''}),{status:200});
  if(String(url).endsWith('/rest/v1/rpc/xtank_recover_abandoned_items'))
   return new Response(JSON.stringify({ok:true,recovered:0}),{status:200});
  if(String(url).endsWith('/rest/v1/rpc/xtank_player_api'))return new Response(JSON.stringify({
   profile:{player_id:uid,display_name:'AuthorizedPlayer'},
   tanks:[{tank_id:'X'}],loadouts:[],slots:[],inventory:[],upgrades:[]
  }),{status:200});
  throw Error('unexpected URL: '+url);
 };
 Object.assign(process.env,{XTANK_OFFICIAL_MODE:'1',SUPABASE_URL:'https://xtank.example.test',
  SUPABASE_SERVICE_ROLE_KEY:'service-role-secret-for-test',XTANK_SETTLEMENT_DIR:dir});
 let host=null;const clients=[];
 try{
  host=await createHost({port:0,host:'127.0.0.1'});
  const a=await dial(host.port);clients.push(a);
  a.send(JSON.stringify({type:'CREATE',accessToken:A,name:'owner',mode:'FFA',tank:'X'}));
  const original=await take(a,'JOINED');
  await new Promise(ok=>{a.once('close',ok);a.close()});
  const first=await dial(host.port),second=await dial(host.port);clients.push(first,second);
  pending=true;
  first.send(JSON.stringify({type:'RESUME',roomId:original.roomId,playerId:original.playerId,token:original.token,accessToken:A}));
  await authRequested;
  second.send(JSON.stringify({type:'RESUME',roomId:original.roomId,playerId:original.playerId,token:original.token,accessToken:A}));
  assert.equal((await take(second,'ERROR',{code:'RESUME_PENDING'})).code,'RESUME_PENDING');
  first.send(JSON.stringify({type:'RESUME',roomId:original.roomId,playerId:original.playerId,token:original.token,accessToken:A}));
  assert.equal((await take(first,'ERROR',{code:'RESUME_PENDING'})).code,'RESUME_PENDING');
  pending=false;release();
  const resumed=await take(first,'JOINED');
  assert.equal(resumed.playerId,original.playerId);
  assert.notEqual(resumed.token,original.token);
  second.send(JSON.stringify({type:'RESUME',roomId:original.roomId,playerId:original.playerId,token:original.token,accessToken:A}));
  assert.equal((await take(second,'ERROR',{code:'INVALID_SESSION'})).code,'INVALID_SESSION');
  const room=host.rooms.get(original.roomId);
  assert.equal(room.people.size,1,'slot must never be duplicated');
  // The room holds the server-side peer, not the client's ws instance.
  const peer=room.people.get(original.playerId).ws;
  assert.equal(peer._isServer,true);
  assert.equal(peer.readyState,WebSocket.OPEN);
  assert.equal(room.people.get(original.playerId).token,resumed.token);
 }finally{
  release();
  for(const ws of clients)ws.terminate();
  if(host)await host.close();
  global.fetch=previousFetch;
  for(const k of names)if(prev[k]===undefined)delete process.env[k];else process.env[k]=prev[k];
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
