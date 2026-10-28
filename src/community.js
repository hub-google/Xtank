import './community.css';
const BASE='https://fanffwnhkxpfhttylntw.supabase.co';
const API_KEY='sb_publishable_fsrieSLUXlq-_WDpPY9K_w_eO-dN_jT';
const safe=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const qs=(x,root=document)=>root.querySelector(x);
let data=null,friendData=null,tab='clans',busy=false,selectedClan=null,selectedFriend=null;
const menu=qs('#startMenu .panel');
if(menu){
  const launch=document.createElement('button');
  launch.id='xtankCommunityOpen';launch.className='secondary';launch.type='button';launch.textContent='組隊／公會／聊天／信件／通知';
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
    nav.innerHTML=[['party','組隊配對'],['clans','公會'],['chat','好友私訊'],['mail','信件'],['notifications','通知'],['report','檢舉']].map(([id,name])=>'<button type="button" data-tab="'+id+'" class="'+(tab===id?'active':'')+'">'+name+'</button>').join('');
    nav.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render()});
    if(tab==='party'){
      main.innerHTML='<h2>玩家預組隊伍（最多 4 人）</h2><div id="xtankPartyInfo">讀取隊伍中…</div>'+
        form('xtankCreateParty','','建立隊伍')+
        form('xtankJoinParty','<label>邀請碼（隊伍 UUID）<input name="party_id" required></label>','加入隊伍')+
        '<h3>跨伺服器 MMR 配對佇列</h3>'+
        form('xtankQueueParty','<label>模式<select name="mode"><option value="FFA">個人混戰</option><option value="TDM">團隊對抗</option><option value="FLAG_HOLD">持旗戰</option></select></label>'+
        '<label>區域<select name="region"><option value="asia-east">亞洲東部</option><option value="asia-south">亞洲南部</option><option value="us-west">美西</option><option value="eu-west">歐洲西部</option></select></label>','加入排位佇列')+
        '<button id="xtankCancelQueue" type="button">取消排隊</button>'+
        '<p>已提交至永久配對佇列；尚須上線跨節點配對分配器才能自動進入遊戲房間。</p>';
      main.querySelector('#xtankCreateParty').onsubmit=e=>{e.preventDefault();run(()=>rpc('xtank_party_queue_api',{p_action:'create'}))};
      main.querySelector('#xtankJoinParty').onsubmit=e=>{e.preventDefault();run(()=>rpc('xtank_party_queue_api',{p_action:'join',p_payload:{party_id:e.target.elements.party_id.value.trim()}}))};
      main.querySelector('#xtankQueueParty').onsubmit=e=>{
       e.preventDefault();const form=e.target;
       run(()=>rpc('xtank_party_queue_api',{p_action:'queue',p_payload:{mode:form.elements.mode.value,region:form.elements.region.value}}));
      };
      main.querySelector('#xtankCancelQueue').onclick=()=>run(()=>rpc('xtank_party_queue_api',{p_action:'cancel'}));
      rpc('xtank_party_queue_api',{p_action:'overview'}).then(d=>{
       const target=qs('#xtankPartyInfo');if(!target||!target.isConnected||tab!=='party')return;
       const me=window.xtankAccount?.getSignedInPlayerId?.();
       const leader=(d.members||[]).find(m=>m.leader)?.player_id===me;
       target.innerHTML=(d.party_id?
        '<p>隊伍邀請碼：<code>'+safe(d.party_id)+'</code></p>'+
        (d.members||[]).map(m=>'<article>'+safe(m.name)+(m.leader?'（隊長）':'')+
           (leader&&!m.leader?'<button data-party-action="transfer" data-member="'+safe(m.player_id)+'">移交隊長</button>'+
           '<button data-party-action="kick" data-member="'+safe(m.player_id)+'">移除</button>':'')+
         '</article>').join('')+
         '<button id="xtankLeaveParty">退出／解散隊伍</button>':'<p>目前沒有隊伍；可建立或輸入邀請碼加入。</p>')+
         '<p>近期佇列：'+(d.queue||[]).map(x=>safe(x.mode)+' '+safe(x.region||'')+' '+safe(x.status)).join('、')+'</p>';
       const leave=target.querySelector('#xtankLeaveParty');if(leave)leave.onclick=()=>run(()=>rpc('xtank_party_queue_api',{p_action:'leave'}));
       target.querySelectorAll('[data-party-action]').forEach(b=>b.onclick=()=>{
        const action=b.dataset.partyAction;
        if(!confirm(action==='kick'?'移除這位隊員？':'確定移交隊長？'))return;
        run(()=>rpc('xtank_party_queue_api',{p_action:action,p_payload:{target:b.dataset.member}}));
       });
      }).catch(error=>{const target=qs('#xtankPartyInfo');if(target)target.textContent=error.message});
    }else if(tab==='clans'){
      const own=data.clans||[],list=data.public_clans||[];
      main.innerHTML='<h2>我的公會</h2>'+(own.map(c=>'<article><strong>'+safe(c.name)+'</strong> ['+safe(c.tag)+'] ('+safe(c.role)+') <button data-clan-chat="'+safe(c.clan_id)+'">公會聊天</button><button data-leave="'+safe(c.clan_id)+'">退出／解散</button></article>').join('')||'<p>尚未加入公會</p>')
      +'<h2>公開公會</h2>'+list.map(c=>'<article>'+safe(c.name)+' ['+safe(c.tag)+'] <button data-join="'+safe(c.id)+'">加入</button></article>').join('')
      +form('xtankCreateClan','<label>公會名稱 <input name="name" required minlength="3" maxlength="40"></label><label>公會標籤 <input name="tag" required minlength="2" maxlength="6"></label>','建立公會')
      +'<h3>公會成員及幹部管理</h3><div id="xtankClanMembers"></div><h3>公會訊息</h3><div id="xtankClanMessages"></div>'+form('xtankClanChat','<label>訊息 <input name="body" required maxlength="500"></label>','發送公會訊息');
      main.querySelector('#xtankCreateClan').onsubmit=e=>{e.preventDefault();run(()=>api('create_clan',{name:e.target.elements.name.value,tag:e.target.elements.tag.value}))};
      main.querySelectorAll('[data-join]').forEach(b=>b.onclick=()=>run(()=>api('join_clan',{clan_id:b.dataset.join})));
      main.querySelectorAll('[data-leave]').forEach(b=>b.onclick=()=>run(()=>api('leave_clan',{clan_id:b.dataset.leave})));
      main.querySelectorAll('[data-clan-chat]').forEach(b=>b.onclick=()=>{selectedClan=b.dataset.clanChat;loadConversation();loadMembers()});
      main.querySelector('#xtankClanChat').onsubmit=e=>{e.preventDefault();if(!selectedClan)return status('請先選擇公會聊天');run(()=>api('send_clan_chat',{clan_id:selectedClan,body:e.target.elements.body.value}))};
      if(selectedClan){loadConversation();loadMembers()}
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
  async function loadMembers(){
    const root=qs('#xtankClanMembers');
    if(!root)return;
    if(!selectedClan){root.textContent='請選擇公會';return}
    root.textContent='讀取公會成員中…';
    try{
      const data=await rpc('xtank_clan_admin_api',{p_action:'members',p_clan_id:selectedClan});
      if(!root.isConnected)return;
      const ownRole=(data?.clans||[]).find(x=>x.clan_id===selectedClan)?.role||
         (await api('overview')).clans?.find(x=>x.clan_id===selectedClan)?.role;
      const me=window.xtankAccount?.getSignedInPlayerId?.();
      root.innerHTML=(data.members||[]).map(member=>{
        const id=safe(member.player_id),canManage=member.player_id!==me&&
          (ownRole==='leader'||ownRole==='officer'&&member.role==='member');
        const actions=!canManage?'':(ownRole==='leader'?
          (member.role==='officer'?'<button data-clan-action="demote" data-target="'+id+'">撤銷幹部</button>':
           '<button data-clan-action="promote" data-target="'+id+'">升為幹部</button>')+
          '<button data-clan-action="transfer" data-target="'+id+'">移交會長</button>':'')+
          '<button data-clan-action="kick" data-target="'+id+'">移除成員</button>';
        return '<article>'+safe(member.name)+'（'+safe(member.role)+'） '+actions+'</article>';
      }).join('')||'<p>公會沒有成員</p>';
      root.querySelectorAll('[data-clan-action]').forEach(button=>button.onclick=()=>{
        const action=button.dataset.clanAction,target=button.dataset.target;
        if(['transfer','kick'].includes(action)&&!confirm(action==='transfer'?'確定移交會長？':'確定移除這名成員？'))return;
        run(()=>rpc('xtank_clan_admin_api',{p_action:action,p_clan_id:selectedClan,p_target:target}));
      });
    }catch(e){if(root.isConnected)root.textContent=e.message;}
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
