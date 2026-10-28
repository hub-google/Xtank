'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {WebSocket}=require('ws');
const {createHost}=require('../server/host.cjs');
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function client(port){
 const ws=new WebSocket('ws://127.0.0.1:'+port);
 ws.queue=[];ws.on('message',data=>ws.queue.push(JSON.parse(String(data))));
 await new Promise((ok,fail)=>{ws.once('open',ok);ws.once('error',fail)});
 return ws;
}
function send(ws,obj){ws.send(JSON.stringify(obj))}
async function take(ws,type,predicate=()=>true,timeout=6000){
 const end=Date.now()+timeout;
 while(Date.now()<end){
  const index=ws.queue.findIndex(msg=>msg.type===type&&predicate(msg));
  if(index>=0)return ws.queue.splice(index,1)[0];
  await sleep(10);
 }
 throw Error('Timeout: '+type+', recent='+ws.queue.slice(-4).map(m=>m.type).join(','));
}
test('spectators are read-only and room hosts can moderate chat',async()=>{
 const mode=process.env.XTANK_OFFICIAL_MODE,nodeEnv=process.env.NODE_ENV;
 delete process.env.XTANK_OFFICIAL_MODE;process.env.NODE_ENV='test';
 const sockets=[];let host;
 try{
  host=await createHost({host:'127.0.0.1',port:0,testRoundSeconds:2.5});
  const a=await client(host.port),b=await client(host.port);sockets.push(a,b);
  send(a,{type:'CREATE',name:'Host',mode:'FFA',mapId:'desk',tank:'X'});
  const room=(await take(a,'JOINED')).roomId;
  send(b,{type:'JOIN',name:'Guest',mode:'FFA',roomId:room,tank:'D'});
  const joinedB=await take(b,'JOINED');
  await take(a,'LOBBY',msg=>msg.people.length===2);
  send(a,{type:'MODERATE',action:'mute',targetId:joinedB.playerId,seconds:60});
  await take(b,'ROOM_MODERATION');
  send(b,{type:'CHAT',text:'Please let me speak'});
  assert.equal((await take(b,'ERROR')).code,'ROOM_CHAT_MUTED');
  send(a,{type:'MODERATE',action:'mute',targetId:joinedB.playerId,seconds:0});
  await take(b,'ROOM_MODERATION');
  send(b,{type:'CHAT',text:'Message after unmute'});
  assert.equal((await take(a,'ROOM_CHAT')).text,'Message after unmute');
  send(a,{type:'MODERATE',action:'slowmode',milliseconds:2000});
  await take(a,'LOBBY',msg=>msg.slowModeMs===2000);
  send(a,{type:'START'});
  await take(a,'START');
  const observer=await client(host.port);sockets.push(observer);
  send(observer,{type:'SPECTATE',roomId:room});
  assert.equal((await take(observer,'JOINED')).spectator,true);
  assert.equal((await take(observer,'START')).spectator,true);
  const frame=await take(observer,'SNAPSHOT');
  assert.equal(frame.mode,'FFA');
  send(observer,{type:'INPUT',seq:1,dx:1,dz:0,aimYaw:0});
  assert.equal((await take(observer,'ERROR')).code,'SPECTATOR_READ_ONLY');
 }finally{
  for(const ws of sockets)ws.terminate();
  if(host)await host.close();
  if(mode===undefined)delete process.env.XTANK_OFFICIAL_MODE;else process.env.XTANK_OFFICIAL_MODE=mode;
  if(nodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=nodeEnv;
 }
});
