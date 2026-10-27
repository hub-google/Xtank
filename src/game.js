import {battleAudio} from './audio.js';
import * as THREE from 'three';
import './style.css';
import {OnlineConnection} from './online.js';
import {Game, TANKS, WEAPONS, OBSTACLES, MAPS, WIDTH, DEPTH} from './simulation.js';

const el = id => document.getElementById(id);
const viewport = el('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x12253e);
scene.fog = new THREE.Fog(0x12253e, 50, 98);
const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, .08, 170);
camera.position.set(24, 24, 42);
camera.lookAt(24, 0, 16);
const renderer = new THREE.WebGLRenderer({antialias:false, powerPreference:'high-performance'});
const gpuContext=renderer.getContext(),gpuDebug=gpuContext.getExtension('WEBGL_debug_renderer_info');
const gpuRenderer=gpuDebug?gpuContext.getParameter(gpuDebug.UNMASKED_RENDERER_WEBGL):'unknown';
const softwareGPU=/swiftshader|llvmpipe|software|microsoft basic|warp/i.test(gpuRenderer);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
viewport.appendChild(renderer.domElement);
const hemi = new THREE.HemisphereLight(0xc4e5ff,0x59442d,2.2); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe7c4,3.4);
sun.position.set(14,34,14);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-36;sun.shadow.camera.right=36;
sun.shadow.camera.top=36;sun.shadow.camera.bottom=-36;sun.shadow.bias=-.0005;scene.add(sun);
const mat=(c,rough=.7,metal=0)=>new THREE.MeshStandardMaterial({color:c,roughness:rough,metalness:metal});
const wood = mat(0x876247);const paper=mat(0xe5dfcc);const bluePaper=mat(0x526784);
const steel=mat(0x495c6b,.4,.45),pencilMat=mat(0xf0bd48),dark=mat(0x192430);
function box(w,h,d,material,x,y,z,parent=scene){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
  m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function cylinder(r,h,material,x,y,z,parent=scene,r2=r){
  const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r2,h,22),material);
  m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
// Original-looking miniature household setting; all geometry is newly modeled.
const desk=box(48,1,32,wood,24,-.58,16);
const grid = new THREE.GridHelper(48,24,0x7b6651,0x937559);
grid.position.set(24,-.064,16);grid.material.transparent=true;grid.material.opacity=.19;scene.add(grid);
box(49,1.6,.65,steel,24,.50,-.2); box(49,1.6,.65,steel,24,.50,32.2);
box(.65,1.6,33,steel,-.2,.50,16); box(.65,1.6,33,steel,48.2,.50,16);
const levelGroup=new THREE.Group();scene.add(levelGroup);
const squareMaterials=[mat(0xe2d6bb),mat(0x576978)];
const circuitFloor=mat(0x214a4b,.5,.2);
function buildLevel(mapId,obstacles){
  levelGroup.traverse(o=>{if(o.isMesh)o.geometry?.dispose();});
  levelGroup.clear();
  desk.material=mapId==='chess'?squareMaterials[0]:mapId==='circuit'?circuitFloor:wood;
  grid.visible=mapId==='desk';
  if(mapId==='chess'){
    for(let col=0;col<8;col++)for(let row=0;row<8;row++){
      const tile=box(5.95,.08,3.95,squareMaterials[(col+row)%2],3+col*6,.01,2+row*4,levelGroup);
      tile.castShadow=false;
    }
  } else if(mapId==='circuit'){
    const trace=mat(0x44b9a4,.45,.3);
    for(let k=0;k<10;k++){
      box(46,.035,.045,trace,24,.015,1.4+k*3.2,levelGroup).castShadow=false;
      box(.045,.035,30,trace,2.4+k*4.8,.016,16,levelGroup).castShadow=false;
    }
  }
  for(const o of obstacles){
    if(o.type==='box'){
      let material;
      if(mapId==='chess')material=mat(0x35455e,.4);
      else if(mapId==='circuit')material=mat(0x24445c,.4,.35);
      else material=o.name.includes('notebook')?bluePaper:pencilMat;
      box(o.x2-o.x1,o.height,o.z2-o.z1,material,(o.x1+o.x2)/2,o.height/2,(o.z1+o.z2)/2,levelGroup);
      if(o.name.includes('notebook')){
        box(o.x2-o.x1+.2,.08,o.z2-o.z1+.2,paper,(o.x1+o.x2)/2,o.height+.04,(o.z1+o.z2)/2,levelGroup);
        for(let i=0;i<5;i++){
          const strip=box(o.x2-o.x1-1,.018,.015,mat(0xabbdd5),(o.x1+o.x2)/2,o.height+.089,o.z1+.8+i*.7,levelGroup);
          strip.castShadow=false;
        }
      }else if(mapId==='desk'){
        cylinder(.4,o.height+1,mat(0x342c2b),(o.x1+o.x2)/2,o.height/2,(o.z1+o.z2)/2,levelGroup);
      } else if(mapId==='circuit'){
        for(let i=-2;i<=2;i++){
          box(.12,.25,.38,steel,(o.x1+o.x2)/2+(i*.8),.14,o.z1-.22,levelGroup);
          box(.12,.25,.38,steel,(o.x1+o.x2)/2+(i*.8),.14,o.z2+.22,levelGroup);
        }
      }
    } else if(o.name==='lamp'){
      cylinder(o.r,.55,steel,o.x,.28,o.z,levelGroup);
      cylinder(.30,5,steel,o.x,2.7,o.z,levelGroup);
      const shade=cylinder(2.0,.8,mat(0xf7deaa),o.x,5.2,o.z,levelGroup,1.2);
      shade.rotation.z=.16;
      const bulb=new THREE.PointLight(0xffd8a7,24,21,2);bulb.position.set(o.x,4.7,o.z);bulb.visible=renderer.shadowMap.enabled;levelGroup.add(bulb);
    } else {
      const chess=o.name.includes('white')||o.name.includes('pawn');
      cylinder(o.r,o.height,mapId==='chess'?mat(chess?0xe0cfb6:0x303748):mat(mapId==='circuit'?0x6cbeb3:0xdadadd,.36),
        o.x,o.height/2,o.z,levelGroup);
      cylinder(o.r*.82,.08,mat(mapId==='chess'?0xbaa982:0x775a44),o.x,o.height+.045,o.z,levelGroup);
    }
  }
}
buildLevel('desk',OBSTACLES);
const roomFloor=box(130,1,130,mat(0x182d3b),24,-5,16);roomFloor.receiveShadow=false;
for(let i=0;i<16;i++){
  const x=(i%8)*7+3,z=(i<8)?-2:34;
  const led=new THREE.PointLight(i%2?0x7baaff:0xffd6a0,.4,6);
  led.position.set(x,.5,z);scene.add(led);
}
const sparks=[];
let models=new Map(), bulletModels=new Map(), zoneModels=new Map(), flagGroup=null, match=null;
let paused=true,resultShown=false,last=performance.now(),accum=0;
let online=null,networkSlot=null,networkSeq=0,networkAccumulator=0,networkRoomId=null;
let networkReady=false;
let officialWeaponAllowlist=null;
let officialRound=false,roundSettlementSaved=false;
const keyboard = new Set();
let fireHeld=false, itemQueue=0, abilityQueue=false, mouseX=innerWidth*.5,mouseY=innerHeight*.53, selectedWeapon=0;
const raycaster=new THREE.Raycaster(), ground=new THREE.Plane(new THREE.Vector3(0,1,0),-.2), cursor=new THREE.Vector3();
const cameraTarget=new THREE.Vector3(24,0,16);
const weaponKeys=['hurricane','death_knight','vulcan','plasma','chemical','ion_missile','mine'];
function tankModel(t){
  const group=new THREE.Group();
  const teamGlow = mat(t.team===0?0xf96b62:0x5f9eff,.35,.4);
  const base=mat(TANKS[t.kind].color,.56,.32);
  const lower=box(1.75,.43,1.65,steel,0,.25,0,group);
  box(1.75,.48,1.3,base,0,.64,0,group);
  box(.34,.48,1.84,dark,-.90,.21,0,group);box(.34,.48,1.84,dark,.90,.21,0,group);
  for(let i=-1;i<=1;i++){
    cylinder(.24,.13,mat(0x788492),-.99,.2,i*.50,group).rotation.z=Math.PI/2;
    cylinder(.24,.13,mat(0x788492),.99,.2,i*.50,group).rotation.z=Math.PI/2;
  }
  const turret=new THREE.Group();turret.position.y=.77;group.add(turret);
  cylinder(t.kind==='D'?.63:.49,.42,base,0,.15,0,turret);
  const barrel=box(.20,.20,1.35,steel,0,.26,-.85,turret);
  box(.35,.33,.28,dark,0,.26,-1.5,turret);
  if(t.kind==='S'){box(.16,.15,1.3,steel,-.29,.26,-.87,turret);box(.16,.15,1.3,steel,.29,.26,-.87,turret);}
  if(t.kind==='A'){const antenna=cylinder(.055,1.35,mat(0xefe6be),.35,.93,.24,turret);antenna.castShadow=false;}
  if(t.kind==='O'){box(1.7,.12,.7,mat(0x8bd2f2),0,.04,.0,group);}
  const teamRing = new THREE.Mesh(new THREE.RingGeometry(.92,1.06,32),new THREE.MeshBasicMaterial({color:t.team===0?0xff655d:0x65a9fc,side:THREE.DoubleSide,transparent:true,opacity:.9}));
  teamRing.rotation.x=-Math.PI/2;teamRing.position.y=.052;group.add(teamRing);
  // Player has golden tracking cone, bots do not.
  if(t.id==='player'){
    const point=new THREE.Mesh(new THREE.ConeGeometry(.32,.56,4),new THREE.MeshBasicMaterial({color:0xffde69}));
    point.position.set(0,2.05,0);point.rotation.z=Math.PI;group.add(point);
  }
  group.userData={turret,teamRing,lower};
  group.traverse(c=>{if(c.isMesh)c.castShadow=true;});
  scene.add(group);return group;
}
const materialBullets={hurricane:mat(0xffbe61,.3,.1),vulcan:mat(0xe9efff,.2,.2),chemical:mat(0x5de8b6,.24,.12),death_knight:mat(0xff5476),plasma:mat(0x82a9ff),ion_missile:mat(0x62fff5),mine:mat(0xc3bb4d)};
function bulletModel(b){
  const radius=WEAPONS[b.kind].radius*1.5;
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,9,8),materialBullets[b.kind]);
  mesh.castShadow=false;scene.add(mesh);return mesh;
}
function makeFlag(){
  flagGroup=new THREE.Group();
  cylinder(.07,2.8,steel,0,1.4,0,flagGroup);
  const flag=box(1,.65,.04,mat(0xffd244,.35),.57,2.35,0,flagGroup);void flag;
  const orb=new THREE.Mesh(new THREE.SphereGeometry(.15,12,12),mat(0xffee9a));orb.position.y=2.85;flagGroup.add(orb);
  const ring=new THREE.Mesh(new THREE.RingGeometry(1,1.16,32),new THREE.MeshBasicMaterial({color:0xffd749,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=.03;flagGroup.add(ring);
  scene.add(flagGroup);
}
makeFlag();
function clearModels(){
  for(const m of models.values())scene.remove(m);
  for(const m of bulletModels.values())scene.remove(m);
  for(const m of zoneModels.values())scene.remove(m);
  for(const p of sparks)scene.remove(p.mesh);
  models=new Map();bulletModels=new Map();zoneModels=new Map();sparks.length=0;
}
function start(){
  paused=true;qaEvents.length=0;
  online?.close();online=null;networkSlot=null;
  try {
    clearModels();
    match=new Game({mode:el('modeSelect').value,selectedTank:el('tankSelect').value,mapId:el('mapSelect').value,seed:Date.now()>>>0});
    buildLevel(match.mapId,match.obstacles);
    for(const t of match.tanks)models.set(t.id,tankModel(t));
    resultShown=false;accum=0;keyboard.clear();fireHeld=false;itemQueue=0;abilityQueue=false;selectedWeapon=0;
    el('startMenu').hidden=true;el('resultMenu').hidden=true;el('hud').hidden=false;el('pauseBadge').hidden=true;
    camera.position.set(4,18,31);cameraTarget.set(4,0,13);
    viewUpdate(0);renderer.render(scene,camera);
    last=performance.now();accum=0;paused=false;
    updateHUD();
  } catch(e){console.error(e);el('matchInfo').textContent='啟動失敗：'+e.message;}
}
function goHome(){
  online?.close();online=null;networkSlot=null;networkRoomId=null;officialWeaponAllowlist=null;
  officialRound=false;roundSettlementSaved=false;
  el('networkLobby').hidden=true;
  paused=true;match=null;clearModels();el('startMenu').hidden=false;el('resultMenu').hidden=true;
  el('hud').hidden=true;el('pauseBadge').hidden=true;el('matchInfo').textContent='未開始';
}
function flash(color, x, z, size=.22){
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(size,8,7),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9}));
  mesh.position.set(x,.65,z);scene.add(mesh);sparks.push({mesh,life:.25,total:.25});
}
function handleEvents(events){
  for(const e of events){
    battleAudio.event(e,e.id==='player'||e.owner==='player');
    if(e.type==='fire')flash(e.weapon==='chemical'?0x56ffc7:0xffd16c,e.x,e.z,.15);
    if(e.type==='explosion')for(let i=0;i<5;i++){const a=i*Math.PI*2/5;flash(0xff9d3f,e.x+Math.cos(a)*.35,e.z+Math.sin(a)*.35,.20);}
    if(e.type==='hit'&&e.id==='player'){
      el('statusText').textContent='受到攻擊！';
    }
    if(e.type==='death'&&e.id==='player')el('statusText').textContent='坦克被擊毀 · 等待重生';
    if(e.type==='flagPickup')el('statusText').textContent=e.id==='player'?'你拿到旗幟！':'有人拿到旗幟！';
    if(e.type==='flagScore')el('statusText').textContent=e.team===0?'紅隊成功得分！':'藍隊成功得分！';
  }
}
function viewUpdate(dt){
  for(const s of sparks){s.life-=dt;s.mesh.material.opacity=Math.max(0,s.life/s.total);s.mesh.scale.setScalar(1+(1-s.life/s.total)*2);}
  for(let i=sparks.length-1;i>=0;i--){if(sparks[i].life<=0){scene.remove(sparks[i].mesh);sparks.splice(i,1);}}
  if(!match||!match.tanks.length)return;
  for(const t of match.tanks){
    let m=models.get(t.id);
    if(!m){m=tankModel(t);models.set(t.id,m);}
    m.visible=t.alive;m.position.set(t.x,.04,t.z);
    m.rotation.y=t.yaw;
    m.userData.turret.rotation.y=t.aimYaw-t.yaw;
    m.userData.teamRing.material.color.setHex(match.mode==='FFA'?0x78bdff:(t.team===0?0xff655d:0x65a9fc));
    const ownTeam=t.id==='player'||match.mode!=='FFA'&&t.team===match.tanks[0].team;
    if(t.kind==='S'&&t.abilityTime>0&&!ownTeam)m.visible=false;
  }
  const live=new Set(match.projectiles.map(b=>b.id));
  for(const [id,m] of bulletModels)if(!live.has(id)){scene.remove(m);bulletModels.delete(id);}
  for(const b of match.projectiles){
    let mesh=bulletModels.get(b.id);
    if(!mesh){mesh=bulletModel(b);bulletModels.set(b.id,mesh);}
    mesh.position.set(b.x,.84,b.z);
  }
  const zones=[...(match.smokes||[]).map(z=>({...z,zone:'smoke'})),
    ...(match.repairFields||[]).map(z=>({...z,zone:'repair'}))];
  const liveZones=new Set(zones.map(z=>z.zone+'-'+z.id));
  for(const [key,obj] of zoneModels)if(!liveZones.has(key)){scene.remove(obj);zoneModels.delete(key);}
  for(const zone of zones){
    const key=zone.zone+'-'+zone.id;
    let mesh=zoneModels.get(key);
    if(!mesh){
      const material=new THREE.MeshBasicMaterial({color:zone.zone==='smoke'?0xbec6d0:0x70e7a9,
        transparent:true,opacity:zone.zone==='smoke'?.13:.38,depthWrite:false,side:THREE.DoubleSide});
      mesh=zone.zone==='smoke'
       ?new THREE.Mesh(new THREE.CylinderGeometry(zone.radius,zone.radius,1.8,24),material)
       :new THREE.Mesh(new THREE.RingGeometry(zone.radius-.14,zone.radius,40),material);
      if(zone.zone==='repair')mesh.rotation.x=-Math.PI/2;
      scene.add(mesh);zoneModels.set(key,mesh);
    }
    mesh.position.set(zone.x,zone.zone==='smoke'?.85:.10,zone.z);
    mesh.material.opacity=(zone.zone==='smoke'?.13:.38)*Math.min(1,zone.time);
  }
  flagGroup.visible=match.mode==='FLAG_HOLD'&&!match.flag.respawn;
  if(flagGroup.visible){
    flagGroup.position.set(match.flag.x,.03,match.flag.z);
    flagGroup.children[1].rotation.y=Math.sin(performance.now()*.003)*.1;
  }
  const p=match.tanks[0];
  const follow=new THREE.Vector3(p.x,17,p.z+17);
  camera.position.lerp(follow,Math.min(1,dt*4.7));
  cameraTarget.lerp(new THREE.Vector3(p.x,.85,p.z),Math.min(1,dt*5.2));
  camera.lookAt(cameraTarget);
}
function aimYaw(){
  const r=renderer.domElement.getBoundingClientRect();
  const x=((mouseX-r.left)/r.width)*2-1,y=-((mouseY-r.top)/r.height)*2+1;
  raycaster.setFromCamera(new THREE.Vector2(x,y),camera);
  if(!raycaster.ray.intersectPlane(ground,cursor))return match?.tanks?.[0]?.aimYaw||0;
  const t=match?.tanks[0];if(!t)return 0;
  return Math.atan2(-(cursor.x-t.x),-(cursor.z-t.z));
}
function tick(dt){
  const dx=paused?0:Number(keyboard.has('KeyD'))-Number(keyboard.has('KeyA'));
  const dz=paused?0:Number(keyboard.has('KeyS'))-Number(keyboard.has('KeyW'));
  if(online){
    networkAccumulator+=dt;
    if(networkAccumulator>=.05){
      networkAccumulator=0;
      online.send({type:'INPUT',seq:++networkSeq,dx,dz,aimYaw:aimYaw(),fire:!paused&&fireHeld,
        weapon:weaponKeys[selectedWeapon],item:itemQueue,ability:abilityQueue});
      itemQueue=0;abilityQueue=false;
    }
  }else{
    const events=match.update(dt,{dx,dz,aimYaw:aimYaw(),fire:fireHeld,item:itemQueue,ability:abilityQueue});
    itemQueue=0;abilityQueue=false;handleEvents(events);
    if(match.ended)showResult();
  }
}
function showResult(){
  if(!match||resultShown)return;
  el('pauseBadge').hidden=true;
  resultShown=true;paused=true;
  const info=match.summary();
  el('resultTitle').textContent=info.title;
  el('resultStats').textContent='你的擊殺 '+info.kills+'  /  被擊毀 '+info.deaths+
    (info.rank?'  /  名次 第 '+info.rank+' 名':'')+
    (info.teamScore?'  /  紅隊 '+info.teamScore[0]+' : '+info.teamScore[1]+' 藍隊':'');
  el('resultMenu').hidden=false;
  updateRematchAvailability();
}
function updateRematchAvailability(){
  const pending=!!online&&officialRound&&!roundSettlementSaved;
  const button=el('againButton');
  button.disabled=pending;
  button.textContent=pending?'官方獎勵入帳中…':'重新開戰';
  if(resultShown&&pending&&!el('resultStats').textContent.includes('獎勵結算中'))
    el('resultStats').textContent+='  /  獎勵結算中，請保留此畫面';
}
function timeFmt(t){const seconds=Math.ceil(t);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');}
function updateHUD(){
  if(!match||!match.tanks.length)return;
  const p=match.tanks[0];
  el('hpText').textContent=Math.ceil(p.hp)+'/'+p.maxHp;
  el('shieldText').textContent=Math.ceil(p.shield)+'/'+p.maxShield;
  el('hpBar').style.width=(100*p.hp/p.maxHp)+'%';
  el('shieldBar').style.width=(100*p.shield/p.maxShield)+'%';
  const mode=match.mode==='FFA'?'個人死鬥':match.mode==='TDM'?'團隊戰':'持旗戰';
  el('matchInfo').textContent=mode+' · '+MAPS[match.mapId].name+' · '+match.tanks.length+' 台坦克';
  const ffa=[...match.tanks].sort((a,b)=>b.score-a.score);
  const score=match.mode==='FFA'?'你的擊殺 '+p.kills+' / '+match.target+'　|　榜首 '+ffa[0].score:
    '紅 '+match.scores[0]+' : '+match.scores[1]+' 藍　|　目標 '+match.target;
  el('scoreText').textContent=score+'　　'+timeFmt(match.time);
  if(!p.alive)el('statusText').textContent='重生倒數 '+Math.ceil(p.respawn)+' 秒';
  else if(match.mode==='FLAG_HOLD'&&match.flag.holder===p.id)el('statusText').textContent='持旗中 '+match.flag.holdTime.toFixed(1)+'/15 秒';
  else if(p.abilityTime>0)el('statusText').textContent='技能 '+TANKS[p.kind].ability+' '+p.abilityTime.toFixed(1)+'s';
  else el('statusText').textContent='F1 修理('+p.repair+')　F2 加速　F3 護盾('+p.shieldCells+')　F4 雷達　F5 煙霧　F6 團隊修復　E 技能';
  const weapons=weaponKeys.map((k,i)=>{
    const w=WEAPONS[k],ammo=w.ammo<0?'∞':p.ammo[k]||0;
     const locked=officialWeaponAllowlist&&!officialWeaponAllowlist.has(k);
    return '<div class="slot '+(k===p.weapon?'selected':'')+(locked?' locked':'')+'">'+(i+1)+'. '+w.name+'<small>'+(locked?'未配裝':'彈量 '+ammo)+'</small></div>';
  }).join('');
  el('weaponList').innerHTML=weapons;
  drawMap();
}
function drawMap(){
  const canvas=el('minimap'),ctx=canvas.getContext('2d');const w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#10293b';ctx.fillRect(0,0,w,h);
  const sx=w/WIDTH,sz=h/DEPTH;
  ctx.fillStyle='#526078';
  for(const o of match.obstacles){
    if(o.type==='box')ctx.fillRect(o.x1*sx,o.z1*sz,(o.x2-o.x1)*sx,(o.z2-o.z1)*sz);
    else{ctx.beginPath();ctx.arc(o.x*sx,o.z*sz,o.r*sx,0,2*Math.PI);ctx.fill();}
  }
  if(match.mode==='FLAG_HOLD'&&!match.flag.respawn){
    ctx.fillStyle='#ffdc42';ctx.beginPath();ctx.arc(match.flag.x*sx,match.flag.z*sz,4,0,2*Math.PI);ctx.fill();
  }
  const own=match.tanks[0];
  for(const t of match.tanks){
    if(!t.alive)continue;
    const enemy=t.id!=='player'&&(match.mode==='FFA'||t.team!==own.team);
    if(enemy&&Math.hypot(t.x-own.x,t.z-own.z)>15&&own.radarTime<=0&&!(own.kind==='A'&&own.abilityTime>0))continue;
    ctx.fillStyle=t.id==='player'?'#ffe46a':match.mode==='FFA'?'#ff7b70':t.team===0?'#ff8b7b':'#77b3fa';
    ctx.beginPath();ctx.arc(t.x*sx,t.z*sz,t.id==='player'?4:2.6,0,2*Math.PI);ctx.fill();
  }
}
let hudAccumulator=0,slowFrames=0,frameMs=0,qualityReduced=softwareGPU||sessionStorage.getItem('xtankLowPower')==='1';
function reduceGraphics(){
 renderer.shadowMap.enabled=false;
 scene.traverse(o=>{if(o.isPointLight)o.visible=false;});
 renderer.setPixelRatio(.75);renderer.setSize(innerWidth,innerHeight);
}
if(qualityReduced)reduceGraphics();
function animate(now){
  requestAnimationFrame(animate);
  const elapsed=Math.max(0,(now-last)/1000||0);
  const dt=Math.min(.06,elapsed);last=now;frameMs=elapsed*1000;
  // Keep simulation time independent of slow GPU frames. Visual interpolation is bounded separately.
  if(elapsed>.08)slowFrames+=elapsed;else slowFrames=Math.max(0,slowFrames-elapsed);
  if(!qualityReduced&&slowFrames>2){
    qualityReduced=true;sessionStorage.setItem('xtankLowPower','1');reduceGraphics();
  }
  if(match&&(!paused||online)){
    accum+=elapsed;
    let steps=0;
    while(accum>=1/60&&steps++<600){tick(1/60);accum-=1/60;if(paused&&!online)break;}
  }
  viewUpdate(dt);
  if(match&&!el('hud').hidden){hudAccumulator+=dt;if(hudAccumulator>=.1){updateHUD();hudAccumulator=0;}}
  renderer.render(scene,camera);
}
window.xtankAudio=battleAudio;
document.addEventListener('pointerdown',()=>battleAudio.unlock(),{passive:true});
document.addEventListener('keydown',()=>battleAudio.unlock(),{passive:true});
el('startButton').addEventListener('click',start);
el('againButton').addEventListener('click',()=>{
 if(!online)return start();
 // The authoritative room must accept the transition before UI leaves results.
 // Official rewards may still be settling; keeping the result visible prevents
 // a false appearance that the next round is ready.
 if(online.send({type:'BACK_TO_LOBBY'}))onlineStatus('正在返回房間，等待伺服器確認結算…');
});
el('returnButton').addEventListener('click',goHome);

function onlineStatus(message){el('networkStatus').textContent=message;if(match&&online&&message.includes('斷線'))el('statusText').textContent=message;}
function onlineMessage(msg){
  if(msg.type==='COUNTDOWN'){
    onlineStatus('正式對戰倒數 '+msg.seconds+' 秒，所有玩家保持準備');
    return;
  }
  if(msg.type==='COUNTDOWN_CANCELLED'){
    onlineStatus('有人取消準備或離線，已取消開局倒數');
    return;
  }
 if(msg.type==='ROOM_CHAT'){
    const log=el('roomChatMessages'),entry=document.createElement('p');
    entry.textContent=(msg.name||'玩家')+': '+String(msg.text||'').slice(0,140);
    log.append(entry);
    while(log.childElementCount>30)log.firstElementChild.remove();
    log.scrollTop=log.scrollHeight;
    return;
  }
  if(msg.type==='MATCH_SAVED'){
    roundSettlementSaved=true;
    onlineStatus('官方戰績及獎勵已寫入永久資料庫 · '+msg.matchId);
    if(resultShown&&el('resultStats')&&!el('resultStats').textContent.includes('官方獎勵已入帳'))
      el('resultStats').textContent+='  /  官方獎勵已入帳';
    updateRematchAvailability();
    window.xtankAccount?.refresh?.().catch(e=>console.warn('Profile refresh after match:',e.message));
    return;
  }
  if(msg.type==='ROOMS'){
    const list=el('publicRoomList');list.replaceChildren();list.hidden=false;
    const title=document.createElement('p');title.textContent='公開房間（點選加入）';list.append(title);
    const rooms=Array.isArray(msg.rooms)?msg.rooms:[];
    if(!rooms.length){const empty=document.createElement('p');empty.textContent='沒有開放中的公開房間';list.append(empty);}
    for(const room of rooms){
      const button=document.createElement('button');button.type='button';button.className='secondary';
      button.textContent=room.roomId+' · '+room.mode+' · '+(MAPS[room.mapId]?.name||room.mapId)+' · '+room.players+'/'+room.capacity;
      button.addEventListener('click',()=>{
        el('roomCode').value=room.roomId;
        el('roomPassword').value='';
        el('publicRoomList').hidden=true;
        establishNetwork('JOIN');
      });
      list.append(button);
    }
    onlineStatus('已取得 '+rooms.length+' 間公開房間');return;
  }
 if(msg.type==='ERROR'){
  onlineStatus('伺服器拒絕：'+msg.code);
  if(resultShown&&msg.code==='MATCH_SETTLEMENT_PENDING')updateRematchAvailability();
  return;
 }
 if(msg.type==='JOINED'){
  networkRoomId=msg.roomId;networkReady=false;el('roomChatMessages').replaceChildren();onlineStatus('已加入房間 '+msg.roomId);
  el('roomCode').value=msg.roomId;el('networkLobby').hidden=false;return;
 }
 if(msg.type==='LOBBY'){
  el('networkLobby').hidden=false;
  el('roomDetails').textContent='房間 '+msg.roomId+' · '+msg.mode+' · '+(MAPS[msg.mapId]?.name||'地圖')+' · '+msg.phase;
  el('roomPeople').textContent=msg.people.map(p=>(p.host?'房主 ':'')+p.name+(msg.mode==='FFA'?'':p.team===0?' [紅隊]':' [藍隊]')+(p.ready?' ✓已準備':' · 未準備')+(p.connected?' ●':' ○')).join('、');
  const me=msg.people.find(player=>player.id===online?.playerId);
  el('teamChoose').hidden=msg.mode==='FFA'||msg.phase!=='lobby';
  if(me&&msg.mode!=='FFA')el('teamChoose').value=String(me.team);
   networkReady=!!msg.people.find(p=>p.id===online?.playerId)?.ready;
   el('readyNetworkButton').hidden=msg.phase!=='lobby'&&msg.phase!=='countdown';
   el('readyNetworkButton').textContent=networkReady?'取消準備':'準備';
  el('startNetworkButton').hidden=msg.hostId!==online?.playerId||msg.phase!=='lobby';
  if(msg.phase==='lobby'&&match&&resultShown){
    match=null;paused=true;resultShown=false;officialRound=false;roundSettlementSaved=false;
    el('resultMenu').hidden=true;el('startMenu').hidden=false;el('hud').hidden=true;
  }
  return;
 }
 if(msg.type==='START'){
  officialRound=msg.official===true;roundSettlementSaved=false;
  qaEvents.length=0;
  networkSlot=msg.slotId;networkSeq=0;networkAccumulator=0;
   officialWeaponAllowlist=msg.official&&Array.isArray(msg.allowedWeapons)?new Set(msg.allowedWeapons):null;
  clearModels();
  match=new Game({mode:msg.mode||el('modeSelect').value,selectedTank:el('tankSelect').value,mapId:msg.mapId||'desk'});
  buildLevel(match.mapId,match.obstacles);
  // Rendering uses snapshots; never run a second combat simulation in this client.
  match.tanks=[];match.projectiles=[];
  match.mode=msg.mode||match.mode;
  paused=false;resultShown=false;accum=0;
  keyboard.clear();fireHeld=false;itemQueue=0;abilityQueue=false;
  selectedWeapon=officialWeaponAllowlist?Math.max(0,weaponKeys.findIndex(k=>officialWeaponAllowlist.has(k))):0;
  el('startMenu').hidden=true;el('resultMenu').hidden=true;el('hud').hidden=false;
  el('pauseBadge').hidden=true;
  onlineStatus('已進入真正的連線房間 '+msg.roomId);
  return;
 }
 if(msg.type==='SNAPSHOT'&&online&&networkSlot&&match){
  qaNetworkFrames.push(msg);if(qaNetworkFrames.length>10)qaNetworkFrames.shift();
  if(msg.mapId&&msg.mapId!==match.mapId&&MAPS[msg.mapId]){
    match.mapId=msg.mapId;match.obstacles=MAPS[msg.mapId].obstacles;
    buildLevel(match.mapId,match.obstacles);
  }
  const alias=id=>id===networkSlot?'player':id==='player'?'remote-host':id;
  match.mode=msg.mode;match.time=msg.time;match.tick=msg.tick;
  match.scores=msg.score;match.target=msg.target;match.ended=msg.ended;
  match.flag={...msg.flag,holder:msg.flag.holder?alias(msg.flag.holder):null};
  const tanks=msg.tanks.map(t=>({...t,id:alias(t.id)}));
  tanks.sort((a,b)=>Number(b.id==='player')-Number(a.id==='player'));
  match.tanks=tanks;
  match.projectiles=msg.projectiles.map(b=>({...b,owner:alias(b.owner)}));
  match.smokes=msg.smokes||[];match.repairFields=msg.repairFields||[];
  handleEvents((msg.events||[]).map(e=>({...e,id:e.id?alias(e.id):e.id,
    owner:e.owner?alias(e.owner):e.owner})));
  if(match.ended)showResult();
 }
}
async function establishNetwork(action){
 const accessToken=window.xtankAccount?.getAccessToken?await window.xtankAccount.getAccessToken().catch(()=>null):null;
 online?.close();match=null;paused=true;networkSlot=null;
 online=new OnlineConnection(onlineMessage,onlineStatus);
 try{
  online.open(el('serverAddress').value.trim(),{
    type:action,name:el('playerName').value.trim()||'Player',accessToken,
    tank:el('tankSelect').value,mode:el('modeSelect').value,mapId:el('mapSelect').value,
    roomId:el('roomCode').value.trim().toUpperCase(),password:el('roomPassword').value
  });
 }catch(e){onlineStatus('設定錯誤：'+e.message);online=null;}
}
el('makeRoomButton').addEventListener('click',()=>establishNetwork('CREATE'));
el('joinRoomButton').addEventListener('click',()=>establishNetwork('JOIN'));
 el('listRoomsButton').addEventListener('click',()=>establishNetwork('LIST_ROOMS'));
 el('quickMatchButton').addEventListener('click',()=>establishNetwork('QUICK_MATCH'));
 el('readyNetworkButton').addEventListener('click',()=>online?.send({type:'READY',ready:!networkReady}));
 el('teamChoose').addEventListener('change',()=>online?.send({type:'TEAM',team:Number(el('teamChoose').value)}));
 el('roomChatForm').addEventListener('submit',event=>{
   event.preventDefault();
   const input=el('roomChatInput'),text=input.value.trim();
   if(text&&online?.send({type:'CHAT',text}))input.value='';
 });
el('startNetworkButton').addEventListener('click',()=>online?.send({type:'START'}));
el('leaveNetworkButton').addEventListener('click',()=>{
 online?.close();online=null;networkSlot=null;el('networkLobby').hidden=true;
 onlineStatus('已離開多人房間');
});
el('hostServerButton').addEventListener('click',async()=>{
 if(!window.xtankHost){onlineStatus('瀏覽器不能開伺服器。請使用 Windows EXE，或在主機執行 npm run server。');return;}
 try{
  onlineStatus('正在啟動 LAN 伺服器…');
  const details=await window.xtankHost.start();
  el('serverAddress').value='ws://127.0.0.1:'+details.port;
  onlineStatus('LAN 伺服器已啟動！\n將下列網址告訴同一網路的朋友：\n'+details.urls.join('\n'));
 }catch(e){onlineStatus('無法啟動：'+e.message);}
});
window.addEventListener('keydown',e=>{
  if(['Space','ArrowUp','ArrowDown','F1','F2','F3','F4','F5','F6'].includes(e.code))e.preventDefault();
  if(e.repeat&&['KeyP','KeyE','F1','F2','F3','F4','F5','F6','Escape'].includes(e.code))return;
  keyboard.add(e.code);
  if(e.code==='KeyP'&&match&&!resultShown){paused=!paused;el('pauseBadge').hidden=!paused;fireHeld=false;}
  if(e.code==='Escape'&&match&&!resultShown){paused=!paused;el('pauseBadge').hidden=!paused;fireHeld=false;keyboard.clear();itemQueue=0;abilityQueue=false;el('pauseTitle').textContent=online?'選單 · 連線對局持續進行':'暫停中 · 按 P 繼續';}
  if(!match||paused)return;
  if(/^Digit[1-7]$/.test(e.code)){
    const candidate=Number(e.code.slice(-1))-1;
     if(!officialWeaponAllowlist||officialWeaponAllowlist.has(weaponKeys[candidate])){
       selectedWeapon=candidate;
       if(match.tanks[0])match.tanks[0].weapon=weaponKeys[selectedWeapon];
     }else el('statusText').textContent='此武器尚未裝備，請到機庫配裝';
  }
  if(e.code==='F1')itemQueue=1;
  if(e.code==='F2')itemQueue=2;
  if(e.code==='F3')itemQueue=3;
  if(e.code==='F4')itemQueue=4;
  if(e.code==='F5')itemQueue=5;
  if(e.code==='F6')itemQueue=6;
  if(e.code==='KeyE')abilityQueue=true;
  if(e.code==='Space')fireHeld=true;
});
window.addEventListener('keyup',e=>{keyboard.delete(e.code);if(e.code==='Space')fireHeld=false;});
renderer.domElement.addEventListener('mousemove',e=>{mouseX=e.clientX;mouseY=e.clientY;});
renderer.domElement.addEventListener('mousedown',e=>{if(e.button===0)fireHeld=true;});
window.addEventListener('mouseup',e=>{if(e.button===0)fireHeld=false;});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('blur',()=>{keyboard.clear();fireHeld=false;});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
requestAnimationFrame(animate);

// Read-only diagnostics: real inputs still pass through normal DOM handlers.
const qaEvents=[];
const qaNetworkFrames=[];
const qaHandle=handleEvents;
handleEvents=function(events){
 qaEvents.push(...events.map(e=>({...e,tick:match?.tick})));
 if(qaEvents.length>4000)qaEvents.splice(0,qaEvents.length-4000);
 return qaHandle(events);
};
Object.defineProperty(window,'xtankDiagnostics',{value:()=>JSON.parse(JSON.stringify({
 now:performance.now()/1000,gpuRenderer,softwareGPU,frameMs,viewport:{width:innerWidth,height:innerHeight},qualityReduced,paused,online:!!online,networkSlot,networkRoomId,
 match:match?{mode:match.mode,mapId:match.mapId,time:match.time,tick:match.tick,ended:match.ended,
 tanks:match.tanks,projectiles:match.projectiles,scores:match.scores,flag:match.flag,
 smokes:match.smokes,repairFields:match.repairFields}:null,
 events:qaEvents,networkFrames:qaNetworkFrames,networkStatus:el('networkStatus').textContent,screen:match?.tanks.map(t=>{const v=new THREE.Vector3(t.x,.84,t.z).project(camera);return {id:t.id,x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2,visible:v.z<1};}),render:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
 frame:renderer.info.render.frame},camera:camera.position.toArray()
})),writable:false});

el('resumeButton').addEventListener('click',()=>{paused=false;el('pauseBadge').hidden=true;});
el('pauseHomeButton').addEventListener('click',goHome);
