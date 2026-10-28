import './account.css';
import {mountGaragePreview} from './garage-preview.js';
import {loadBindings} from './controls.js';

const URL='https://fanffwnhkxpfhttylntw.supabase.co';
const KEY='sb_publishable_fsrieSLUXlq-_WDpPY9K_w_eO-dN_jT';
const storeKey='xtank_auth_session_v1';
const $=(selector,root=document)=>root.querySelector(selector);
let session=null, dashboard=null, catalog=null, tab='home',busy=false,rankMode='FFA';
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
let disposeGaragePreview=null;
const status=$('#xtankAccountStatus');
const escaped=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const msg=t=>{status.textContent=String(t||'')};
const show=()=>{overlay.hidden=false;draw()};
const hide=()=>{
 if(disposeGaragePreview){disposeGaragePreview();disposeGaragePreview=null;}
 overlay.hidden=true;msg('');
};
open.addEventListener('click',show);
$('#xtankAccountClose').addEventListener('click',hide);
overlay.addEventListener('click',e=>{if(e.target===overlay)hide()});
window.addEventListener('keydown',e=>{if(e.code==='Escape'&&!overlay.hidden){hide();e.stopPropagation()}} ,true);
function saveSession(v){session=v; if(v)localStorage.setItem(storeKey,JSON.stringify(v));else localStorage.removeItem(storeKey);document.dispatchEvent(new CustomEvent('xtank-auth-changed'));}
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
 saveSession({...data,user:data.user||session.user,needsAccountUpgrade:session.needsAccountUpgrade===true,
  expires_at:Math.floor(Date.now()/1000)+(data.expires_in||3600)});
 return session.access_token;
}
async function rpc(action,payload={}){
 const token=await getToken();
 return rest('/rest/v1/rpc/xtank_player_api',{body:{p_action:action,p_payload:payload},token});
}
async function rpcNamed(name,args={}){
 const token=await getToken();
 return rest('/rest/v1/rpc/'+name,{body:args,token});
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
 // Import a guest's existing local bindings the first time this account has no cloud mapping.
 if(dashboard.settings&&Object.keys(dashboard.settings.keybindings||{}).length===0){
  try{
   const local=loadBindings(window.localStorage);
   await rpcNamed('xtank_save_keybindings',{p_bindings:local});
   dashboard.settings.keybindings=local;
  }catch(error){console.warn('雲端快捷鍵初始同步未完成：',error.message)}
 }
 const nick=$('#playerName');if(nick&&nick.value==='Player')nick.value=dashboard.profile.display_name;
 catalog=await rpc('catalog');
 window.xtankAudio?.setMasterVolume?.(dashboard.settings?.master_volume??0.7);
 document.dispatchEvent(new CustomEvent('xtank-player-preferences',{detail:{
  graphics_quality:dashboard.settings?.graphics_quality,
  keybindings:dashboard.settings?.keybindings
 }}));
 draw();
}
async function savePreferences(patch){
 if(!session?.access_token)return false;
 await rpc('settings',patch);
 if(dashboard?.settings)Object.assign(dashboard.settings,patch);
 return true;
}
async function saveCloudBindings(bindings){
 if(!session?.access_token)return false;
 await rpcNamed('xtank_save_keybindings',{p_bindings:bindings});
 if(dashboard?.settings)dashboard.settings.keybindings={...bindings};
 return true;
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
 <button type="button" id="xtankRecoverPassword">忘記密碼（寄送重設郵件）</button>
  <button type="button" id="xtankGuestContinue">以遊客身分練習（不保存正式戰績）</button>
 <button type="button" id="xtankAnonymousAccount">建立可升級的匿名遊客帳號（需啟用匿名登入）</button>
 <p>遊客可以單機練習；帳號登入後才會永久保存坦克、金幣、背包資料。</p>
 <p>測試帳號透過 Supabase 私有 QA 資料表查詢，密碼不公開在 GitHub。</p></div>`;
 $('#xtankGuestContinue').addEventListener('click',hide);
 $('#xtankAnonymousAccount').addEventListener('click',()=>run(async()=>{
  const data=await rest('/auth/v1/signup',{body:{}});
  if(!data.access_token||!data.user?.id||data.user?.is_anonymous!==true)
    throw Error('匿名登入尚未在專案啟用，請先使用本機遊客練習');
  saveSession({...data,needsAccountUpgrade:true,expires_at:Math.floor(Date.now()/1000)+(data.expires_in||3600)});
  await rpc('initialize',{});
  await reload();
  msg('匿名玩家資料已建立。請在登出或換裝置前，先將帳號升級並完成信箱驗證。');
 }));
 $('#xtankRecoverPassword').addEventListener('click',()=>run(async()=>{
  const email=$('#xtankAuthForm input[name=email]').value.trim();
  if(!email||!email.includes('@'))throw Error('請先輸入電子郵件');
  await rest('/auth/v1/recover',{body:{email}});
  msg('若帳號存在，密碼重設郵件已寄出。');
 }));
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
 <nav class="xtank-account-nav">${[...[['home','總覽'],['garage','機庫'],['inventory','背包配裝'],['shop','商店'],['ledger','交易紀錄'],['rank','排行榜'],['friends','好友'],['settings','設定']],...(session?.needsAccountUpgrade||session?.user?.is_anonymous?[['upgrade','升級正式帳號']]:[])].map(([id,t])=>button(t,'tab:'+id,id===tab?'active':'')).join('')}</nav>`;
}
function panel(){
 if(tab==='upgrade')return `<h2>將匿名遊客升級成正式帳號</h2>
 <p>綁定信箱並驗證後設定密碼，會沿用目前的玩家 ID、背包和進度。
 匿名帳號一旦登出或遺失裝置資料，尚未綁定的進度無法找回。</p>
 <form id="xtankLinkAnonymousEmail"><label>電子郵件<input type="email" name="email" required autocomplete="email"></label>
 <button type="submit">寄送信箱綁定驗證信</button></form>
 <form id="xtankFinishAnonymousUpgrade"><label>設定正式密碼（完成信箱驗證後）<input type="password" name="password" minlength="8" required></label>
 <button type="submit">完成升級並保留原玩家 ID</button></form>`;
 if(tab==='home')return `<h2>玩家總覽</h2><dl class="xtank-stats">${Object.entries({等級:dashboard.progress.level,經驗:dashboard.progress.total_xp,剩餘升級點:dashboard.progress.unspent_points,已玩場次:dashboard.stats.matches_played,勝場:dashboard.stats.wins,擊殺:dashboard.stats.kills}).map(([k,v])=>`<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
 <p>此處資料會永久保存至 Supabase；單機與玩家自架 LAN 不發放官方獎勵。</p>`;
 if(tab==='garage')return `<h2>機庫：8 種坦克</h2>
  <p>可拖曳旋轉查看自製坦克 3D 模型，選擇款式會同步更新準備出戰的坦克。</p>
  <div id="xtankGaragePreview" class="xtank-garage-preview" role="group" aria-label="可旋轉坦克模型"></div>
  <div class="xtank-card-grid">${dashboard.tanks.map(x=>{
 const t=catalog.tanks.find(t=>t.tank_id===x.tank_id),levels=dashboard.upgrades.filter(u=>u.tank_id===x.tank_id);
 return `<article><h3>${escaped(x.tank_id)}-TANK · Lv.${x.level}</h3>
 <p>HP ${t?.base_hp??'-'}／護盾 ${t?.base_shield??'-'}／速度 ${t?.speed??'-'}</p>
 <p>升級：${levels.map(v=>escaped(v.attribute)+' '+v.level).join('、')||'尚未升級'}</p>
 ${button('選用此坦克','tank:'+x.tank_id)}
 <div class="xtank-upgrades">${['speed','attack','defense','energy','collision'].map(a=>button(a+' +1','upgrade:'+x.tank_id+':'+a)).join('')}</div>
 </article>`}).join('')}</div>`;
 if(tab==='inventory')return `<h2>背包及配裝</h2><p>已持有物品：</p>
 <div class="xtank-inventory">${dashboard.inventory.length?dashboard.inventory.map(x=>`<span>${escaped(x.weapon_id||x.item_id||x.cosmetic_id)} × ${x.quantity}</span>`).join(''):'目前沒有購買的物品'}</div>
 <h3>已儲存配裝</h3>${dashboard.loadouts.length?dashboard.loadouts.map(x=>`<p>${escaped(x.tank_id)} / ${escaped(x.name)} (${x.is_selected?'使用中':'未選'}) <button type="button" data-edit-loadout="${escaped(x.loadout_id)}">載入編輯</button> <button type="button" data-manage-loadout="select:${escaped(x.loadout_id)}" ${x.is_selected?'disabled':''}>設為使用中</button> <button type="button" data-manage-loadout="delete:${escaped(x.loadout_id)}">刪除配裝</button></p>`).join(''):'尚未儲存配裝'}
 <p>戰鬥內仍可按數字鍵 1–7 切換武器；正式對戰需由伺服器讀取已保存的配裝。</p>
 <h3>建立或編輯配裝方案</h3><form id="xtankLoadoutForm">
 <label>坦克<select name="tank_id">${dashboard.tanks.map(t=>`<option value="${escaped(t.tank_id)}">${escaped(t.tank_id)}-TANK</option>`).join('')}</select></label>
 <label>配裝名稱<input name="name" maxlength="40" value="標準配置" required></label>
 <div class="xtank-slot-grid">${Array.from({length:7},(_,i)=>`<label>武器 ${i+1}<select name="weapon_${i+1}">
 <option value="">— 空槽 —</option>${catalog.weapons.filter(w=>['hurricane','death_knight','vulcan','plasma'].includes(w.weapon_id)||dashboard.inventory.some(v=>v.weapon_id===w.weapon_id)).map(w=>`<option value="${escaped(w.weapon_id)}">${escaped(w.display_name)}</option>`).join('')}
 </select></label>`).join('')}</div>

 <p>道具欄與 F1–F6 快捷鍵按道具類型固定對應。只會在正式對戰使用已裝備且持有的道具；第 7 欄保留給新增道具。</p>
 <div class="xtank-slot-grid">${[
 ['repair','F1 維修'],['speed_boost','F2 加速'],['shield_cell','F3 補盾'],
 ['radar_ping','F4 雷達'],['smoke','F5 煙霧'],['team_repair','F6 團隊維修']
 ].map(([itemId,label],i)=>`<label>道具 ${i+1} · ${label}<select name="item_${i+1}">
 <option value="">— 不裝備 —</option>${dashboard.inventory.some(v=>v.item_id===itemId&&v.quantity>0)?
 `<option value="${itemId}">${escaped(catalog.items.find(x=>x.item_id===itemId)?.display_name||itemId)}</option>`:''}
 </select></label>`).join('')}
 <label>道具 7 · 保留<select disabled><option>尚未開放</option></select></label></div>
 <button type="submit">儲存為使用中的配裝</button></form>`;
 if(tab==='shop')return `<h2>坦克軍火商店</h2><p>購買將從永久帳號扣除金幣；可在「交易紀錄」查到每一筆異動。</p><div class="xtank-card-grid">${catalog.offers.map(o=>{
 const item=catalog.weapons.find(x=>x.weapon_id===o.weapon_id)||catalog.items.find(x=>x.item_id===o.item_id);
 const detail=[item?.category&&'類型：'+item.category,item?.cooldown_ms!=null&&'冷卻：'+item.cooldown_ms+' 毫秒',
  item?.max_stack!=null&&'堆疊上限：'+item.max_stack].filter(Boolean).join('／');
 return `<article><h3>${escaped(item?.display_name||o.offer_key)}</h3>
 <p>單次獲得 ${escaped(o.quantity)} 個；售價 ${escaped(o.unit_price)} ${escaped(o.currency_code)}</p>
 <small>${escaped(detail||'詳情以遊戲內裝備欄為準')}</small>
 ${button('確認購買','buy:'+o.offer_id)}</article>`;}).join('')||'<p>商店暫無上架商品</p>'}</div>`;
 if(tab==='ledger')return `<h2>交易紀錄與歷史戰績</h2><p>以下皆由正式資料庫讀取，單機與自架 LAN 對戰不產生正式獎勵。</p><div id="xtankLedgerContent">正在讀取交易紀錄…</div>`;
 if(tab==='rank')return `<h2>2026 賽季排行榜</h2>
 <label>模式 <select id="xtankRankMode"><option value="FFA">個人混戰</option><option value="TDM">團隊戰</option><option value="FLAG_HOLD">搶旗戰</option></select></label>
 <div id="xtankRankContent">讀取賽季排行榜中…</div>`;
 if(tab==='friends')return `<h2>好友</h2><div id="xtankFriendsList">讀取好友中…</div>
 <h3>搜尋玩家並邀請</h3>
 <form id="xtankFindPlayerForm"><label>玩家名稱<input name="query" placeholder="輸入至少 3 個字元" minlength="3" maxlength="24" required></label>
 <button type="submit">搜尋玩家</button></form>
 <div id="xtankPlayerSearchResults" role="status"></div>
 <form id="xtankFriendForm"><label>玩家 UUID <input name="player_id" placeholder="輸入好友玩家 ID" required></label>
 <button type="submit">送出好友邀請</button></form><h3>黑名單</h3><div id="xtankBlockedList">讀取中…</div>`;
 if(tab==='settings')return `<h2>設定</h2><form id="xtankSettingsForm">
 <label>玩家名稱<input name="name" minlength="3" maxlength="24" value="${escaped(dashboard.profile.display_name)}"></label>
 <label>主音量 (0–1)<input name="master_volume" type="number" min="0" max="1" step=".1" value="${dashboard.settings.master_volume}"></label>
 <label>滑鼠靈敏度<input name="mouse_sensitivity" type="number" min=".1" max="10" step=".1" value="${dashboard.settings.mouse_sensitivity}"></label>
 <label>畫面品質<select name="graphics_quality">
 ${[['auto','沿用本機設定'],['low','省電'],['balanced','平衡'],['high','高畫質']].map(([value,title])=>`<option value="${value}" ${dashboard.settings.graphics_quality===value?'selected':''}>${title}</option>`).join('')}
 </select></label>
 <p>登入時自動載入雲端畫質與快捷鍵設定。修改鍵位後會保存到帳號；高對比仍為本機設定。</p>
 <button type="submit">儲存設定</button></form>
 <form id="xtankChangePassword"><label>新密碼（至少 8 字）<input name="password" type="password" required minlength="8" autocomplete="new-password"></label><button type="submit">變更密碼</button></form>`;
 return '';
}
function draw(){
 if(disposeGaragePreview){disposeGaragePreview();disposeGaragePreview=null;}
 if(overlay.hidden)return;
 if(!session?.access_token){authView();return}
 if(!dashboard||!catalog){
  content.innerHTML='<p>玩家資料尚未同步，請重新讀取；不會因暫時網路錯誤而刪除登入憑證。</p>'+
   '<button type="button" id="xtankReloadProfile">重新讀取帳號</button>'+
   '<button type="button" id="xtankSwitchAccount">改用其他帳號登入</button>';
  $('#xtankReloadProfile').onclick=()=>run(async()=>{await getToken();await rpc('initialize',{});await reload();msg('帳號資料已恢復')});
  $('#xtankSwitchAccount').onclick=()=>{saveSession(null);dashboard=null;catalog=null;draw()};
  return;
 }
 content.innerHTML=bar()+`<section class="xtank-account-panel">${panel()}</section>`;
 if(tab==='garage'){
  try{
   const selected=$('#tankSelect')?.value||dashboard.tanks[0]?.tank_id||'X';
   disposeGaragePreview=mountGaragePreview($('#xtankGaragePreview'),selected,kind=>{
    const tank=$('#tankSelect');if(tank)tank.value=kind;
   });
  }catch(error){
   const root=$('#xtankGaragePreview');if(root)root.textContent='此裝置無法開啟 3D 機庫預覽：'+error.message;
  }
 }
 if(tab==='friends')Promise.all([
   rpcNamed('xtank_social_api',{p_action:'list'}),
   rpcNamed('xtank_blocks_api',{p_action:'list'})
  ]).then(([data,blocklist])=>{
   const target=$('#xtankFriendsList');
   if(target)target.innerHTML=(data.friends||[]).map(f=>`<p>${escaped(f.friend_name)}　${escaped(f.status)} ${f.status==='pending'&&f.friend_id===dashboard.profile.player_id?button('接受邀請','accept:'+f.player_id):''} ${button('封鎖','block:'+(f.player_id===dashboard.profile.player_id?f.friend_id:f.player_id))}</p>`).join('')||'<p>目前沒有好友邀請</p>';
   target?.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
    const [action,targetId]=b.dataset.action.split(':');
    if(action==='block'&&!confirm('確定要封鎖這名玩家並解除好友關係？'))return;
    run(async()=>{
     await rpcNamed('xtank_social_api',{p_action:action,p_target:targetId});
     draw();msg(action==='block'?'已封鎖玩家':'已接受好友邀請');
    });
   });
   const blocked=$('#xtankBlockedList');
   if(blocked)blocked.innerHTML=(blocklist.blocked||[]).map(x=>
    `<p>${escaped(x.name)}（${escaped(x.player_id)}）${button('解除封鎖','unblock:'+x.player_id)}</p>`
   ).join('')||'<p>黑名單為空</p>';
   blocked?.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.action.slice('unblock:'.length);
    run(async()=>{
     await rpcNamed('xtank_blocks_api',{p_action:'unblock',p_target:id});
     draw();msg('已解除封鎖，玩家可以重新發送好友邀請');
    });
   });
  }).catch(e=>msg(e.message));
 $('#xtankFindPlayerForm')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const output=$('#xtankPlayerSearchResults');
  if(!output)return;
  output.textContent='搜尋中…';
  try{
   const query=event.target.elements.query.value.trim();
   const found=await rpcNamed('xtank_find_players',{p_query:query});
   if(!output.isConnected)return;
   output.innerHTML=(found.players||[]).map(player=>`<p>${escaped(player.name)} <small>${escaped(player.player_id)}</small> ${button('送出好友邀請','invite:'+player.player_id)}</p>`).join('')||'<p>找不到符合的玩家</p>';
   output.querySelectorAll('[data-action]').forEach(button=>button.onclick=()=>{
    const [,id]=button.dataset.action.split(':');
    run(async()=>{
     await rpcNamed('xtank_social_api',{p_action:'invite',p_target:id});
     draw();msg('已送出好友邀請');
    });
   });
  }catch(error){if(output.isConnected)output.textContent='搜尋失敗：'+error.message}
 });
 $('#xtankFriendForm')?.addEventListener('submit',e=>{e.preventDefault();const f=e.target;run(async()=>{await rpcNamed('xtank_social_api',{p_action:'invite',p_target:f.elements.player_id.value.trim()});draw();msg('已送出邀請')})});
 content.querySelectorAll('[data-manage-loadout]').forEach(button=>button.addEventListener('click',()=>{
  const [action,id]=button.dataset.manageLoadout.split(':');
  if(action==='delete'&&!confirm('確定要刪除這份配裝？此操作無法復原。'))return;
  run(async()=>{
   await rpcNamed('xtank_manage_loadout',{p_action:action,p_loadout_id:id});
   await reload();
   msg(action==='select'?'已選用此配裝':'配裝已刪除');
  });
 }));
 const loadoutForm=$('#xtankLoadoutForm');
 if(loadoutForm){
  loadoutForm.elements.tank_id.addEventListener('change',()=>{delete loadoutForm.dataset.editLoadout});
  content.querySelectorAll('[data-edit-loadout]').forEach(button=>button.addEventListener('click',()=>{
   const selected=dashboard.loadouts.find(x=>x.loadout_id===button.dataset.editLoadout);
   if(!selected)return;
   loadoutForm.elements.tank_id.value=selected.tank_id;
   loadoutForm.elements.name.value=selected.name;
   loadoutForm.dataset.editLoadout=selected.loadout_id;
   for(let i=1;i<=7;i++)loadoutForm.elements['weapon_'+i].value='';
   for(let i=1;i<=6;i++)loadoutForm.elements['item_'+i].value='';
   for(const slot of dashboard.slots.filter(x=>x.loadout_id===selected.loadout_id)){
    const field=loadoutForm.elements[slot.slot_type+'_'+slot.slot_number];
    if(field){
     const value=slot.slot_type==='weapon'?slot.weapon_id:slot.item_id;
     if([...field.options].some(option=>option.value===value))field.value=value;
    }
   }
   msg('目前正在編輯：'+selected.name+'；儲存後將更新原配裝，而非另外新增。');
  }));
 }
 $('#xtankLoadoutForm')?.addEventListener('submit',e=>{e.preventDefault();const f=e.target;
 run(async()=>{
  const slots=[...Array.from({length:7},(_,i)=>({slot_type:'weapon',slot_number:i+1,ref:f.elements['weapon_'+(i+1)].value})),
   ...Array.from({length:6},(_,i)=>({slot_type:'item',slot_number:i+1,ref:f.elements['item_'+(i+1)].value}))].filter(v=>v.ref);
  const saved=await rpcNamed('xtank_save_loadout',{p_tank_id:f.elements.tank_id.value,p_name:f.elements.name.value.trim(),p_slots:slots,p_loadout_id:f.dataset.editLoadout||null});
  await reload();msg('配裝已儲存：'+saved);
 });
 });
 if(tab==='ledger'){
  const ledger=$('#xtankLedgerContent');
  rpcNamed('xtank_player_history',{p_limit:25}).then(data=>{
   if(!ledger.isConnected)return;
   const date=value=>value?new Date(value).toLocaleString('zh-TW'):'—';
   const signed=n=>(Number(n)>0?'+':'')+Number(n||0);
   const rows=(data.wallet||[]).map(item=>
     '<article><strong>'+escaped(item.currency_code)+' '+signed(item.amount)+'</strong>　'+
     escaped(item.source_type)+'<small>　餘額 '+escaped(item.balance_after)+'／'+escaped(date(item.created_at))+'</small></article>').join('');
   const xpRows=(data.xp||[]).map(item=>
     '<article>經驗 '+signed(item.xp_delta)+'　'+escaped(item.source_type)+
     '<small>　累計 '+escaped(item.xp_after)+'／'+escaped(date(item.created_at))+'</small></article>').join('');
   const items=(data.inventory||[]).map(item=>
     '<article>'+escaped(item.item_kind)+' '+escaped(item.item_ref)+' × '+signed(item.quantity_delta)+
     '<small>　'+escaped(item.source_type)+'／'+escaped(date(item.created_at))+'</small></article>').join('');
   const battles=(data.matches||[]).map(item=>
     '<article>'+escaped(item.mode_id)+'／'+escaped(item.map_id)+
     '　擊破 '+escaped(item.kills)+'／被擊破 '+escaped(item.deaths)+
     '　XP '+signed(item.xp)+'／金幣 '+signed(item.currency_amount)+
     '<small>　'+escaped(item.reward_status||'—')+'／'+escaped(date(item.ended_at))+'</small></article>').join('');
   ledger.innerHTML='<h3>金幣異動</h3>'+(rows||'<p>尚無紀錄</p>')+
    '<h3>經驗異動</h3>'+(xpRows||'<p>尚無紀錄</p>')+
    '<h3>物品異動</h3>'+(items||'<p>尚無紀錄</p>')+
    '<h3>歷史正式對戰</h3>'+(battles||'<p>尚無紀錄</p>');
  }).catch(error=>{if(ledger.isConnected)ledger.textContent='讀取失敗：'+error.message});
 }
 if(tab==='rank'){
   const select=$('#xtankRankMode');
   select.value=rankMode;
   async function loadRank(){
     rankMode=select.value;
     try{
       const data=await rpcNamed('xtank_season_leaderboard',{p_mode_id:rankMode});
       const root=$('#xtankRankContent');if(!root)return;
       root.innerHTML=`<p>${escaped(data.season?.name||'尚無當前賽季')}</p><ol>${(data.players||[]).map(x=>`<li>第 ${x.rank} 名　${escaped(x.display_name)}　積分 ${x.rating}　MMR ${x.mmr}　勝場 ${x.wins}</li>`).join('')}</ol>`;
     }catch(e){msg(e.message)}
   }
   select.onchange=loadRank;
   loadRank();
 }
 $('#xtankLinkAnonymousEmail')?.addEventListener('submit',e=>{
  e.preventDefault();run(async()=>{
   if(!session?.needsAccountUpgrade&&!session?.user?.is_anonymous)throw Error('目前不是匿名帳號');
   const token=await getToken();
   await rest('/auth/v1/user',{method:'PUT',token,body:{email:e.target.elements.email.value.trim()}});
   msg('綁定信已送出。請完成信箱驗證，再回遊戲設定密碼；玩家 ID 不會改變。');
  });
 });
 $('#xtankFinishAnonymousUpgrade')?.addEventListener('submit',e=>{
  e.preventDefault();run(async()=>{
   const token=await getToken();
   const verified=await rest('/auth/v1/user',{method:'GET',token});
   if(verified.is_anonymous===true||!verified.email_confirmed_at)
    throw Error('尚未完成信箱驗證，請先按郵件內的連結驗證');
   const changed=await rest('/auth/v1/user',{method:'PUT',token,body:{password:e.target.elements.password.value}});
   saveSession({...session,user:changed.user||changed,needsAccountUpgrade:false});
   await reload();tab='home';draw();
   msg('已升級為正式玩家，原本的玩家 ID 與進度保留。');
  });
 });
 $('#xtankChangePassword')?.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
   const token=await getToken();
   await rest('/auth/v1/user',{method:'PUT',token,body:{password:e.target.elements.password.value}});
   e.target.reset();msg('密碼已更新');
 })});
 $('#xtankSettingsForm')?.addEventListener('submit',e=>{e.preventDefault();run(async()=>{
  const f=e.target;await rpc('rename',{name:f.elements.name.value});
  await rpc('settings',{master_volume:Number(f.elements.master_volume.value),mouse_sensitivity:Number(f.elements.mouse_sensitivity.value),graphics_quality:f.elements.graphics_quality.value});
  await reload();msg('設定已儲存');
 })});
 content.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',()=>{const parts=b.dataset.action.split(':');
 if(parts[0]==='tab'){tab=parts[1];draw();return}
 if(parts[0]==='logout'){
  run(async()=>{
   let revoked=true;
   const token=await getToken().catch(()=>null);
   try{
    if(token)await rest('/auth/v1/logout?scope=local',{method:'POST',token});
    else revoked=false;
   }catch(error){revoked=false;console.warn('Auth session revoke failed:',error.message)}
   saveSession(null);dashboard=null;catalog=null;tab='home';draw();
   msg(revoked?'已登出並撤銷此裝置的更新權杖':'已退出此裝置，但伺服器憑證撤銷尚未確認');
  });
  return;
 }
 if(parts[0]==='tank'){const sel=$('#tankSelect');if(sel)sel.value=parts[1];hide();return}
 if(parts[0]==='upgrade')run(async()=>{await rpc('upgrade',{tank_id:parts[1],attribute:parts[2]});await reload();msg('坦克升級成功');return});
 if(parts[0]==='buy')run(async()=>{
  const offer=catalog?.offers?.find(o=>o.offer_id===parts[1]);
  if(!offer)throw Error('商品已下架或尚未載入');
  const item=catalog.weapons.find(x=>x.weapon_id===offer.weapon_id)||
    catalog.items.find(x=>x.item_id===offer.item_id);
  if(!confirm('確定購買 '+(item?.display_name||offer.offer_key)+' × '+offer.quantity+
    '，支付 '+offer.unit_price+' '+offer.currency_code+'？'))return;
  const key=crypto.randomUUID();await rpc('buy',{offer_id:parts[1],quantity:1,key});
  await reload();msg('購買成功，金幣與背包已更新；可在交易紀錄查看');return});
 }));
}
async function run(fn){
 if(busy)return;busy=true;msg('處理中…');
 try{await fn()}catch(e){msg('操作失敗：'+(e.message||e))}finally{busy=false}
}
show();
if(session?.access_token){
 getToken().then(()=>rpc('initialize',{})).then(reload).catch(error=>{
  // Network/DB failure is not proof of a revoked Auth session.
  // Keep refresh tokens until the user explicitly switches accounts.
  dashboard=null;catalog=null;draw();
  msg('帳號資料暫時無法同步：'+(error?.message||'網路或伺服器異常')+'。請重新讀取，或改用其他帳號登入。');
 });
}
window.xtankAccount={show,hide,refresh:reload,getAccessToken:getToken,savePreferences,saveCloudBindings,
 getMatchReceipt:matchId=>rpcNamed('xtank_player_match_receipt',{p_match_id:matchId}),
 getSignedInPlayerId:()=>dashboard?.profile?.player_id??null};
