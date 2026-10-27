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
 async function verify(){
  try{await api('overview');open.hidden=false}catch{open.hidden=true}
 }
 document.addEventListener('xtank-auth-changed',()=>{verify().catch(()=>{open.hidden=true})});
 setTimeout(()=>verify().catch(()=>{}),350);
 async function run(f){
  status('處理中…');
  try{await f();await refresh();status('操作已完成，稽核紀錄已寫入')}
  catch(e){status('操作失敗：'+e.message)}
 }
 async function refresh(){
  const d=await api('overview');
  $('#xtankAdminMain').innerHTML=
    '<p>玩家總數：'+d.total_players+'　正式場次：'+d.total_official_matches+'　未處理檢舉：'+d.unresolved_reports+'</p>'+
    '<h2>玩家檢舉</h2>'+(d.reports||[]).map(r=>'<article><strong>'+esc(r.reason)+'</strong><p>'+esc(r.details)+'／被檢舉：'+esc(r.reported_id)+'</p><small>'+esc(r.status)+'　'+esc(r.created_at)+'</small>　'+(r.status==='open'?'<button data-report="'+esc(r.report_id)+'">結案</button>':'')+'</article>').join('')+
    '<h2>停權名單</h2>'+(d.bans||[]).map(b=>'<article>玩家：'+esc(b.player_id)+'　'+esc(b.reason)+'　'+(b.revoked_at?'已解除':'仍在停權')+'</article>').join('')+
    '<h2>玩家處置</h2><form id="xtankModerationForm"><label>玩家 UUID<input name="player_id" required></label><label>操作<select name="action"><option value="suspend">停權</option><option value="unsuspend">解除停權</option></select></label><label>原因<input name="reason" minlength="5" maxlength="300" required></label><button type="submit">確認處置</button></form>';
  $('#xtankModerationForm').onsubmit=e=>{e.preventDefault();const f=e.target;run(()=>api(f.elements.action.value,{player_id:f.elements.player_id.value,reason:f.elements.reason.value}))};
  $('#xtankAdminMain').querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>run(()=>api('resolve_report',{report_id:b.dataset.report})));
 }
 open.onclick=async()=>{layer.hidden=false;status('載入中…');try{await refresh();status('')}catch(e){status(e.message)}};
}
