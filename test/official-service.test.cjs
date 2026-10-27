'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {officialService}=require('../server/official.cjs');

test('official adapter rejects missing server-side Supabase credentials',()=>{
 const old={mode:process.env.XTANK_OFFICIAL_MODE,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY};
 try{
  process.env.XTANK_OFFICIAL_MODE='1';
  delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.throws(()=>officialService(),/secured Supabase/);
 }finally{for(const [k,v] of Object.entries({XTANK_OFFICIAL_MODE:old.mode,SUPABASE_URL:old.url,SUPABASE_SERVICE_ROLE_KEY:old.key})){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('official server authenticates player and submits only authoritative match state',async()=>{
 const prior={mode:process.env.XTANK_OFFICIAL_MODE,url:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,fetch:global.fetch};
 const calls=[];const playerA='00000000-0000-4000-8000-000000000001';const playerB='00000000-0000-4000-8000-000000000002';
 try{
  process.env.XTANK_OFFICIAL_MODE='1';process.env.SUPABASE_URL='https://qa.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key-never-ship-in-client';
  global.fetch=async(url,opts)=>{
   const path=String(url);const payload=opts.body?JSON.parse(opts.body):{};
   calls.push({path,payload,header:opts.headers.authorization});
   if(path.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:playerA}),{status:200});
   if(path.endsWith('/rest/v1/rpc/xtank_player_api'))return new Response(JSON.stringify({profile:{player_id:playerA,display_name:'QA'},tanks:[{tank_id:'X'}],
    loadouts:[{loadout_id:'11',tank_id:'X',is_selected:true}],slots:[{loadout_id:'11',slot_type:'weapon',weapon_id:'mine'}],inventory:[{weapon_id:'mine',quantity:1}]}),{status:200});
   if(path.endsWith('/rest/v1/rpc/xtank_record_official_match'))return new Response(JSON.stringify({ok:true,match_id:'match-qa'}),{status:200});
   return new Response('{}',{status:404});
  };
  const svc=officialService();
  await assert.rejects(()=>svc.authenticate('', 'X'),/LOGIN_REQUIRED/);
  await assert.rejects(()=>svc.authenticate('t'.repeat(120),'D'),/TANK_NOT_OWNED/);
  const p=await svc.authenticate('t'.repeat(120),'X');
  assert.equal(p.player_id,playerA);assert.equal(p.name,'QA');
  assert.equal(p.allowedWeapons.has('mine'),true);assert.equal(p.allowedWeapons.has('hurricane'),false);
  const room={roundId:'fixed-test-round-001',startedAt:Date.now()-12000,accountBySlot:new Map([['player',playerA],['bot0',playerB]]),
    game:{ended:true,mode:'FFA',mapId:'desk',scores:[0,0],tanks:[
    {id:'player',kind:'X',team:0,score:4,kills:4,deaths:1,assists:0,damage:123},
    {id:'bot0',kind:'D',team:1,score:2,kills:2,deaths:3,assists:0,damage:55}
   ]}};
  const result=await svc.settle(room);assert.equal(result.match_id,'match-qa');
  const body=calls.find(c=>c.path.endsWith('xtank_record_official_match')).payload.p_result;
  assert.equal(body.mode_id,'FFA');assert.equal(body.participants.length,2);
  assert.equal(body.participants[0].player_id,playerA);assert.equal(body.participants[0].is_winner,true);
  assert.equal(body.participants[1].player_id,playerB);assert.equal(body.participants[1].is_winner,false);
  assert(calls.some(c=>c.header==='Bearer test-service-key-never-ship-in-client'));
 }finally{
  global.fetch=prior.fetch;
  const vars={XTANK_OFFICIAL_MODE:prior.mode,SUPABASE_URL:prior.url,SUPABASE_SERVICE_ROLE_KEY:prior.key};
  for(const [k,v] of Object.entries(vars)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
 }
});
