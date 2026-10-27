import './quests.css';
const endpoint='https://fanffwnhkxpfhttylntw.supabase.co/rest/v1/rpc/xtank_quest_api';
const key='sb_publishable_fsrieSLUXlq-_WDpPY9K_w_eO-dN_jT';
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const menu=document.querySelector('#startMenu .panel');
if(menu){
 const btn=document.createElement('button');btn.id='xtankQuestsOpen';btn.className='secondary';btn.type='button';btn.textContent='任務／成就／限時活動';
 menu.insertBefore(btn,menu.querySelector('.online-box'));
 const overlay=document.createElement('div');overlay.id='xtankQuestOverlay';overlay.className='xtank-quest-overlay';overlay.hidden=true;
 overlay.innerHTML='<section role="dialog" aria-modal="true" aria-label="每日任務" class="xtank-quest-dialog"><header><strong>任務與獎勵</strong><button id="xtankQuestClose">關閉</button></header><p role="status" id="xtankQuestStatus"></p><div id="xtankQuestList"></div></section>';
 document.body.append(overlay);
 const $=x=>overlay.querySelector(x);
 $('#xtankQuestClose').onclick=()=>overlay.hidden=true;
 overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.hidden=true});
 let busy=false,items=[],achievements=[],events=[];
 const status=s=>$('#xtankQuestStatus').textContent=s;
 async function call(action,questId=null,cycle=null){
  const token=await window.xtankAccount?.getAccessToken?.();
  if(!token)throw Error('先登入玩家帳號才能領取正式任務獎勵');
  const res=await fetch(endpoint,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_quest_id:questId,p_cycle_key:cycle})});
  const obj=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(obj.message||obj.error||'HTTP '+res.status);
  return obj;
 }
 async function callAchievement(action,achievementId=null){
   const token=await window.xtankAccount?.getAccessToken?.();
   if(!token)throw Error('請先登入玩家帳號');
   const res=await fetch(endpoint.replace('xtank_quest_api','xtank_achievement_api'),{
    method:'POST',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({p_action:action,p_achievement_id:achievementId})
   });
   const data=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(data.message||data.error||'HTTP '+res.status);
   return data;
 }
 async function callEvent(action,eventId=null){
  const token=await window.xtankAccount?.getAccessToken?.();
  if(!token)throw Error('請先登入玩家帳號');
  const res=await fetch(endpoint.replace('xtank_quest_api','xtank_event_api'),{
   method:'POST',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({p_action:action,p_event_id:eventId})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(data.message||data.error||'HTTP '+res.status);
  return data;
 }
 function render(){
  $('#xtankQuestList').innerHTML=items.map(q=>{
   const value=Math.min(Number(q.progress)||0,Number(q.target)||1),target=Number(q.target)||1;
   const statusText=q.claimed_at?'已領取':value>=target?'可以領取':'進行中';
   return '<article><h3>'+escapeHtml(q.display_name)+'</h3><p>'+escapeHtml(q.cadence)+' · '+value+' / '+target+' · 獎勵 '+escapeHtml(q.reward?.COIN||0)+' 金幣</p><progress value="'+value+'" max="'+target+'"></progress><button type="button" data-claim="'+escapeHtml(q.quest_id)+'" data-cycle="'+escapeHtml(q.cycle_key)+'" '+(q.claimed_at||value<target?'disabled':'')+'>'+statusText+'</button></article>';
  }).join('')||'<p>目前沒有任務</p>';
  $('#xtankQuestList').insertAdjacentHTML('beforeend','<h2>永久成就</h2>'+
    achievements.map(a=>{const target=Number(a.target)||1,current=Math.min(Number(a.progress)||0,target);
      return '<article><h3>'+escapeHtml(a.name)+'</h3><p>'+escapeHtml(a.description)+' · '+current+'/'+target+
      ' · '+escapeHtml(a.reward?.COIN||0)+' 金幣</p><progress value="'+current+'" max="'+target+'"></progress>'+
      '<button type="button" data-achievement="'+escapeHtml(a.id)+'" '+(a.claimed_at||current<target?'disabled':'')+'>'+
      (a.claimed_at?'已領取':current>=target?'領取成就獎勵':'進行中')+'</button></article>';
    }).join(''));
  $('#xtankQuestList').insertAdjacentHTML('beforeend','<h2>限時活動</h2>'+
   (events.map(event=>{
    const target=Number(event.target)||1,progress=Math.min(Number(event.progress)||0,target);
    return '<article><h3>'+escapeHtml(event.name)+'</h3><p>進度 '+progress+' / '+target+
      ' · 獎勵 '+escapeHtml(event.reward)+' 金幣 · 截止 '+escapeHtml(new Date(event.end).toLocaleDateString('zh-TW'))+'</p>'+
      '<progress value="'+progress+'" max="'+target+'"></progress><button data-event="'+escapeHtml(event.id)+'" '+
      (event.claimed_at||progress<target?'disabled':'')+'>'+(event.claimed_at?'已領取':progress>=target?'領取獎勵':'進行中')+'</button></article>';
    }).join('')||'<p>目前沒有進行中的活動</p>'));
  $('#xtankQuestList').querySelectorAll('[data-event]').forEach(b=>b.onclick=async()=>{
   if(busy)return;busy=true;status('領取活動獎勵中…');
   try{await callEvent('claim',b.dataset.event);await load();
     await window.xtankAccount?.refresh?.();status('活動獎勵已入帳');
   }catch(e){status(e.message)}finally{busy=false}
  });
  $('#xtankQuestList').querySelectorAll('[data-achievement]').forEach(b=>b.onclick=async()=>{
    if(busy)return;busy=true;status('正在領取成就獎勵…');
    try{await callAchievement('claim',b.dataset.achievement);await load();
      await window.xtankAccount?.refresh?.();status('成就獎勵已領取');
    }catch(e){status(e.message)}finally{busy=false}
  });
  $('#xtankQuestList').querySelectorAll('[data-claim]').forEach(b=>b.onclick=async()=>{
   if(busy)return;busy=true;status('正在領取獎勵…');
   try{
    await call('claim',b.dataset.claim,b.dataset.cycle);
    await load();await window.xtankAccount?.refresh?.();
    status('任務獎勵已領取，金幣已更新');
   }catch(e){status(e.message)}finally{busy=false}
  });
 }
 async function load(){
  const [result,medals,campaigns]=await Promise.all([call('list'),callAchievement('list'),callEvent('list')]);
  items=result.quests||[];achievements=medals.achievements||[];events=campaigns.events||[];render();
 }
 btn.onclick=async()=>{overlay.hidden=false;status('載入中…');try{await load();status('')}catch(e){status(e.message);$('#xtankQuestList').textContent='請先登入正式玩家帳號'}};
}
