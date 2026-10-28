'use strict';
const path=require('node:path');
const {createSettlementOutbox}=require('./settlement-outbox.cjs');
// Optional trusted public-server adapter. Never enable this on a player's bundled LAN host.
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, XTANK_OFFICIAL_MODE=1 on a secured server.
function officialService({onSettlement}={}){
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
  const chatCache=new Map();
  async function chatMutedUntil(playerId){
    if(!playerId)throw Error('CHAT_IDENTITY_MISSING');
    const cached=chatCache.get(playerId);
    if(cached&&Date.now()-cached.at<10000)return cached.until;
    const policy=await request('/rest/v1/rpc/xtank_chat_restriction',
      {body:{p_player_id:playerId}});
    const until=policy.muted_until?Date.parse(policy.muted_until):0;
    if(policy.muted_until&&!Number.isFinite(until))throw Error('INVALID_CHAT_POLICY');
    chatCache.set(playerId,{at:Date.now(),until});
    if(chatCache.size>512)chatCache.delete(chatCache.keys().next().value);
    return until;
  }
  const outbox=createSettlementOutbox({
    directory:process.env.XTANK_SETTLEMENT_DIR||path.join(process.cwd(),'xtank-settlement-outbox'),
    deliver:async payload=>{
      const saved=await request('/rest/v1/rpc/xtank_record_official_match',{body:{p_result:payload}});
      // Also reports background outbox recovery, not just the immediate settle call.
      if(typeof onSettlement==='function')onSettlement(payload,saved);
      return saved;
    }
  });
  outbox.retry().catch(e=>console.error('Recover official match outbox:',e.message));
  return {
    close:()=>outbox.close(),
    outboxStats:()=>outbox.stats(),
    recover:()=>outbox.retry(),
    async recoverConsumables(){
      // Retry any durable results first. If settlement outbox files remain,
      // do not release stock, because a completed match may still be deliverable.
      await outbox.retry();
      if(outbox.hasPending())return {ok:true,skipped:'PENDING_SETTLEMENT_OUTBOX'};
      return request('/rest/v1/rpc/xtank_recover_abandoned_items',{
        body:{p_hours:72,p_limit:50}
      });
    },
    chatMutedUntil,
    async maintenanceStatus(){
      const state=await request('/rest/v1/rpc/xtank_service_maintenance',{body:{p_action:'status'}});
      if(typeof state?.enabled!=='boolean'||typeof state?.notice!=='string')
        throw Error('INVALID_MAINTENANCE_STATE');
      return {enabled:state.enabled,notice:state.notice};
    },
    async onlineModeration(playerIds){
      if(!Array.isArray(playerIds)||playerIds.length>512)throw Error('INVALID_PLAYER_IDS');
      if(!playerIds.length)return {suspended:[],muted:{}};
      return request('/rest/v1/rpc/xtank_official_online_moderation',{
        body:{p_player_ids:playerIds}
      });
    },
    async currentLoadout(playerId,tankId){
      const state=await request('/rest/v1/rpc/xtank_official_loadout_snapshot',{
        body:{p_player_id:playerId,p_tank_id:tankId}
      });
      const allowed=['hurricane','death_knight','vulcan','plasma','chemical','ion_missile','mine'];
      if(!Array.isArray(state?.weapons)||!state.weapons.length||state.weapons.length>7||
         state.weapons.some(weapon=>!allowed.includes(weapon)))
        throw Error('INVALID_ROUND_WEAPONS');
      const items={repair:0,speed_boost:0,shield_cell:0,radar_ping:0,smoke:0,team_repair:0};
      if(!state.items||typeof state.items!=='object'||Array.isArray(state.items))
        throw Error('INVALID_ROUND_ITEMS');
      for(const [key,quantity] of Object.entries(state.items)){
       if(!Object.hasOwn(items,key)||!Number.isSafeInteger(quantity)||quantity<0||quantity>30)
        throw Error('INVALID_ROUND_ITEMS');
       items[key]=quantity;
      }
      const upgrades={speed:0,attack:0,defense:0,energy:0,collision:0};
      if(!state.upgrades||typeof state.upgrades!=='object'||Array.isArray(state.upgrades))
        throw Error('INVALID_ROUND_UPGRADES');
      for(const [key,level] of Object.entries(state.upgrades)){
       if(!Object.hasOwn(upgrades,key)||!Number.isSafeInteger(level)||level<0||level>10)
        throw Error('INVALID_ROUND_UPGRADES');
       upgrades[key]=level;
      }
      return {allowedWeapons:new Set(state.weapons),itemsAvailable:items,upgrades};
    },
    async currentConsumables(playerId,tankId){
      const current=await request('/rest/v1/rpc/xtank_official_item_snapshot',{
        body:{p_player_id:playerId,p_tank_id:tankId}
      });
      const items=current?.items;
      if(!items||typeof items!=='object'||Array.isArray(items))
        throw Error('INVALID_LIVE_ITEM_SNAPSHOT');
      const result={repair:0,speed_boost:0,shield_cell:0,radar_ping:0,smoke:0,team_repair:0};
      for(const [itemId,quantity] of Object.entries(items)){
       if(!Object.hasOwn(result,itemId)||!Number.isSafeInteger(quantity)||quantity<0||quantity>30)
        throw Error('INVALID_LIVE_ITEM_SNAPSHOT');
       result[itemId]=quantity;
      }
      return result;
    },
    async reserve(roundId,playerId,items){
      // A server-only, durable escrow prevents inventory races across hosts.
      // Reserve before START, including an empty session for players without items.
      return request('/rest/v1/rpc/xtank_reserve_match_items',{
        body:{p_round_id:roundId,p_player_id:playerId,p_items:items||{}}
      });
    },
    async release(roundId){
      return request('/rest/v1/rpc/xtank_release_match_items',{body:{p_round_id:roundId}});
    },
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
      const itemsAvailable={repair:0,speed_boost:0,shield_cell:0,radar_ping:0,smoke:0,team_repair:0};
      // Only the authenticated player's selected tank loadout may supply battle consumables.
      // Owning an item in inventory alone does not mean it is equipped.
      const equippedItems=new Set(active?(dash.slots||[])
        .filter(slot=>slot.loadout_id===active.loadout_id&&slot.slot_type==='item')
        .map(slot=>slot.item_id):[]);
      for(const item of (dash.inventory||[])){
        if(equippedItems.has(item.item_id)&&Object.hasOwn(itemsAvailable,item.item_id)
          &&Number.isSafeInteger(Number(item.quantity))&&Number(item.quantity)>0)
          itemsAvailable[item.item_id]=Math.min(30,itemsAvailable[item.item_id]+Number(item.quantity));
      }
      return {player_id:u.id,name:dash.profile.display_name,
        allowedWeapons:new Set(equipment.length?equipment:['hurricane']),upgrades,itemsAvailable};
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
          damage:Math.round(t.damage||0),flag_scores:flag?t.score:0,placement:g.mode==='FFA'?rank:null,is_winner:won,
          items_used:owner?{...(t.itemsUsed||{})}:{}};
      });
      const winner=g.mode!=='FFA'&&g.scores[0]!==g.scores[1]?(g.scores[0]>g.scores[1]?0:1):null;
      const payload={round_id:room.roundId,reservation_version:'1',mode_id:g.mode,map_id:g.mapId,
        elapsed_s:Math.min(600,Math.round((Date.now()-(room.startedAt||Date.now()))/1000)),
        winning_team:winner,participants:players};
      return outbox.settle(payload);
    }
  };
}
module.exports={officialService};
