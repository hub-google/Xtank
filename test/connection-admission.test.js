import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {WebSocket}=require('ws');
const {createHost}=require('../server/host.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function dial(port){
 const ws=new WebSocket('ws://127.0.0.1:'+port);
 await new Promise((ok,fail)=>{ws.once('open',ok);ws.once('error',fail)});
 return ws;
}
test('rejects excess simultaneous WebSocket clients',async t=>{
 const host=await createHost({host:'127.0.0.1',port:0,maxConnections:2});
 t.after(()=>host.close());
 const [a,b]=await Promise.all([dial(host.port),dial(host.port)]);
 t.after(()=>{a.terminate();b.terminate()});
 const c=new WebSocket('ws://127.0.0.1:'+host.port);t.after(()=>c.terminate());
 const code=await new Promise((resolve,reject)=>{c.on('close',resolve);c.on('error',reject)});
 assert.equal(code,1013);
 assert.equal(a.readyState,WebSocket.OPEN);
 assert.equal(b.readyState,WebSocket.OPEN);
});
test('idle socket expires but a joined socket is retained',async t=>{
 const host=await createHost({host:'127.0.0.1',port:0,maxConnections:3,unjoinedTimeoutMs:180});
 t.after(()=>host.close());
 const idle=await dial(host.port);t.after(()=>idle.terminate());
 const joined=await dial(host.port);t.after(()=>joined.terminate());
 const inRoom=new Promise(ok=>joined.on('message',raw=>{if(JSON.parse(String(raw)).type==='JOINED')ok()}));
 joined.send(JSON.stringify({type:'CREATE',name:'tester',tank:'X'}));
 await inRoom;
 const code=await new Promise((resolve,reject)=>{idle.on('close',resolve);idle.on('error',reject)});
 assert.equal(code,1008);
 await wait(50);
 assert.equal(joined.readyState,WebSocket.OPEN);
});
test('invalid connection limits and timeouts fail validation',async()=>{
 await assert.rejects(createHost({maxConnections:0}),/INVALID_CONNECTION_CAPACITY/);
 await assert.rejects(createHost({unjoinedTimeoutMs:0}),/INVALID_JOIN_TIMEOUT/);
});
