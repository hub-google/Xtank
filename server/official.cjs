'use strict';
const path=require('node:path');
const {createSettlementOutbox}=require('./settlement-outbox.cjs');
// Optional trusted public-server adapter. Never enable this on a player's bundled LAN host.
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, XTANK_OFFICIAL_MODE=1 on a secured server.
function officialService(){
  if(process.env.XTANK_OFFICIAL_MODE!=='1')return null;
  const origin=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!origin.startsWith('https://')||!secret)throw Error('Official X-TANK server requires a secured Supabase URL and service key');
  const jsonHeaders={'content-type':'application/json',apikey:secret};
  async function request(path,{token=secret,method='POST',body}={}){
    const r=await fetch(origin+path,{method,headers:{...jsonHeaders,authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    let v={};try{v=await r.json()}catch{}
    if(!r.ok)throw Error((v?.message||v?.error_description||'Supabase request failed')+' ('+r.status+')');
    return v;
  }
  const outbox=createSettlementOutbox({
    directory:process.env.XTANK_SETTLEMENT_DIR||path.join(process.cwd(),'xtank-settlement-outbox'),
    deliver:payload=>request('/rest/v1/rpc/xtank_record_official_match',{body:{p_result:payload}})
  });
  outbox.retry().catch(e=>console.error('Recover official match outbox:',e.message));
  return {
    close:()=>outbox.close(),
    recover:()=>outbox.retry(),
    async authenticate(token,tankId){
      if(typeof token!=='string'||token.length<80)throw Error('LOGIN_REQUIRED');
      const u=await request('/auth/v1/user',{token,method:'GET'});
      if(!u.id)throw Error('INVALID_LOGIN');
      const dash=await request('/rest/v1/rpc/xtank_player_api',{token,body:{p_action:'dashboard',p_payload:{}}});
      if(dash.profile?.player_id!==u.id)throw Error('UNAUTHORIZED_PLAYER');
      if(!dash.tanks?.some(t=>t.tank_id===tankId))throw Error('TANK_NOT_OWNED');
      const active=dash.loadouts?.find(l=>l.tank_id===tankId&&l.is_selected);
      const equipment=active?dash.slots.filter(s=>s.loadout_id===active.loadout_id&&s.slot_type==='weapon').map(s=>s.weapon_id):['hurricane'];
      const free=new Set(['hurricane','death_knight','vulcan','plasma']);
      const owned=new Set((dash.inventory||[]).filter(v=>v.quantity>0&&v.weapon_id).map(v=>v.weapon_id));
      if(equipment.some(weapon=>!free.has(weapon)&&!owned.has(weapon)))
        throw Error('LOADOUT_WEAPON_NOT_OWNED');
      const upgrades={speed:0,attack:0,defense:0,energy:0,collision:0};
      for(const v of (dash.upgrades||[])){
        if(v.tank_id===tankId&&Object.hasOwn(upgrades,v.attribute)&&Number.isInteger(v.level))
          upgrades[v.attribute]=Math.max(0,Math.min(10,v.level));
      }
      return {player_id:u.id,name:dash.profile.display_name,
        allowedWeapons:new Set(equipment.length?equipment:['hurricane']),upgrades};
    },
    async settle(room){
      const g=room.game;
      if(!g||!g.ended)throw Error('MATCH_NOT_COMPLETE');
      const players=g.tanks.map((t,i)=>{
        const owner=room.accountBySlot?.get(t.id);
        const ffa=[...g.tanks].sort((a,b)=>b.score-a.score||a.deaths-b.deaths||b.damage-a.damage);
        const rank=ffa.findIndex(x=>x.id===t.id)+1;
        const flag=g.mode==='FLAG_HOLD';
        const won=g.mode==='FFA'?rank===1:g.scores[t.team]===g.scores[1-t.team]?null:g.scores[t.team]>g.scores[1-t.team];
        return {slot:i+1,player_id:owner||null,tank_id:t.kind,team:t.team,kills:t.kills,deaths:t.deaths,assists:t.assists||0,
          damage:Math.round(t.damage||0),flag_scores:flag?t.score:0,placement:g.mode==='FFA'?rank:null,is_winner:won};
      });
      const winner=g.mode!=='FFA'&&g.scores[0]!==g.scores[1]?(g.scores[0]>g.scores[1]?0:1):null;
      const payload={round_id:room.roundId,mode_id:g.mode,map_id:g.mapId,
        elapsed_s:Math.min(600,Math.round((Date.now()-(room.startedAt||Date.now()))/1000)),
        winning_team:winner,participants:players};
      return outbox.settle(payload);
    }
  };
}
module.exports={officialService};
