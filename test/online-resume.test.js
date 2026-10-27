import test from 'node:test';
import assert from 'node:assert/strict';
import {OnlineConnection} from '../src/online.js';

class FakeSocket {
 static OPEN=1;
 static instances=[];
 constructor(url){this.url=url;this.readyState=0;this.sent=[];this.listeners=new Map();FakeSocket.instances.push(this);}
 addEventListener(name,callback){const callbacks=this.listeners.get(name)||[];callbacks.push(callback);this.listeners.set(name,callbacks);}
 emit(name,data){if(name==='open')this.readyState=FakeSocket.OPEN;if(name==='close')this.readyState=3;
  for(const callback of this.listeners.get(name)||[])callback({data});}
 send(raw){this.sent.push(JSON.parse(raw));}
 close(){this.readyState=3;}
}

test('official reconnection refreshes auth token instead of replaying an expired access token',async t=>{
 const previous=global.WebSocket;
 global.WebSocket=FakeSocket;FakeSocket.instances=[];
 t.after(()=>{global.WebSocket=previous});
 const seen=[];
 const c=new OnlineConnection(m=>seen.push(m),()=>{},async()=> 'fresh-jwt');
 c.open('wss://game.test',{type:'CREATE',accessToken:'expired-jwt',name:'X'});
 const initial=FakeSocket.instances[0];initial.emit('open');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(initial.sent[0].accessToken,'expired-jwt');
 initial.emit('message',JSON.stringify({type:'JOINED',roomId:'A1B2C3',playerId:'p1',token:'room-token'}));
 initial.emit('close');
 clearTimeout(c.reconnectTimer);
 c._connect(true);
 const resumed=FakeSocket.instances[1];resumed.emit('open');
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(resumed.sent[0],{type:'RESUME',roomId:'A1B2C3',playerId:'p1',token:'room-token',accessToken:'fresh-jwt'});
 c.close();
});

test('LAN guests reconnect without requiring a Supabase token',async t=>{
 const previous=global.WebSocket;global.WebSocket=FakeSocket;FakeSocket.instances=[];
 t.after(()=>{global.WebSocket=previous});
 const c=new OnlineConnection(()=>{},()=>{},async()=>{throw Error('not signed in')});
 c.open('ws://127.0.0.1:8787',{type:'JOIN',roomId:'A1B2C3'});
 const initial=FakeSocket.instances[0];initial.emit('open');
 await new Promise(resolve=>setImmediate(resolve));
 initial.emit('message',JSON.stringify({type:'JOINED',roomId:'A1B2C3',playerId:'guest',token:'guest-token'}));
 initial.emit('close');clearTimeout(c.reconnectTimer);
 c._connect(true);const resumed=FakeSocket.instances[1];resumed.emit('open');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(resumed.sent[0].accessToken,undefined);
 assert.equal(resumed.sent[0].type,'RESUME');
 c.close();
});

test('invalid official login refresh stops retries and never leaks stale token',async t=>{
 const previous=global.WebSocket;global.WebSocket=FakeSocket;FakeSocket.instances=[];
 t.after(()=>{global.WebSocket=previous});
 const statuses=[];
 const c=new OnlineConnection(()=>{},msg=>statuses.push(msg),async()=>{throw Error('refresh token revoked')});
 c.open('wss://game.test',{type:'JOIN',roomId:'A1B2C3',accessToken:'stale'});
 const initial=FakeSocket.instances[0];initial.emit('open');
 await new Promise(resolve=>setImmediate(resolve));
 initial.emit('message',JSON.stringify({type:'JOINED',roomId:'A1B2C3',playerId:'p',token:'room'}));
 initial.emit('close');clearTimeout(c.reconnectTimer);
 c._connect(true);const retry=FakeSocket.instances[1];retry.emit('open');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(retry.sent.length,0);
 assert.equal(c.manual,true);
 assert(statuses.some(x=>x.includes('重新登入')));
});
