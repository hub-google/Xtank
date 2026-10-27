import './community.css';
const BASE='https://fanffwnhkxpfhttylntw.supabase.co';
const API_KEY='sb_publishable_fsrieSLUXlq-_WDpPY9K_w_eO-dN_jT';
const safe=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const qs=(x,root=document)=>root.querySelector(x);
let data=null,friendData=null,tab='clans',busy=false,selectedClan=null,selectedFriend=null;
const menu=qs('#startMenu .panel');
if(menu){
  const launch=document.createElement('button');
  launch.id='xtankCommunityOpen';launch.className='secondary';launch.type='button';launch.textContent='公會／聊天／信件／通知';
  menu.insertBefore(launch,menu.querySelector('.online-box'));
  const layer=document.createElement('div');layer.id='xtankCommunityOverlay';layer.className='xtank-community-layer';layer.hidden=true;
  layer.innerHTML='<section class="xtank-community-dialog" role="dialog" aria-modal="true" aria-label="玩家社群"><header><strong>玩家社群</strong><button type="button" id="xtankCommunityClose">關閉</button></header><p id="xtankCommunityStatus" role="status"></p><nav id="xtankCommunityNav"></nav><main id="xtankCommunityMain"></main></section>';
  document.body.append(layer);
  qs('#xtankCommunityClose').onclick=()=>{layer.hidden=true};
  layer.addEventListener('click',e=>{if(e.target===layer)layer.hidden=true});
  launch.onclick=async()=>{layer.hidden=false;await refresh()};
  const status=s=>qs('#xtankCommunityStatus').textContent=String(s||'');
  async function rpc(name,params){
    const token=await window.xtankAccount?.getAccessToken?.();
    if(!token)throw Error('請先在「玩家帳號」登入');
    const r=await fetch(BASE+'/rest/v1/rpc/'+name,{method:'POST',headers:{'apikey':API_KEY,'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(params)});
    const result=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(result.message||result.error||'HTTP '+r.status);
    return result;
  }
  const api=(action,payload={})=>rpc('xtank_community_api',{p_action:action,p_payload:payload});
  async function run(action){
    if(busy)return;busy=true;status('處理中…');
    try{await action();await refresh();status('已完成並寫入資料庫')}catch(e){status('失敗：'+e.message)}finally{busy=false}
  }
  async function refresh(){
    try{
      status('正在讀取社群資料…');
      [data,friendData]=await Promise.all([api('overview'),rpc('xtank_social_api',{p_action:'list'})]);
      status('');render();
    }catch(e){status(e.message);qs('#xtankCommunityMain').textContent='需要先登入正式玩家帳號。'}
  }
  function form(id,fields,button){
    return '<form id="'+id+'">'+fields+'<button type="submit">'+button+'</button></form>';
  }
  const friends=()=>friendData?.friends?.filter(f=>f.status==='accepted').map(f=>({
    id:f.player_id===window.xtankAccount?.getSignedInPlayerId?.()?f.friend_id:f.player_id,
    name:f.friend_name}))||[];
  function render(){
    const nav=qs('#xtankCommunityNav'),main=qs('#xtankCommunityMain');
    nav.innerHTML=[['clans','公會'],['chat','好友私訊'],['mail','信件'],['notifications','通知'],['report','檢舉']].map(([id,name])=>'<button type="button" data-tab="'+id+'" class="'+(tab===id?'active':'')+'">'+name+'</button>').join('');
    nav.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render()});
    if(tab==='clans'){
      const own=data.clans||[],list=data.public_clans||[];
      main.innerHTML='<h2>我的公會</h2>'+(own.map(c=>'<article><strong>'+safe(c.name)+'</strong> ['+safe(c.tag)+'] ('+safe(c.role)+') <button data-clan-chat="'+safe(c.clan_id)+'">公會聊天</button><button data-leave="'+safe(c.clan_id)+'">退出／解散</button></article>').join('')||'<p>尚未加入公會</p>')
      +'<h2>公開公會</h2>'+list.map(c=>'<article>'+safe(c.name)+' ['+safe(c.tag)+'] <button data-join="'+safe(c.id)+'">加入</button></article>').join('')
      +form('xtankCreateClan','<label>公會名稱 <input name="name" required minlength="3" maxlength="40"></label><label>公會標籤 <input name="tag" required minlength="2" maxlength="6"></label>','建立公會')
      +'<h3>公會訊息</h3><div id="xtankClanMessages"></div>'+form('xtankClanChat','<label>訊息 <input name="body" required maxlength="500"></label>','發送公會訊息');
      main.querySelector('#xtankCreateClan').onsubmit=e=>{e.preventDefault();run(()=>api('create_clan',{name:e.target.elements.name.value,tag:e.target.elements.tag.value}))};
      main.querySelectorAll('[data-join]').forEach(b=>b.onclick=()=>run(()=>api('join_clan',{clan_id:b.dataset.join})));
      main.querySelectorAll('[data-leave]').forEach(b=>b.onclick=()=>run(()=>api('leave_clan',{clan_id:b.dataset.leave})));
      main.querySelectorAll('[data-clan-chat]').forEach(b=>b.onclick=()=>{selectedClan=b.dataset.clanChat;loadConversation()});
      main.querySelector('#xtankClanChat').onsubmit=e=>{e.preventDefault();if(!selectedClan)return status('請先選擇公會聊天');run(()=>api('send_clan_chat',{clan_id:selectedClan,body:e.target.elements.body.value}))};
      if(selectedClan)loadConversation();
    }else if(tab==='chat'){
      main.innerHTML='<h2>好友私訊</h2><label>對象 <select id="xtankDmTarget">'+friends().map(f=>'<option value="'+safe(f.id)+'">'+safe(f.name)+'</option>').join('')+'</select></label><div id="xtankDmMessages"></div>'
       +form('xtankDmForm','<label>訊息 <input name="body" required maxlength="500"></label>','送出訊息');
      const sel=qs('#xtankDmTarget');
      if(selectedFriend&&[...sel.options].some(x=>x.value===selectedFriend))sel.value=selectedFriend;
      selectedFriend=sel.value;
      sel.onchange=()=>{selectedFriend=sel.value;loadConversation()};
      qs('#xtankDmForm').onsubmit=e=>{e.preventDefault();run(()=>api('send_dm',{recipient_id:selectedFriend,body:e.target.elements.body.value}))};
      loadConversation();
    }else if(tab==='mail'){
      main.innerHTML='<h2>收到的信件</h2>'+(data.mail||[]).map(m=>'<article><strong>'+safe(m.title)+'</strong> '+(m.read_at?'':'（未讀）')+'<p>'+safe(m.body)+'</p><button data-mail-read="'+safe(m.mail_id)+'">標為已讀</button></article>').join('')
      +'<h3>寫信給好友</h3>'+form('xtankMailForm','<label>好友 <select name="recipient_id">'+friends().map(f=>'<option value="'+safe(f.id)+'">'+safe(f.name)+'</option>').join('')+'</select></label><label>主旨<input name="title" required maxlength="80"></label><label>內容<textarea name="body" required maxlength="500"></textarea></label>','寄送');
      qs('#xtankMailForm').onsubmit=e=>{e.preventDefault();const f=e.target;run(()=>api('send_mail',{recipient_id:f.elements.recipient_id.value,title:f.elements.title.value,body:f.elements.body.value}))};
      main.querySelectorAll('[data-mail-read]').forEach(b=>b.onclick=()=>run(()=>api('read_mail',{mail_id:b.dataset.mailRead})));
    }else if(tab==='notifications'){
      main.innerHTML='<h2>通知</h2>'+(data.notifications||[]).map(n=>'<article>'+safe(n.kind)+' '+safe(JSON.stringify(n.payload))+' '+(n.read_at?'':'<button data-notify="'+safe(n.notification_id)+'">已讀</button>')+'</article>').join('');
      main.querySelectorAll('[data-notify]').forEach(b=>b.onclick=()=>run(()=>api('read_notification',{notification_id:b.dataset.notify})));
    }else if(tab==='report'){
      main.innerHTML='<h2>玩家檢舉</h2>'+form('xtankReportForm','<label>玩家 UUID <input name="reported_id" required></label><label>理由<input name="reason" minlength="5" maxlength="200" required></label><label>補充說明<textarea name="details" maxlength="1000"></textarea></label>','送出檢舉');
      qs('#xtankReportForm').onsubmit=e=>{e.preventDefault();const f=e.target;run(()=>api('report',{reported_id:f.elements.reported_id.value,reason:f.elements.reason.value,details:f.elements.details.value}))};
    }
  }
  async function loadConversation(){
    const root=tab==='clans'?qs('#xtankClanMessages'):qs('#xtankDmMessages');
    if(!root)return;
    const payload=tab==='clans'?{clan_id:selectedClan}:{recipient_id:selectedFriend};
    if(!Object.values(payload)[0]){root.textContent='尚未選擇對話';return}
    root.textContent='讀取訊息中…';
    try{
      const response=await api('messages',payload);
      if(root.isConnected)root.replaceChildren(...(response.messages||[]).map(m=>{
        const item=document.createElement('p');item.textContent=m.sender_id+': '+m.body;return item;
      }));
    }catch(e){root.textContent=e.message}
  }
}
