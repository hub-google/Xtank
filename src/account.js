import './account.css';

const URL='https://fanffwnhkxpfhttylntw.supabase.co';
const KEY='sb_publishable_fsrieSLUXlq-_WDpPY9K_w_eO-dN_jT';
const storeKey='xtank_auth_session_v1';
const $=(selector,root=document)=>root.querySelector(selector);
let session=null, dashboard=null, catalog=null, tab='home',busy=false;
try{session=JSON.parse(localStorage.getItem(storeKey)||'null')}catch{session=null}
const launch=$('#startMenu .panel');
if(!launch)throw Error('Missing start menu for account hub');
const open=document.createElement('button');
open.id='xtankAccountOpen';open.type='button';open.textContent='玩家帳號／機庫／商店';
open.className='secondary';
launch.insertBefore(open,launch.querySelector('.online-box'));
const overlay=document.createElement('div');
overlay.id='xtankAccountOverlay';
overlay.className='xtank-account-layer';
overlay.hidden=true;
overlay.innerHTML=`<section class="xtank-account-dialog" role="dialog" aria-modal="true" aria-label="玩家帳號中心">
  <header><div><strong>X-TANK 玩家中心</strong><small>Supabase 永久玩家資料</small></div><button type="button" id="xtankAccountClose" aria-label="關閉">✕</button></header>
  <div class="xtank-account-status" id="xtankAccountStatus" role="status"></div>
  <main id="xtankAccountContent"></main>
</section>`;
document.body.append(overlay);
const content=$('#xtankAccountContent');
const status=$('#xtankAccountStatus');
const escaped=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const msg=t=>{status.textContent=String(t||'')};
const show=()=>{overlay.hidden=false;draw()};
const hide=()=>{overlay.hidden=true;msg('')};
open.addEventListener('click',show);
$('#xtankAccountClose').addEventListener('click',hide);
overlay.addEventListener('click',e=>{if(e.target===overlay)hide()});
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&!overlay.hidden){hide();e.stopPropagation()}} ,true);
function saveSession(v){session=v; if(v)localStorage.setItem(storeKey,JSON.stringify(v));else localStorage.removeItem(storeKey)}
function validSession(){return session&&session.access_token&&session.expires_at>Date.now()/1000+50}
async function rest(path,{method='POST',body,token}={}){
 const headers={'Content-Type':'application/json','apikey':KEY};
 if(token)headers.Authorization='Bearer '+token;
 const res=await fetch(URL+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 let data;try{data=await res.json()}catch{data={}}
 if(!res.ok)throw Error(data.msg||data.error_description||data.message||data.error||'HTTP '+res.status);
 return data;
}
async function getToken(){
 if(validSession())return session.access_token;
 if(!session?.refresh_token)throw Error('請先登入');
 const data=await rest('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:session.refresh_token}});
 saveSession({...data,expires_at:Math.floor(Date.now()/1000)+(data.expires_in||3600)});
 return session.access_token;
}
async function rpc(action,payload={}){
 const token=await getToken();
 return rest('/rest/v1/rpc/xtank_player_api',{body:{p_action:action,p_payload:payload},token});
}
async function signIn(email,password,signup=false){
 const route=signup?'/auth/v1/signup':'/auth/v1/token?grant_type=password';
 const data=await rest(route,{body:{email,password}});
 if(!data.access_token){msg('註冊資料已送出，請依郵件指示完成帳號驗證，再回來登入。');return}
 saveSession({...data,expires_at:Math.floor(Date.now()/1000)+(data.expires_in||3600)});
 await rpc('initialize',{});
 await reload();
 msg('登入成功，玩家資料已同步。');
}
async function reload(){
 dashboard=await rpc('dashboard');
 catalog=await rpc('catalog');
 draw();
}
function button(label,action,klass=''){
 return `<button type="button" data-action="${action}" class="${klass}">${label}</button>`;
}
function authView(){
 content.innerHTML=`<div class="xtank-auth">
 <h2>註冊／登入</h2>
 <form id="xtankAuthForm">
 <label>電子郵件<input type="email" name="email" autocomplete="email" required placeholder="player@example.com"></label>
 <label>密碼<input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
 <div class="xtank-actions"><button type="submit" name="mode" value="login">登入</button><button type="submit" name="mode" value="signup">註冊</button></div>
 </form>
 <p>遊客可直接關閉此視窗，使用既有的單機練習模式；正式資料保存需登入。</p>
 <p>測試帳號透過 Supabase 私有 `xtank.qa_credentials` 查詢，密碼不公開在 GitHub。</p></div>`;
 $('#xtankAuthForm').addEventListener('submit',e=>{
  e.preventDefault();
  const submit=e.submitter; const f=e.target;
  run(async()=>{await signIn(f.elements.email.value.trim(),f.elements.password.value,submit?.value==='signup')});
 });
}
function bar(){
 const profile=dashboard.profile,progress=dashboard.progress;
 const balance=dashboard.wallet.find(x=>x.currency_code==='COIN')?.balance??0;
 return `<div class="xtank-account-user"><strong>${escaped(profile.display_name)}</strong>
 <span>Lv. ${progress.level}</span><span>XP ${progress.total_xp}</span><span>金幣 ${balance}</span>
 <button type="button" data-action="logout">登出</button></div>
 <nav class="xtank-account-nav">${[['home','總覽'],['garage','機庫'],['inventory','背包配裝'],['shop','商店'],['rank','排行榜'],['settings','設定']].map(([id,t])=>button(t,'tab:'+id,id===tab?'active':'')).join('')}</nav>`;
}
function panel(){
 if(tab==='home')return `<h2>玩家總覽</h2><dl class="xtank-stats">${Object.entries({等級:dashboard.progress.level,經驗:dashboard.progress.total_xp,剩餘升級點:dashboard.progress.unspent_points,已玩場次:dashboard.stats.matches_played,勝場:dashboard.stats.wins,擊殺:dashboard.stats.kills}).map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
 <p>此處資料會永久保存至 Supabase；單機與玩家自架 LAN 不發放官方獎勵。</p>`;
 if(tab==='garage')return `<h2>機庫：8 種坦克</h2><div class="xtank-card-grid">${dashboard.tanks.map(x=>{
 const t=catalog.tanks.find(t=>t.tank_id===x.tank_id),levels=dashboard.upgrades.filter(u=>u.tank_id===x.tank_id);
 return `<article><h3>${escaped(x.tank_id)}-TANK · Lv.${x.level}</h3>
 <p>HP ${t?.base_hp??'-'}／護盾 ${t?.base_shield??'-'}／速度 ${t?.speed??'-'}</p>
 <p>升級：${levels.map(v=>escaped(v.attribute)+' '+v.level).join('、')||'尚未升級'}</p>
 ${button('選用此坦克','tank:'+x.tank_id)}
 <div class="xtank-upgrades">${['speed','attack','defense','energy','collision'].map(a=>button(a+' +1','upgrade:'+x.tank_id+':'+a)).join('')}</div>
 </article>`}).join('')}</div>`;
 if(tab==='inventory')return `<h2>背包及配裝</h2><p>已持有物品：</p>
 <div class="xtank-inventory">${dashboard.inventory.length?dashboard.inventory.map(x=>`<span>${escaped(x.weapon_id||x.item_id||x.cosmetic_id)} × ${x.quantity}</span>`).join(''):'目前沒有購買的物品'}</div>
 <h3>已儲存配裝</h3>${dashboard.loadouts.length?dashboard.loadouts.map(x=>`<p>${escaped(x.tank_id)} / ${escaped(x.name)} (${x.is_selected?'使用中':'未選'})</p>`).join(''):'尚未儲存配裝'}
 <p>戰鬥內仍可按數字鍵 1–7 切換武器；此處的背包持久化與武器槽限制尚需跟戰鬥伺服器同步。</p>`;
 if(tab==='shop')return `<h2>坦克軍火商店</h2><div class="xtank-card-grid">${catalog.offers.map(o=>{
 const item=catalog.weapons.find(x=>x.weapon_id===o.weapon_id)||catalog.items.find(x=>x.item_id===o.item_id);
 return `<article><h3>${escaped(item?.display_name||o.offer_key)}</h3><p>${o.unit_price} ${escaped(o.currency_code)} / ${o.quantity} 個</p>
 ${button('購買','buy:'+o.offer_id)}</article>`;}).join('')||'<p>商店暫無上架商品</p>'}</div>`;
 if(tab==='rank')return '<h2>玩家排行榜</h2><div id="xtankRankContent">讀取排行榜中…</div>';
 if(tab==='settings')return `<h2>設定</h2><form id="xtankSettingsForm">
 <label>玩家名稱<input name="name" minlength="3" maxlength="24" value="${escaped(dashboard.profile.display_name)}"></label>
 <label>主音量 (0–1)<input name="master_volume" type="number" min="0" max="1" step=".1" value="${dashboard.settings.master_volume}"></label>
 <label>滑鼠靈敏度<input name="mouse_sensitivity" type="number" min=".1" max="10" step=".1" value="${dashboard.settings.mouse_sensitivity}"></label>
 <button type="submit">儲存設定</button></form>`;
 return '';
}
function draw(){
 if(overlay.hidden)return;
 if(!session?.access_token){authView();return}
 if(!dashboard||!catalog){content.innerHTML='<p>玩家資料載入中…</p>';return}
 content.innerHTML=bar()+`<section class="xtank-account-panel">${panel()}</section>`;
 if(tab==='rank')rpc('leaderboard').then(data=>{
  const target=$('#xtankRankContent');if(target)target.innerHTML=`<ol>${(data.players||[]).map(x=>`<li>${escaped(x.display_name)}　Lv.${x.level}　勝場 ${x.wins}　擊殺 ${x.kills}</li>`).join('')}</ol>`;
 }).catch(e=>msg(e.message));
 $('#xtankSettingsForm')?.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
  const f=e.target;await rpc('rename',{name:f.elements.name.value});
  await rpc('settings',{master_volume:Number(f.elements.master_volume.value),mouse_sensitivity:Number(f.elements.mouse_sensitivity.value)});
  await reload();msg('設定已儲存');
 })});
 content.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{const parts=b.dataset.action.split(':');
 if(parts[0]==='tab'){tab=parts[1];draw();return}
 if(parts[0]==='logout'){saveSession(null);dashboard=null;catalog=null;tab='home';draw();msg('已登出');return}
 if(parts[0]==='tank'){const sel=$('#tankSelect');if(sel)sel.value=parts[1];hide();return}
 if(parts[0]==='upgrade')run(async()=>{await rpc('upgrade',{tank_id:parts[1],attribute:parts[2]});await reload();msg('坦克升級成功');return});
 if(parts[0]==='buy')run(async()=>{
  const key=crypto.randomUUID();await rpc('buy',{offer_id:parts[1],quantity:1,key});
  await reload();msg('購買成功，金幣與背包已更新');return});
 }));
}
async function run(fn){
 if(busy)return;busy=true;msg('處理中…');
 try{await fn()}catch(e){msg('操作失敗：'+(e.message||e))}finally{busy=false}
}
if(session?.access_token){getToken().then(()=>rpc('initialize',{})).then(reload).catch(()=>{saveSession(null);dashboard=null;catalog=null})}
window.xtankAccount={show,hide,refresh:reload,getSignedInPlayerId:()=>dashboard?.profile?.player_id??null};
