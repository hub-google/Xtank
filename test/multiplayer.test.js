import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {WebSocket}=require('ws');
const {createHost,sanitizeInput}=require('../server/host.cjs');

async function connect(url){
 return new Promise((resolve,reject)=>{
  const ws=new WebSocket(url);
  ws.messages=[];
  ws.on('message',raw=>ws.messages.push(JSON.parse(String(raw))));
  ws.once('open',()=>resolve(ws));ws.once('error',reject);
 });
}
async function message(ws,type,timeout=4000){
 const started=Date.now();
 while(Date.now()-started<timeout){
  const index=ws.messages.findIndex(m=>m.type===type);
  if(index>=0)return ws.messages.splice(index,1)[0];
  await new Promise(ok=>setTimeout(ok,10));
 }
 throw Error('Timed out for '+type+'; queued: '+ws.messages.map(m=>m.type).join(','));
}
function send(ws,msg){ws.send(JSON.stringify(msg));}
test('LAN room supports two players, real authoritative game, invalid input rejected',async t=>{
 const host=await createHost({host:'127.0.0.1',port:0});
 t.after(async()=>await host.close());
 const a=await connect('ws://127.0.0.1:'+host.port);
 const b=await connect('ws://127.0.0.1:'+host.port);
 t.after(()=>{a.terminate();b.terminate();});
 send(a,{type:'CREATE',name:'Alpha',tank:'D',mode:'FFA',mapId:'chess'});
 const first=await message(a,'JOINED');
 assert.match(first.roomId,/^[0-9A-F]{6}$/);
 await message(a,'LOBBY');
 send(b,{type:'JOIN',roomId:first.roomId,name:'Beta',tank:'R'});
 await message(b,'JOINED');
 const lobby=await message(a,'LOBBY');
 assert.equal(lobby.people.length,2);
 assert.equal(lobby.mapId,'chess');
 await message(b,'LOBBY');
 send(b,{type:'START'});assert.equal((await message(b,'ERROR')).code,'NOT_HOST_OR_PHASE');
 send(a,{type:'START'});
 const startedA=await message(a,'START'),startedB=await message(b,'START');
 assert.notEqual(startedA.slotId,startedB.slotId);
 assert.equal(startedA.mapId,'chess');assert.equal(startedB.mapId,'chess');
 const shotA=await message(a,'SNAPSHOT'),shotB=await message(b,'SNAPSHOT');
 assert.equal(shotA.tanks.length,8);assert.equal(shotB.tanks.length,8);
 assert.equal(shotA.mapId,'chess');assert.equal(shotB.mapId,'chess');
 assert.ok(shotA.tanks.some(p=>p.id===startedA.slotId&&p.kind==='D'));
 assert.ok(shotA.tanks.some(p=>p.id===startedB.slotId&&p.kind==='R'));
 send(b,{type:'INPUT',seq:1,dx:500,dz:0,aimYaw:0,fire:false,x:47,score:999});
 assert.equal((await message(b,'ERROR')).code,'INVALID_INPUT');
 const before=shotB.tanks.find(p=>p.id===startedB.slotId);
 send(b,{type:'INPUT',seq:2,dx:1,dz:0,aimYaw:0,weapon:'vulcan',fire:true,score:999,hp:999});
 await new Promise(ok=>setTimeout(ok,330));
 const shots=b.messages.filter(x=>x.type==='SNAPSHOT');
 assert.ok(shots.length>0);
 const latest=shots.at(-1).tanks.find(p=>p.id===startedB.slotId);
 assert.ok(latest.x>before.x,'expected movement: '+before.x+' to '+latest.x);
 assert.ok(latest.x<before.x+5);
 assert.notEqual(latest.hp,999);
 assert.equal(latest.weapon,'vulcan');
});
test('invalid inputs and injected packet fields never become trusted authority',()=>{
 assert.equal(sanitizeInput({dx:NaN,dz:0,aimYaw:0}),null);
 assert.equal(sanitizeInput({dx:0,dz:0,aimYaw:Infinity}),null);
 assert.equal(sanitizeInput({dx:20,dz:0,aimYaw:0}),null);
 assert.equal(sanitizeInput({dx:0,dz:0,aimYaw:0,weapon:'cheat'}).weapon,undefined);
});

test('eight real WebSocket clients occupy unique slots; ninth denied; session resumes',async t=>{
 const host=await createHost({host:'127.0.0.1',port:0});
 t.after(async()=>host.close());
 const url='ws://127.0.0.1:'+host.port;
 const clients=[];
 t.after(()=>clients.forEach(ws=>ws.terminate()));
 const owner=await connect(url);clients.push(owner);
 send(owner,{type:'CREATE',name:'Host',mode:'TDM',tank:'X'});
 const info=await message(owner,'JOINED');await message(owner,'LOBBY');
 const joined=[info];
 for(let i=1;i<8;i++){
  const ws=await connect(url);clients.push(ws);
  send(ws,{type:'JOIN',roomId:info.roomId,name:'Human'+i,tank:'D'});
  joined.push(await message(ws,'JOINED'));
  await message(ws,'LOBBY');
 }
 const ninth=await connect(url);clients.push(ninth);
 send(ninth,{type:'JOIN',roomId:info.roomId,name:'Extra'});
 assert.equal((await message(ninth,'ERROR')).code,'ROOM_FULL');
 send(owner,{type:'START'});
 const slots=[];
 for(const ws of clients.slice(0,8))slots.push((await message(ws,'START')).slotId);
 assert.equal(new Set(slots).size,8);
 const frame=await message(owner,'SNAPSHOT');
 assert.equal(frame.tanks.length,8);
 // Resume after a deliberate connection loss and invalidate the old transport.
 const old=clients[1];
 await new Promise(resolve=>{old.once('close',resolve);old.close();});
 const replacement=await connect(url);clients.push(replacement);
 send(replacement,{type:'RESUME',roomId:info.roomId,playerId:joined[1].playerId,token:joined[1].token});
 const resumed=await message(replacement,'JOINED');
 assert.equal(resumed.playerId,joined[1].playerId);
 assert.notEqual(resumed.token,joined[1].token);
 assert.equal((await message(replacement,'START')).slotId,slots[1]);
 const latest=await message(replacement,'SNAPSHOT');
 assert.equal(latest.tanks.length,8);
});

test('public room directory hides password rooms and ready state broadcasts without exposing passwords',async t=>{
 const host=await createHost({host:'127.0.0.1',port:0});
 t.after(async()=>host.close());
 const url='ws://127.0.0.1:'+host.port;
 const sockets=[];
 const dial=async()=>{const s=await connect(url);sockets.push(s);return s;};
 t.after(()=>sockets.forEach(s=>s.terminate()));
 const pub=await dial(),priv=await dial(),viewer=await dial(),joiner=await dial();
 send(pub,{type:'CREATE',name:'Open',tank:'X',mode:'FFA',mapId:'desk'});
 const publicRoom=await message(pub,'JOINED');await message(pub,'LOBBY');
 send(priv,{type:'CREATE',name:'Private',tank:'D',mode:'TDM',mapId:'chess',password:'very-secret-phrase'});
 const privateRoom=await message(priv,'JOINED');
 const privateLobby=await message(priv,'LOBBY');
 assert.equal(JSON.stringify(privateLobby).includes('very-secret-phrase'),false);
 send(viewer,{type:'LIST_ROOMS'});
 const directory=await message(viewer,'ROOMS');
 assert(directory.rooms.some(r=>r.roomId===publicRoom.roomId),'public room is listed');
 assert(!directory.rooms.some(r=>r.roomId===privateRoom.roomId),'password-protected room is hidden');
 send(joiner,{type:'JOIN',roomId:privateRoom.roomId,password:'wrong-password',name:'Guest'});
 assert.equal((await message(joiner,'ERROR')).code,'BAD_ROOM_PASSWORD');
 send(joiner,{type:'JOIN',roomId:privateRoom.roomId,password:'very-secret-phrase',name:'Guest'});
 assert.equal((await message(joiner,'JOINED')).roomId,privateRoom.roomId);
 const lobby=await message(joiner,'LOBBY');
 assert(lobby.people.some(x=>x.name==='Guest'&&!x.ready));
 send(joiner,{type:'READY',ready:true});
 const ready=await message(joiner,'LOBBY');
 assert(ready.people.some(x=>x.name==='Guest'&&x.ready));
 assert.equal(JSON.stringify(ready).includes('very-secret-phrase'),false);
 send(joiner,{type:'READY',ready:false});
 const unready=await message(joiner,'LOBBY');
 assert(unready.people.some(x=>x.name==='Guest'&&!x.ready));
});

test('quick match joins the busiest compatible public room and creates a new room for a different map',async t=>{
 const host=await createHost({host:'127.0.0.1',port:0});
 t.after(async()=>host.close());
 const url='ws://127.0.0.1:'+host.port;
 const clients=await Promise.all([connect(url),connect(url),connect(url)]);
 t.after(()=>clients.forEach(c=>c.terminate()));
 const [a,b,c]=clients;
 send(a,{type:'QUICK_MATCH',name:'QuickA',mode:'TDM',mapId:'chess',tank:'X'});
 const first=await message(a,'JOINED');await message(a,'LOBBY');
 send(b,{type:'QUICK_MATCH',name:'QuickB',mode:'TDM',mapId:'chess',tank:'D'});
 const second=await message(b,'JOINED');
 assert.equal(second.roomId,first.roomId);
 const updated=await message(a,'LOBBY');
 assert.equal(updated.people.length,2);
 send(c,{type:'QUICK_MATCH',name:'QuickC',mode:'TDM',mapId:'desk',tank:'R'});
 const third=await message(c,'JOINED');
 assert.notEqual(third.roomId,first.roomId);
});

test('room lobby chat delivers escaped text to players, refuses invalid content and throttles spam',async t=>{
 const host=await createHost({host:'127.0.0.1',port:0});
 t.after(async()=>host.close());
 const url='ws://127.0.0.1:'+host.port;
 const a=await connect(url),b=await connect(url);
 t.after(()=>{a.terminate();b.terminate()});
 send(a,{type:'CREATE',name:'RoomHost',tank:'X',mode:'FFA'});
 const joined=await message(a,'JOINED');await message(a,'LOBBY');
 send(b,{type:'JOIN',roomId:joined.roomId,name:'Guest',tank:'X'});
 await message(b,'JOINED');await message(b,'LOBBY');await message(a,'LOBBY');
 const safeText='<script>alert(1)</script>';
 send(a,{type:'CHAT',text:safeText});
 const x=await message(a,'ROOM_CHAT'),y=await message(b,'ROOM_CHAT');
 assert.equal(x.text,safeText);assert.equal(y.text,safeText);
 assert.equal(x.name,'RoomHost');
 send(a,{type:'CHAT',text:'quick spam'});
 assert.equal((await message(a,'ERROR')).code,'CHAT_RATE_LIMIT');
 send(b,{type:'CHAT',text:'bad\nline'});
 assert.equal((await message(b,'ERROR')).code,'INVALID_CHAT');
});
