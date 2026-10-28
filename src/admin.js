import './admin.css';
const URL='https://fanffwnhkxpfhttylntw.supabase.co/rest/v1/rpc/xtank_admin_api';
const KEY='sb_publishable_fsrieSLUXlq-_WDpPY9K_w_eO-dN_jT';
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const menu=document.querySelector('#startMenu .panel');
if(menu){
 const open=document.createElement('button');open.id='xtankAdminOpen';open.textContent='營運管理後台';open.hidden=true;
 menu.insertBefore(open,menu.querySelector('.online-box'));
 const layer=document.createElement('div');layer.className='xtank-admin-layer';layer.hidden=true;layer.id='xtankAdminLayer';
 layer.innerHTML='<section role="dialog" aria-modal="true" aria-label="營運管理後台" class="xtank-admin-dialog"><header><strong>X-TANK 營運管理</strong><button id="xtankAdminClose" type="button">關閉</button></header><p id="xtankAdminStatus" role="status"></p><main id="xtankAdminMain"></main></section>';
 document.body.append(layer);
 const $=x=>layer.querySelector(x),status=x=>$('#xtankAdminStatus').textContent=x;
 $('#xtankAdminClose').onclick=()=>layer.hidden=true;
 layer.addEventListener('click',e=>{if(e.target===layer)layer.hidden=true});
 async function api(action,payload={}){
  const token=await window.xtankAccount?.getAccessToken?.();
  if(!token)throw Error('請先登入管理員帳號');
  const res=await fetch(URL,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_payload:payload})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.message||data.error||'HTTP '+res.status);
  return data;
 }
 async function liveops(action,payload={}){
  const token=await window.xtankAccount?.getAccessToken?.();
  if(!token)throw Error('請先登入管理員');
  const res=await fetch(URL.replace('xtank_admin_api','xtank_liveops_api'),{
   method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({p_action:action,p_payload:payload})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.message||data.error||'HTTP '+res.status);
  return data;
 }
 async function compensate(payload){
  const token=await window.xtankAccount?.getAccessToken?.();
  if(!token)throw Error('請先登入管理員');
  const response=await fetch(URL.replace('xtank_admin_api','xtank_admin_compensate'),{
   method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.message||result.error||'HTTP '+response.status);
  return result;
 }
 async function maintenance(action,enabled=null,notice=''){
  const token=await window.xtankAccount?.getAccessToken?.();
  if(!token)throw Error('請先登入管理員');
  const response=await fetch(URL.replace('xtank_admin_api','xtank_service_maintenance'),{
   method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({p_action:action,p_enabled:enabled,p_notice:notice})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.message||result.error||'HTTP '+response.status);
  return result;
 }
 async function chatAdmin(action,payload={}){
  const token=await window.xtankAccount?.getAccessToken?.();
  if(!token)throw Error('請先登入管理員');
  const response=await fetch(URL.replace('xtank_admin_api','xtank_admin_chat_api'),{
   method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({p_action:action,p_payload:payload})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.message||result.error||'HTTP '+response.status);
  return result;
 }
 async function liveEditor(action,payload={}){
  const token=await window.xtankAccount?.getAccessToken?.();
  if(!token)throw Error('請先登入管理員');
  const res=await fetch(URL.replace('xtank_admin_api','xtank_liveops_editor'),{
   method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({p_action:action,p_payload:payload})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.message||data.error||'HTTP '+res.status);
  return data;
 }
 const localDateTime=iso=>{
  const d=new Date(iso),pad=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
 };
 async function verify(){
  try{await api('overview');open.hidden=false}catch{open.hidden=true}
 }
 document.addEventListener('xtank-auth-changed',()=>{verify().catch(()=>{open.hidden=true})});
 setTimeout(()=>verify().catch(()=>{}),350);
 let adminBusy=false;
 async function run(f){
  if(adminBusy)return;
  adminBusy=true;status('處理中…');
  try{await f();await refresh();status('操作已完成，稽核紀錄已寫入')}
  catch(e){status('操作失敗：'+e.message)}
  finally{adminBusy=false}
 }
 async function refresh(){
  const [d,ops,chat,audit,service]=await Promise.all([api('overview'),liveops('overview'),chatAdmin('list'),liveEditor('audit'),maintenance('status')]);
  $('#xtankAdminMain').innerHTML=
    '<p>玩家總數：'+d.total_players+'　正式場次：'+d.total_official_matches+'　未處理檢舉：'+d.unresolved_reports+'</p>'+
    '<h2>官方伺服器維護</h2><p>目前：'+(service.enabled?'維護中（禁止新玩家加入與開新對局）':'正常服務')+
    '。既有對局仍會繼續結算，不會直接取消玩家道具。</p>'+
    '<form id="xtankMaintenanceForm"><label>服務狀態<select name="enabled"><option value="false">正常服務</option>'+
    '<option value="true" '+(service.enabled?'selected':'')+'>啟用維護模式</option></select></label>'+
    '<label>公告（最多 200 字）<input name="notice" maxlength="200" value="'+esc(service.notice)+'"></label>'+
    '<button type="submit">更新官方服務狀態</button></form>'+
    '<h2>管理員經濟補償（限額、永久稽核）</h2>'+
    '<p>只支援正數的遊戲金幣／經驗補償，不直接修改餘額；資料庫會產生交易流水與管理員稽核。</p>'+
    '<form id="xtankAdminCompensation">'+
    '<label>玩家 UUID<input name="player_id" required></label>'+
    '<label>補償金幣（0～50000）<input name="coins" type="number" min="0" max="50000" value="0" required></label>'+
    '<label>補償經驗（0～20000）<input name="xp" type="number" min="0" max="20000" value="0" required></label>'+
    '<label>原因／處理單號（10～300 字）<input name="reason" minlength="10" maxlength="300" required></label>'+
    '<button type="submit">確認補償並寫入稽核</button></form>'+
    '<h2>玩家檢舉</h2>'+(d.reports||[]).map(r=>'<article><strong>'+esc(r.reason)+'</strong><p>'+esc(r.details)+'／被檢舉：'+esc(r.reported_id)+'</p><small>'+esc(r.status)+'　'+esc(r.created_at)+'</small>　'+(r.status==='open'?'<button data-report="'+esc(r.report_id)+'">結案</button>':'')+'</article>').join('')+
    '<h2>停權名單</h2>'+(d.bans||[]).map(b=>'<article>玩家：'+esc(b.player_id)+'　'+esc(b.reason)+'　'+(b.revoked_at?'已解除':'仍在停權')+'</article>').join('')+
    '<h2>玩家處置</h2><form id="xtankModerationForm"><label>玩家 UUID<input name="player_id" required></label><label>操作<select name="action"><option value="suspend">停權</option><option value="unsuspend">解除停權</option></select></label><label>原因<input name="reason" minlength="5" maxlength="300" required></label><button type="submit">確認處置</button></form>'+
    '<h2>跨房間聊天室管理</h2><p>這裡的禁言會持久保存並適用於所有官方遊戲房間（最多 7 天），不是單一房間的房主禁言。</p>'+
    '<form id="xtankGlobalMute"><label>玩家 UUID<input name="player_id" required></label>'+
    '<label>禁言分鐘數<input name="minutes" type="number" min="1" max="10080" value="60" required></label>'+
    '<label>原因（至少 5 字）<input name="reason" minlength="5" maxlength="300" required></label>'+
    '<button type="submit">啟用全域禁言</button></form>'+
    (chat.restrictions||[]).map(c=>'<article><strong>'+esc(c.display_name)+'</strong>（'+esc(c.player_id)+
     '）<p>禁言至：'+esc(c.muted_until)+'，原因：'+esc(c.reason)+'</p>'+
     '<button data-unmute="'+esc(c.player_id)+'" type="button">解除全域禁言</button></article>').join('')+
    '<h2>限時活動營運</h2><p>新活動先建立為停用，檢查後再啟用；每次操作會產生資料庫稽核紀錄。</p>'+
    '<form id="xtankCreateEvent"><label>活動代碼<input name="code" pattern="[a-z0-9-]{3,40}" required></label>'+
    '<label>活動名稱<input name="name" maxlength="80" minlength="3" required></label>'+
    '<label>計算條件<select name="kind"><option value="matches">場次</option><option value="wins">勝場</option><option value="kills">擊破</option></select></label>'+
    '<label>完成目標<input name="target" type="number" min="1" max="1000" value="3" required></label>'+
    '<label>金幣獎勵<input name="reward" type="number" min="0" max="100000" value="100" required></label>'+
    '<label>開始時間<input name="start" type="datetime-local" required></label>'+
    '<label>結束時間<input name="end" type="datetime-local" required></label>'+
    '<button type="submit">建立草稿活動</button></form>'+
    (ops.events||[]).map(e=>'<article><strong>'+esc(e.display_name)+'</strong> ('+esc(e.code)+') '+
     (e.enabled?'已上架':'未上架')+' · '+esc(e.starts_at)+'～'+esc(e.ends_at)+
     ' <button data-event-id="'+esc(e.event_id)+'" data-enable="'+(!e.enabled)+'">'+(e.enabled?'停用':'啟用')+'</button></article>').join('')+
    '<h2>商城上架管理</h2>'+
    (ops.offers||[]).map(o=>'<article>'+esc(o.offer_key)+'　'+esc(o.unit_price)+' '+esc(o.currency_code)+
     '　'+(o.enabled?'上架中':'已下架')+' <button data-offer-id="'+esc(o.offer_id)+'" data-enable="'+(!o.enabled)+'">'+
     (o.enabled?'下架':'上架')+'</button></article>').join('')+
    '<details><summary>編輯未上架活動草稿</summary><form id="xtankEditEvent">'+
      '<label>選擇活動<select name="event_id" required><option value="">選擇未啟用活動</option>'+
      (ops.events||[]).filter(e=>!e.enabled).map(e=>'<option value="'+esc(e.event_id)+'">'+esc(e.code)+'</option>').join('')+
      '</select></label><label>名稱<input name="name" maxlength="80" minlength="3" required></label>'+
      '<label>條件<select name="kind"><option value="matches">場次</option><option value="wins">勝場</option><option value="kills">擊破</option></select></label>'+
      '<label>完成目標<input name="target" type="number" min="1" max="1000" required></label>'+
      '<label>金幣獎勵<input name="reward" type="number" min="0" max="100000" required></label>'+
      '<label>開始時間<input name="start" type="datetime-local" required></label>'+
      '<label>結束時間<input name="end" type="datetime-local" required></label>'+
      '<button type="submit">儲存活動草稿</button></form></details>'+
    '<details><summary>編輯已下架商城商品</summary><form id="xtankEditOffer">'+
      '<label>選擇商品<select name="offer_id" required><option value="">選擇未上架商品</option>'+
      (ops.offers||[]).filter(o=>!o.enabled).map(o=>'<option value="'+esc(o.offer_id)+'">'+esc(o.offer_key)+'</option>').join('')+
      '</select></label><label>價格<input name="unit_price" type="number" min="0" max="100000000" required></label>'+
      '<label>總庫存限制（留空為不限）<input name="stock_limit" type="number" min="0" max="1000000"></label>'+
      '<button type="submit">儲存商品</button></form></details>'+
    '<details><summary>最近管理操作紀錄</summary>'+
      (audit.history||[]).map(a=>'<article>'+esc(a.created_at)+'　'+esc(a.operation)+'　'+esc(a.entity_type)+
      '　'+esc(a.entity_id)+'</article>').join('')+'</details>';
  const editEvent=$('#xtankEditEvent'),editOffer=$('#xtankEditOffer');
  editEvent.elements.event_id.onchange=()=>{
   const event=(ops.events||[]).find(e=>e.event_id===editEvent.elements.event_id.value);
   if(!event)return;
   editEvent.elements.name.value=event.display_name;
   editEvent.elements.kind.value=event.config?.type||'matches';
   editEvent.elements.target.value=event.config?.target||1;
   editEvent.elements.reward.value=event.config?.coin_reward||0;
   editEvent.elements.start.value=localDateTime(event.starts_at);
   editEvent.elements.end.value=localDateTime(event.ends_at);
  };
  editEvent.onsubmit=e=>{
   e.preventDefault();const a=editEvent.elements;
   run(()=>liveEditor('edit_event',{event_id:a.event_id.value,name:a.name.value,kind:a.kind.value,
     target:Number(a.target.value),reward:Number(a.reward.value),
     starts_at:new Date(a.start.value).toISOString(),ends_at:new Date(a.end.value).toISOString()}));
  };
  editOffer.elements.offer_id.onchange=()=>{
   const offer=(ops.offers||[]).find(o=>o.offer_id===editOffer.elements.offer_id.value);
   if(offer)editOffer.elements.unit_price.value=offer.unit_price;
  };
  editOffer.onsubmit=e=>{
   e.preventDefault();const a=editOffer.elements;
   run(()=>liveEditor('edit_offer',{offer_id:a.offer_id.value,
     unit_price:Number(a.unit_price.value),stock_limit:a.stock_limit.value||null}));
  };
  $('#xtankAdminCompensation').onsubmit=e=>{
   e.preventDefault();
   const form=e.target,coins=Number(form.elements.coins.value),xp=Number(form.elements.xp.value);
   if(!Number.isSafeInteger(coins)||!Number.isSafeInteger(xp)||coins+xp<=0){
    status('補償金幣或經驗至少需有一項大於零');return;
   }
   if(!confirm('確定補償玩家 '+form.elements.player_id.value+'：金幣 '+coins+'／經驗 '+xp+'？此操作將永久記錄。'))return;
   const requestId=crypto.randomUUID();
   run(()=>compensate({p_player_id:form.elements.player_id.value,
    p_coins:coins,p_xp:xp,p_reason:form.elements.reason.value.trim(),p_request_id:requestId}));
  };
  $('#xtankMaintenanceForm').onsubmit=e=>{
   e.preventDefault();
   const form=e.target;
   if(!confirm('確定變更官方服務狀態？這會影響新玩家加入或開局。'))return;
   run(()=>maintenance('set',form.elements.enabled.value==='true',form.elements.notice.value.trim()));
  };
  $('#xtankModerationForm').onsubmit=e=>{e.preventDefault();const f=e.target;run(()=>api(f.elements.action.value,{player_id:f.elements.player_id.value,reason:f.elements.reason.value}))};
  $('#xtankAdminMain').querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>run(()=>api('resolve_report',{report_id:b.dataset.report})));
  $('#xtankGlobalMute').onsubmit=e=>{
   e.preventDefault();const form=e.target;
   run(()=>chatAdmin('mute',{player_id:form.elements.player_id.value,
     minutes:Number(form.elements.minutes.value),reason:form.elements.reason.value}));
  };
  $('#xtankAdminMain').querySelectorAll('[data-unmute]').forEach(button=>button.onclick=()=>{
   if(!confirm('解除該玩家所有官方房間的禁言？'))return;
   run(()=>chatAdmin('unmute',{player_id:button.dataset.unmute}));
  });
  $('#xtankCreateEvent').onsubmit=e=>{e.preventDefault();const f=e.target;
   run(()=>liveops('create_event',{code:f.elements.code.value,name:f.elements.name.value,kind:f.elements.kind.value,
      target:Number(f.elements.target.value),reward:Number(f.elements.reward.value),
      starts_at:new Date(f.elements.start.value).toISOString(),ends_at:new Date(f.elements.end.value).toISOString()}));
  };
  $('#xtankAdminMain').querySelectorAll('[data-event-id]').forEach(b=>b.onclick=()=>{
   if(!confirm('確認修改活動上架狀態？'))return;
   run(()=>liveops('toggle_event',{event_id:b.dataset.eventId,enabled:b.dataset.enable==='true'}));
  });
  $('#xtankAdminMain').querySelectorAll('[data-offer-id]').forEach(b=>b.onclick=()=>{
   if(!confirm('確認修改商城商品上架狀態？'))return;
   run(()=>liveops('toggle_offer',{offer_id:b.dataset.offerId,enabled:b.dataset.enable==='true'}));
  });
 }
 open.onclick=async()=>{layer.hidden=false;status('載入中…');try{await refresh();status('')}catch(e){status(e.message)}};
}
