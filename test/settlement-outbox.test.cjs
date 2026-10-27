'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createSettlementOutbox}=require('../server/settlement-outbox.cjs');

test('failed official settlement remains on disk and is recovered once after process restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xtank-settlement-'));
 const payload={round_id:'test-round-outbox-1234567890',mode_id:'FFA',map_id:'desk',participants:[{player_id:'test'}]};
 let first=null,second=null,callCount=0;
 try{
  first=createSettlementOutbox({directory:dir,intervalMs:100000,
    deliver:async()=>{callCount++;throw Error('temporary database outage')}});
  await assert.rejects(()=>first.settle(payload),/temporary database outage/);
  const files=fs.readdirSync(dir);
  assert.equal(files.filter(v=>v.endsWith('.json')).length,1);
  const stored=JSON.parse(fs.readFileSync(path.join(dir,files[0]),'utf8'));
  assert.equal(stored.round_id,payload.round_id);
  first.close();
  second=createSettlementOutbox({directory:dir,intervalMs:100000,deliver:async p=>{
    callCount++;assert.equal(p.round_id,payload.round_id);
    return {ok:true,match_id:'recovered'};
  }});
  await second.retry();
  assert.equal(fs.readdirSync(dir).filter(v=>v.endsWith('.json')).length,0);
  await second.retry();
  assert.equal(callCount,2,'successful recovery must not replay again after deletion');
 }finally{
  first?.close();second?.close();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});

test('same round ID shares outbox filename and rejects malformed round IDs',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xtank-settlement-'));
 const box=createSettlementOutbox({directory:dir,intervalMs:100000,deliver:async()=>({ok:true})});
 try{
  const payload={round_id:'test-outbox-round-00002',mode_id:'TDM'};
  assert.equal(box.queue(payload),box.queue(payload));
  assert.equal(fs.readdirSync(dir).filter(x=>x.endsWith('.json')).length,1);
  assert.throws(()=>box.queue({round_id:'../'}),/Invalid round ID/);
 }finally{box.close();fs.rmSync(dir,{recursive:true,force:true})}
});
