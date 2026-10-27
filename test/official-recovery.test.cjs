'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {officialService}=require('../server/official.cjs');

test('durable official settlement notifies room once after database recovery',async()=>{
  const names=['XTANK_OFFICIAL_MODE','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','XTANK_SETTLEMENT_DIR'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const originalFetch=global.fetch;
  const originalNow=Date.now;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xtank-outbox-recovery-'));
  let service;
  let available=false;
  let attempts=0;
  const delivered=[];
  try{
    Object.assign(process.env,{
      XTANK_OFFICIAL_MODE:'1',
      SUPABASE_URL:'https://xtank-mock.example.test',
      SUPABASE_SERVICE_ROLE_KEY:'server-test-only',
      XTANK_SETTLEMENT_DIR:directory
    });
    global.fetch=async url=>{
      assert(String(url).endsWith('/rest/v1/rpc/xtank_record_official_match'));
      attempts++;
      return available
        ?new Response(JSON.stringify({ok:true,match_id:'db-match-recovered',players:2}),{status:200})
        :new Response(JSON.stringify({message:'temporary database outage'}),{status:503});
    };
    service=officialService({onSettlement:(payload,result)=>delivered.push({round:payload.round_id,id:result.match_id})});
    const makeTank=(id,score)=>({id,kind:'X',team:0,score,deaths:0,kills:0,assists:0,damage:0,itemsUsed:{}});
    const room={
      roundId:'recovery-round-0001',
      startedAt:Date.now()-1500,
      accountBySlot:new Map([['playerA','00000000-0000-4000-8000-000000000001'],['playerB','00000000-0000-4000-8000-000000000002']]),
      game:{ended:true,mode:'FFA',mapId:'desk',tanks:[makeTank('playerA',2),makeTank('playerB',1)],scores:[0,0]}
    };
    await assert.rejects(service.settle(room),/temporary database outage/);
    assert.equal(delivered.length,0,'unconfirmed match must never unlock lobby');
    assert.equal(fs.readdirSync(directory).filter(name=>name.endsWith('.json')).length,1,'failed result remains on disk');
    available=true;
    // Advance the retry backoff without slowing the automated suite.
    Date.now=()=>originalNow()+12000;
    try{await service.recover()}finally{Date.now=originalNow}
    assert.deepEqual(delivered,[{round:room.roundId,id:'db-match-recovered'}]);
    assert.equal(fs.readdirSync(directory).filter(name=>name.endsWith('.json')).length,0,'acknowledged result leaves outbox');
    await service.recover();
    assert.equal(delivered.length,1,'outbox recovery must not send duplicate acknowledgments');
    assert.equal(attempts,2);
  }finally{
    Date.now=originalNow;
    service?.close();
    global.fetch=originalFetch;
    for(const name of names){
      if(previous[name]===undefined)delete process.env[name];
      else process.env[name]=previous[name];
    }
    fs.rmSync(directory,{recursive:true,force:true});
  }
});
