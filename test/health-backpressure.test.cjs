'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {WebSocket}=require('ws');
const {createHost,send,MAX_BUFFERED_BYTES}=require('../server/host.cjs');
test('slow WebSocket consumers get disconnected instead of buffering infinite authoritative snapshots',()=>{
 const closed=[],sent=[];
 const fake={readyState:WebSocket.OPEN,bufferedAmount:MAX_BUFFERED_BYTES+1,
   close:(code,msg)=>closed.push([code,msg]),send:msg=>sent.push(msg)};
 assert.equal(send(fake,{type:'SNAPSHOT'}),false);
 assert.deepEqual(closed,[[1013,'slow consumer']]);
 assert.equal(sent.length,0);
 fake.bufferedAmount=MAX_BUFFERED_BYTES-100;
 assert.equal(send(fake,{type:'PING'}),true);
 assert.deepEqual(JSON.parse(sent[0]),{type:'PING'});
 fake.readyState=WebSocket.CLOSED;
 assert.equal(send(fake,{type:'PING'}),false);
});
test('public health endpoint exposes anonymous room and capacity signals without credentials',async t=>{
 const server=await createHost({host:'127.0.0.1',port:0});
 t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.port+'/health';
 const a=await fetch(url);assert.equal(a.status,200);
 assert.equal(a.headers.get('cache-control'),'no-store');
 const initial=await a.json();
 assert.equal(initial.ok,true);assert.equal(initial.rooms,0);
 assert.equal(initial.liveMatches,0);assert.equal(initial.pendingSettlements,0);
 assert.equal(initial.connectedClients,0);
 assert(Number.isInteger(initial.rssMb)&&initial.rssMb>0);
 const client=new WebSocket('ws://127.0.0.1:'+server.port);
 t.after(()=>client.terminate());
 await new Promise((ok,fail)=>{client.once('open',ok);client.once('error',fail)});
 const active=await (await fetch(url)).json();
 assert.equal(active.connectedClients,1);
 assert(!Object.hasOwn(active,'SUPABASE_SERVICE_ROLE_KEY'));
});
