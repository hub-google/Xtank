'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {WebSocket}=require('ws');
const {createHost}=require('../server/host.cjs');
const A='a'.repeat(120),B='b'.repeat(120),aID='00000000-0000-4000-8000-000000000001',bID='00000000-0000-4000-8000-000000000002';
async function dial(url){
 const ws=new WebSocket(url);ws.messages=[];
 ws.on('message',b=>ws.messages.push(JSON.parse(String(b))));
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
 return ws;
}
const send=(ws,data)=>ws.send(JSON.stringify(data));
async function take(ws,type,timeout=4000){
 const end=Date.now()+timeout;
 while(Date.now()<end){
   const i=ws.messages.findIndex(x=>x.type===type);
   if(i>=0)return ws.messages.splice(i,1)[0];
   await new Promise(done=>setTimeout(done,12));
 }
 throw Error('Missing '+type+'; messages '+JSON.stringify(ws.messages));
}
test('official rooms require signed-in players, ready flags and server-approved equipment on reconnect',async()=>{
 const before={mode:process.env.XTANK_OFFICIAL_MODE,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,fetch:global.fetch};
 process.env.XTANK_OFFICIAL_MODE='1';
 process.env.SUPABASE_URL='https://xtank-qa.example.test';
 process.env.SUPABASE_SERVICE_ROLE_KEY='server-only-test-secret';
 global.fetch=async(url,opts)=>{
  const auth=opts.headers.authorization||'';
  const owner=auth.includes(A)?aID:bID;
  if(String(url).endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:owner}),{status:200});
  if(String(url).endsWith('/rest/v1/rpc/xtank_player_api'))return new Response(JSON.stringify({
    profile:{player_id:owner,display_name:owner===aID?'QA-A':'QA-B'},
    tanks:[{tank_id:'X'}],loadouts:[],slots:[]
  }),{status:200});
  return new Response(JSON.stringify({error:'not mocked'}),{status:404});
 };
 const sockets=[];let host=null;
 try{
  host=await createHost({host:'127.0.0.1',port:0});
  const url='ws://127.0.0.1:'+host.port;
  const a=await dial(url),b=await dial(url);sockets.push(a,b);
  send(a,{type:'CREATE',name:'Impersonator',mode:'FFA',tank:'X'});
  assert.equal((await take(a,'ERROR')).code,'AUTH_FAILED');
  send(a,{type:'CREATE',accessToken:A,name:'wrong-name',mode:'FFA',tank:'X'});
  const owner=await take(a,'JOINED');await take(a,'LOBBY');
  send(b,{type:'JOIN',accessToken:B,roomId:owner.roomId,tank:'X'});
  const second=await take(b,'JOINED');await take(b,'LOBBY');
  send(a,{type:'START'});
  assert.equal((await take(a,'ERROR')).code,'PLAYERS_NOT_READY');
  send(a,{type:'READY',ready:true});send(b,{type:'READY',ready:true});
  const ready=await take(a,'LOBBY');
  assert(ready.people.some(x=>x.name==='QA-A'&&x.ready));
  const more=await take(a,'LOBBY');
  assert(more.people.some(x=>x.name==='QA-B'&&x.ready));
  send(a,{type:'START'});
  const matchA=await take(a,'START');const matchB=await take(b,'START');
  assert.equal(matchA.official,true);assert.deepEqual(matchA.allowedWeapons,['hurricane']);
  assert.equal(matchB.official,true);
  send(b,{type:'INPUT',seq:1,dx:0,dz:0,aimYaw:0,weapon:'mine',fire:true});
  assert.equal((await take(b,'ERROR')).code,'WEAPON_NOT_OWNED');
  await new Promise(done=>{b.once('close',done);b.close()});
  const malicious=await dial(url);sockets.push(malicious);
  send(malicious,{type:'RESUME',roomId:owner.roomId,playerId:second.playerId,token:second.token,accessToken:A});
  assert.equal((await take(malicious,'ERROR')).code,'WRONG_ACCOUNT');
  const reconnect=await dial(url);sockets.push(reconnect);
  send(reconnect,{type:'RESUME',roomId:owner.roomId,playerId:second.playerId,token:second.token,accessToken:B});
  assert.equal((await take(reconnect,'JOINED')).playerId,second.playerId);
  assert.equal((await take(reconnect,'START')).official,true);
 }finally{
  for(const ws of sockets)ws.terminate();
  if(host)await host.close();
  global.fetch=before.fetch;
  for(const [key,value] of Object.entries({XTANK_OFFICIAL_MODE:before.mode,SUPABASE_URL:before.url,SUPABASE_SERVICE_ROLE_KEY:before.key})){
    if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
 }
});
