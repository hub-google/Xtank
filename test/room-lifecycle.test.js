import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {WebSocket}=require('ws');
const {createHost}=require('../server/host.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function dial(port){
  const ws=new WebSocket('ws://127.0.0.1:'+port);
  ws.inbox=[];
  ws.on('message',bytes=>ws.inbox.push(JSON.parse(String(bytes))));
  await new Promise((resolve,reject)=>{
    ws.once('open',resolve);ws.once('error',reject);
  });
  return ws;
}
async function take(ws,type,timeout=3500){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    const index=ws.inbox.findIndex(message=>message.type===type);
    if(index>=0)return ws.inbox.splice(index,1)[0];
    await sleep(10);
  }
  throw Error('No '+type+'; received: '+ws.inbox.map(x=>x.type).join(','));
}
const send=(ws,message)=>ws.send(JSON.stringify(message));

test('an orphaned active round is simulated to completion before its room is pruned',async t=>{
  const host=await createHost({host:'127.0.0.1',port:0});
  t.after(()=>host.close());
  const a=await dial(host.port);
  const b=await dial(host.port);
  t.after(()=>{a.terminate();b.terminate()});
  send(a,{type:'CREATE',name:'Host',mode:'FFA',mapId:'desk',tank:'X'});
  const first=await take(a,'JOINED');
  await take(a,'LOBBY');
  send(b,{type:'JOIN',roomId:first.roomId,name:'Guest',tank:'D'});
  await take(b,'JOINED');
  await take(b,'LOBBY');
  send(a,{type:'START'});
  await take(a,'START');
  await take(b,'START');
  const room=host.rooms.get(first.roomId);
  assert.equal(room.phase,'live');
  // Simulate the post-disconnection grace expiry without slowing tests by 30s.
  // Previously, a room older than 20s was deleted mid-round.
  room.created=Date.now()-60000;
  room.people.clear();
  await sleep(160);
  assert.equal(host.rooms.has(first.roomId),true,'live match must survive room cleanup');
  assert.equal(room.phase,'live');
  // Finish the real authoritative engine on its normal tick path.
  room.game.time=0.05;
  const deadline=Date.now()+1800;
  while(host.rooms.has(first.roomId)&&Date.now()<deadline)await sleep(20);
  assert.equal(room.game.ended,true,'game must finish normally');
  assert.equal(host.rooms.has(first.roomId),false,'finished orphan may be removed');
});

test('an expired reconnection token is rejected instead of reviving a stale session',async t=>{
  const host=await createHost({host:'127.0.0.1',port:0});
  t.after(()=>host.close());
  const first=await dial(host.port);
  t.after(()=>first.terminate());
  send(first,{type:'CREATE',name:'Host',mode:'FFA',tank:'X'});
  const joined=await take(first,'JOINED');
  await take(first,'LOBBY');
  await new Promise(resolve=>{first.once('close',resolve);first.close()});
  const room=host.rooms.get(joined.roomId);
  assert.ok(room);
  // ws.close() resolves at the client before the host has processed 'close'.
  // Wait for the authoritative session to become disconnected first.
  const deadline=Date.now()+1500;
  while(room.people.get(joined.playerId)?.ws&&Date.now()<deadline)await sleep(10);
  assert.equal(room.people.get(joined.playerId)?.ws,null,'server must observe disconnect');
  room.people.get(joined.playerId).lastSeen=Date.now()-31000;
  const retry=await dial(host.port);
  t.after(()=>retry.terminate());
  send(retry,{type:'RESUME',roomId:joined.roomId,playerId:joined.playerId,token:joined.token});
  const error=await take(retry,'ERROR');
  assert.equal(error.code,'INVALID_SESSION');
});
