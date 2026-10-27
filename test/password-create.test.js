import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {WebSocket}=require('ws');
const {createHost}=require('../server/host.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function dial(port){
 const socket=new WebSocket('ws://127.0.0.1:'+port);
 socket.messages=[];
 socket.on('message',data=>socket.messages.push(JSON.parse(String(data))));
 await new Promise((ok,fail)=>{socket.once('open',ok);socket.once('error',fail)});
 return socket;
}
async function take(socket,type){
 for(let i=0;i<450;i++){
  const n=socket.messages.findIndex(message=>message.type===type);
  if(n>=0)return socket.messages.splice(n,1)[0];
  await sleep(10);
 }
 throw Error('Missing '+type+': '+JSON.stringify(socket.messages));
}
const send=(socket,message)=>socket.send(JSON.stringify(message));
test('creating a password-protected room is asynchronous and race-safe',async t=>{
 const host=await createHost({host:'127.0.0.1',port:0});
 t.after(()=>host.close());
 const owner=await dial(host.port);t.after(()=>owner.terminate());
 send(owner,{type:'CREATE',name:'owner',tank:'X',mode:'FFA',password:'safe-room-password'});
 send(owner,{type:'CREATE',name:'second',tank:'X',mode:'FFA',password:'other'});
 assert.equal((await take(owner,'ERROR')).code,'CREATE_PENDING');
 const joined=await take(owner,'JOINED');
 const room=host.rooms.get(joined.roomId);
 assert(room?.password?.hash instanceof Buffer);
 assert.equal(room.password.hash.length,32);
 assert.equal(room.people.size,1);
 const guest=await dial(host.port);t.after(()=>guest.terminate());
 send(guest,{type:'JOIN',roomId:joined.roomId,name:'guest',tank:'D',password:'safe-room-password'});
 assert.equal((await take(guest,'JOINED')).roomId,joined.roomId);
});
test('private room creation does not stop authoritative combat simulation',async t=>{
 const host=await createHost({host:'127.0.0.1',port:0});
 t.after(()=>host.close());
 const [a,b]=await Promise.all([dial(host.port),dial(host.port)]);
 t.after(()=>{a.terminate();b.terminate()});
 send(a,{type:'CREATE',name:'A',tank:'X',mode:'FFA'});
 const roomId=(await take(a,'JOINED')).roomId;
 send(b,{type:'JOIN',roomId,name:'B',tank:'X'});
 await take(b,'JOINED');
 send(a,{type:'START'});await take(a,'START');
 const startTick=host.rooms.get(roomId).game.tick;
 const outsiders=await Promise.all(Array.from({length:8},()=>dial(host.port)));
 t.after(()=>outsiders.forEach(s=>s.terminate()));
 outsiders.forEach((socket,i)=>send(socket,{type:'CREATE',name:'Private'+i,tank:'X',mode:'FFA',password:'long-key-'+i}));
 await Promise.all(outsiders.map(socket=>take(socket,'JOINED')));
 assert(host.rooms.get(roomId).game.tick>startTick,'20Hz combat clock must continue while keys are hashed');
});
