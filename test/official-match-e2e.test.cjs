'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {WebSocket}=require('ws');
const {createHost}=require('../server/host.cjs');

const A='a'.repeat(120),B='b'.repeat(120);
const UID_A='00000000-0000-4000-8000-000000000001';
const UID_B='00000000-0000-4000-8000-000000000002';
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function connect(url){
 const socket=new WebSocket(url);socket.queue=[];
 socket.on('message',raw=>socket.queue.push(JSON.parse(String(raw))));
 await new Promise((done,reject)=>{socket.once('open',done);socket.once('error',reject)});
 return socket;
}
function send(socket,msg){socket.send(JSON.stringify(msg))}
async function waitFor(socket,type,{timeout=6000,check=()=>true}={}){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  const i=socket.queue.findIndex(m=>m.type===type&&check(m));
  if(i>=0)return socket.queue.splice(i,1)[0];
  await sleep(10);
 }
 throw Error('Timeout waiting for '+type+'; last messages '+socket.queue.slice(-6).map(x=>x.type));
}
test('two authenticated WebSocket players naturally finish a short official match, persist once, and receive DB acknowledgment',async()=>{
 const keys=['NODE_ENV','XTANK_OFFICIAL_MODE','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','XTANK_SETTLEMENT_DIR'];
 const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const oldFetch=global.fetch,dir=fs.mkdtempSync(path.join(os.tmpdir(),'xtank-wss-e2e-'));
 const settlements=[];const sockets=[];let host=null;
 try{
  Object.assign(process.env,{NODE_ENV:'test',XTANK_OFFICIAL_MODE:'1',SUPABASE_URL:'https://xtank-qa.example.test',
   SUPABASE_SERVICE_ROLE_KEY:'server-only-fake-secret',XTANK_SETTLEMENT_DIR:dir});
  global.fetch=async(url,opts)=>{
   const endpoint=String(url);
   const bearer=opts.headers.authorization||'';
   const player=bearer.includes(A)?UID_A:UID_B;
   if(endpoint.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:player}),{status:200});
   if(endpoint.endsWith('/rest/v1/rpc/xtank_player_api'))return new Response(JSON.stringify({
    profile:{player_id:player,display_name:player===UID_A?'QA-A':'QA-B'},
    tanks:[{tank_id:'X'}],loadouts:[],slots:[]
   }),{status:200});
   if(endpoint.endsWith('/rest/v1/rpc/xtank_record_official_match')){
    const body=JSON.parse(opts.body).p_result;
    settlements.push(body);
    return new Response(JSON.stringify({ok:true,match_id:'synthetic-db-match-e2e',players:2,replayed:false}),{status:200});
   }
   return new Response(JSON.stringify({error:'unexpected mock endpoint'}),{status:404});
  };
  await assert.rejects(createHost({port:0,testRoundSeconds:0}),/TEST_ROUND_SECONDS_FORBIDDEN/);
  host=await createHost({host:'127.0.0.1',port:0,testRoundSeconds:1.5});
  const url='ws://127.0.0.1:'+host.port;
  const a=await connect(url),b=await connect(url);sockets.push(a,b);
  send(a,{type:'CREATE',accessToken:A,mode:'FFA',mapId:'desk',tank:'X',name:'forged-name'});
  const joinedA=await waitFor(a,'JOINED');
  await waitFor(a,'LOBBY');
  send(b,{type:'JOIN',accessToken:B,roomId:joinedA.roomId,tank:'X'});
  const joinedB=await waitFor(b,'JOINED');
  await waitFor(b,'LOBBY');
  await waitFor(a,'LOBBY',{check:m=>m.people.length===2});
  send(a,{type:'READY',ready:true});
  await waitFor(a,'LOBBY',{check:m=>m.people.some(p=>p.name==='QA-A'&&p.ready)});
  send(b,{type:'READY',ready:true});
  await waitFor(a,'LOBBY',{check:m=>m.people.every(p=>p.ready)});
  send(a,{type:'START'});
  const gameA=await waitFor(a,'START'),gameB=await waitFor(b,'START');
  assert.equal(gameA.official,true);assert.equal(gameB.official,true);
  assert.notEqual(gameA.slotId,gameB.slotId);
  const ended=await waitFor(a,'SNAPSHOT',{timeout:6000,check:s=>s.ended===true});
  assert.equal(ended.roundId,gameA.roundId);
  assert(ended.tick>=1.4,'simulated time advanced through real game ticks');
  const resultA=await waitFor(a,'MATCH_SAVED',{timeout:6000});
  const resultB=await waitFor(b,'MATCH_SAVED',{timeout:6000});
  assert.equal(resultA.matchId,'synthetic-db-match-e2e');
  assert.equal(resultB.matchId,resultA.matchId);
  assert.equal(settlements.length,1,'match must be delivered exactly once when DB works');
  const payload=settlements[0];
  assert.equal(payload.round_id,gameA.roundId);
  assert.equal(payload.mode_id,'FFA');assert.equal(payload.map_id,'desk');
  assert.equal(payload.participants.length,8);
  assert(payload.participants.some(p=>p.player_id===UID_A));
  assert(payload.participants.some(p=>p.player_id===UID_B));
  assert.equal(fs.readdirSync(dir).filter(f=>f.endsWith('.json')).length,0,'successful delivery clears durable outbox');
 }finally{
  for(const ws of sockets)ws.terminate();
  if(host)await host.close();
  global.fetch=oldFetch;
  for(const k of keys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k]}
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
