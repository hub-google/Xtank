// Headless, deterministic rules core. All numbers are prototype proposals, not original game data.
export const WIDTH = 48, DEPTH = 32, RADIUS = 0.7;
export const TANKS = Object.freeze({
  X: {hp:100, shield:65, speed:7.4, power:1, collision:1.10, color:0xf6cc50, ability:'nitro'},
  D: {hp:140, shield:85, speed:5.6, power:1.12, collision:1.15, color:0x8a8fc4, ability:'accel'},
  M: {hp:130, shield:75, speed:6.0, power:1.16, collision:1.30, color:0xe58057, ability:'nitro'},
  R: {hp:95, shield:40, speed:10, power:.82, collision:.85, color:0x74df93, ability:'defense'},
  H: {hp:95, shield:45, speed:9.2, power:.88, collision:.90, color:0xf39a6c, ability:'defense'},
  A: {hp:110, shield:60, speed:8.2, power:1.03, collision:1.05, color:0x86c3f3, ability:'radar'},
  O: {hp:85, shield:95, speed:7.0, power:.92, collision:1.0, color:0xb3a2f2, ability:'defense'},
  S: {hp:90, shield:52, speed:6.6, power:1.2, collision:.8, color:0xf27daf, ability:'invisible'},
});
export const OBSTACLES = [
  {type:'box', x1:21,z1:22,x2:27,z2:29,height:2.2,name:'north-notebook'},
  {type:'box', x1:21,z1:3,x2:27,z2:10,height:2.2,name:'south-notebook'},
  {type:'box', x1:13,z1:20,x2:18,z2:21.5,height:1,name:'nw-pencil'},
  {type:'box', x1:13,z1:10.5,x2:18,z2:12,height:1,name:'sw-pencil'},
  {type:'box', x1:30,z1:20,x2:35,z2:21.5,height:1,name:'ne-pencil'},
  {type:'box', x1:30,z1:10.5,x2:35,z2:12,height:1,name:'se-pencil'},
  {type:'circle',x:24,z:16,r:2.5,height:3.2,name:'lamp'},
  {type:'circle',x:9,z:16,r:2.3,height:3,name:'left-cup'},
  {type:'circle',x:39,z:16,r:2.3,height:3,name:'right-cup'},
];
export const WEAPONS = Object.freeze({
  hurricane: {name:'颶風飛彈',cooldown:.68,speed:32,damage:23,radius:.19,range:38,splash:0,ammo:-1},
  vulcan: {name:'火神機炮',cooldown:.13,speed:52,damage:7,radius:.11,range:27,splash:0,ammo:-1},
  chemical: {name:'化學爆破彈',cooldown:1.55,speed:23,damage:37,radius:.30,range:34,splash:3.5,ammo:18},
  death_knight: {name:'死亡騎士',cooldown:.85,speed:40,damage:30,radius:.18,range:44,splash:0,ammo:-1},
  plasma: {name:'電漿炮',cooldown:.19,speed:48,damage:10,radius:.14,range:28,splash:0,ammo:-1},
  ion_missile: {name:'離子導彈',cooldown:2.5,speed:19,damage:42,radius:.25,range:37,splash:2.1,ammo:8,homing:true},
  mine: {name:'接觸地雷',cooldown:1.3,speed:0,damage:45,radius:.25,range:0,splash:2.6,ammo:5,mine:true},
});
const RED = 0, BLUE = 1;
const SPAWN_RED=[[4,6],[4,13],[4,19],[4,26]];
const SPAWN_BLUE=[[44,6],[44,13],[44,19],[44,26]];
const FFA_SPAWNS=[[4,5],[44,5],[4,27],[44,27],[12,4],[36,28]];
const FLAG_SPAWNS=[[24,12.8],[24,19.2],[19,16],[29,16]];
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const len=(x,z)=>Math.hypot(x,z)||1;
const norm=(x,z)=>{const d=len(x,z);return [x/d,z/d]};
function blocked(x,z,r=RADIUS){
  if(x<r+.8||z<r+.8||x>WIDTH-r-.8||z>DEPTH-r-.8)return true;
  for(const o of OBSTACLES){
    if(o.type==='box'){const a=clamp(x,o.x1,o.x2),b=clamp(z,o.z1,o.z2);if((x-a)**2+(z-b)**2<(r+.06)**2)return true;}
    else if(Math.hypot(x-o.x,z-o.z)<r+o.r+.06)return true;
  }
  return false;
}
export function isWalkable(x,z,r=RADIUS){return !blocked(x,z,r);}
function seeded(seed){let a=seed>>>0;return ()=>{a=(Math.imul(a,1664525)+1013904223)>>>0;return a/4294967296;};}
function tank(id,kind,team,x,z){
  const cfg=TANKS[kind];
  return {id,kind,team,x,z,yaw:0,aimYaw:0,hp:cfg.hp,shield:cfg.shield,maxHp:cfg.hp,maxShield:cfg.shield,
    alive:true,respawn:0,kills:0,deaths:0,assists:0,score:0,damage:0,cooldown:0,weapon:'hurricane',
    ammo:{chemical:18,ion_missile:8,mine:5}, repair:2,repairCooldown:0,boostCooldown:0,boostTime:0,abilityCooldown:0,abilityTime:0,
    lastDamage:0,aiDir:0,aiThink:0,aiStrafe:1,vx:0,vz:0};
}
export class Game {
  constructor({mode='FFA',selectedTank='X',seed=42,size}={}){
    if(!['FFA','TDM','FLAG_HOLD'].includes(mode))throw Error('invalid mode');
    if(!TANKS[selectedTank])throw Error('invalid tank');
    this.mode=mode;this.rng=seeded(seed);this.time=mode==='FFA'?300:480;this.tick=0;this.ended=false;
    this.events=[];this.projectiles=[];this.scores=[0,0];this.humanIds=null;this.collisionTimes=new Map();this.nextBullet=0;this.target=mode==='FFA'?12:mode==='TDM'?30:5;
    const kinds=['X','D','M','R','H','A','O','S'];
    this.tanks=[tank('player',selectedTank,RED,4,13)];
    if(mode==='FFA'){
      const points=[...FFA_SPAWNS.slice(1),[12,28],[36,4],[24,1.6]];
      const count=Math.max(2,Math.min(8,Number.isInteger(size)?size:4));
      for(let i=0;i<count-1;i++){const t=tank('bot'+i,kinds[(i+1)%8],i+1,...points[i]);t.weapon=i===1?'vulcan':'hurricane';this.tanks.push(t);}
    } else {
      let i=0;
      for(const p of SPAWN_RED.slice(1)){this.tanks.push(tank('bot'+i,kinds[(i+1)%8],RED,...p));i++;}
      for(const p of SPAWN_BLUE){this.tanks.push(tank('bot'+i,kinds[(i+1)%8],BLUE,...p));i++;}
    }
    this.flag={x:24,z:4,holder:null,holdTime:0,respawn:0,spawnIndex:0};
    this.spawnFlag();
  }
  spawnFlag(){
    const valid=FLAG_SPAWNS.filter(([x,z])=>isWalkable(x,z,.8));
    if(!valid.length)throw Error('flag map has no valid spawn');
    this.flag.spawnIndex=Math.floor(this.rng()*valid.length);
    [this.flag.x,this.flag.z]=valid[this.flag.spawnIndex];
    this.flag.holder=null;this.flag.holdTime=0;this.flag.respawn=0;
  }
  move(t,ax,az,dt){
    if(!t.alive)return;
    let [vx,vz]=norm(ax,az);
    if(Math.abs(ax)+Math.abs(az)<.001){vx=0;vz=0;}
    let speed=TANKS[t.kind].speed*(t.boostTime>0?1.25:1);
    if(t.abilityTime>0&&TANKS[t.kind].ability==='accel')speed*=1.3;
    // The flag speed reduction is a prototype rule, not original historical data.
    if(this.mode==='FLAG_HOLD'&&this.flag.holder===t.id)speed*=.9;
    const beforeX=t.x,beforeZ=t.z;
    const nx=t.x+vx*speed*dt,nz=t.z+vz*speed*dt;
    if(!blocked(nx,t.z))t.x=nx;
    if(!blocked(t.x,nz))t.z=nz;
    t.vx=(t.x-beforeX)/Math.max(dt,.0001);
    t.vz=(t.z-beforeZ)/Math.max(dt,.0001);
    if(vx||vz)t.yaw=Math.atan2(-vx,-vz);
  }
  resolveTankCollisions(){
    for(let i=0;i<this.tanks.length;i++)for(let j=i+1;j<this.tanks.length;j++){
      const a=this.tanks[i],b=this.tanks[j];
      if(!a.alive||!b.alive)continue;
      const dx=b.x-a.x,dz=b.z-a.z,distance=Math.hypot(dx,dz);
      if(distance>=RADIUS*2)continue;
      const nx=distance>.0001?dx/distance:1,nz=distance>.0001?dz/distance:0;
      const overlap=RADIUS*2-distance;
      const ax=a.x-nx*overlap*.5,az=a.z-nz*overlap*.5;
      const bx=b.x+nx*overlap*.5,bz=b.z+nz*overlap*.5;
      if(!blocked(ax,az)){a.x=ax;a.z=az;}
      if(!blocked(bx,bz)){b.x=bx;b.z=bz;}
      const key=[a.id,b.id].sort().join('|');
      if((this.collisionTimes.get(key)||-100)+.6>this.tick)continue;
      const speed=Math.hypot(a.vx-b.vx,a.vz-b.vz);
      if(speed<2)continue;
      this.collisionTimes.set(key,this.tick);
      this.events.push({type:'ram',x:(a.x+b.x)/2,z:(a.z+b.z)/2});
      if(this.mode==='FFA'||a.team!==b.team){
        const damageA=Math.min(35,(speed-2)*4*TANKS[b.kind].collision);
        const damageB=Math.min(35,(speed-2)*4*TANKS[a.kind].collision);
        this.hit(a,damageA,b.id);this.hit(b,damageB,a.id);
      }
    }
  }
  fire(t){
    if(!t.alive||t.cooldown>0||this.ended)return false;
    const w=WEAPONS[t.weapon];
    if(!w) return false;
    if(w.ammo>0&&(t.ammo[t.weapon]||0)<=0)return false;
    if(w.ammo>0)t.ammo[t.weapon]--;
    t.cooldown=w.cooldown;
    const dx=-Math.sin(t.aimYaw), dz=-Math.cos(t.aimYaw);
    if(w.mine){
      const owned=this.projectiles.filter(p=>p.alive&&p.kind==='mine'&&p.owner===t.id);
      if(owned.length>=3)owned[0].alive=false;
    }
    this.projectiles.push({id:++this.nextBullet,owner:t.id,team:t.team,kind:t.weapon,
      x:w.mine?t.x:t.x+dx*.95,z:w.mine?t.z:t.z+dz*.95,
      vx:dx*w.speed,vz:dz*w.speed,travel:0,age:0,alive:true});
    this.events.push({type:'fire',x:t.x,z:t.z,owner:t.id,weapon:t.weapon});
    return true;
  }
  hit(t,damage,owner){
    if(!t.alive||this.ended||damage<=0)return;
    const source=this.tanks.find(x=>x.id===owner);
    if(this.mode!=='FFA'&&source&&source.team===t.team)return;
    if(t.abilityTime>0&&TANKS[t.kind].ability==='defense')damage*=.75;
    const absorb=Math.min(t.shield,damage);
    t.shield-=absorb;t.hp=Math.max(0,t.hp-(damage-absorb));t.lastDamage=this.tick;
    if(source)source.damage+=damage;
    this.events.push({type:'hit',x:t.x,z:t.z,id:t.id,damage});
    if(t.hp<=0){
      t.alive=false;t.respawn=4;t.deaths++;
      if(source&&source.id!==t.id){source.kills++;source.score++;if(this.mode==='FFA'){if(source.score>=this.target)this.ended=true;}
        else if(this.mode==='TDM'){this.scores[source.team]++;if(this.scores[source.team]>=this.target)this.ended=true;}}
      if(this.flag.holder===t.id){this.flag.holder=null;this.flag.respawn=3;this.flag.holdTime=0;this.flag.x=t.x;this.flag.z=t.z;}
      this.events.push({type:'death',x:t.x,z:t.z,id:t.id,owner});
    }
  }
  detonate(b){
    const w=WEAPONS[b.kind];this.events.push({type:'explosion',x:b.x,z:b.z,weapon:b.kind});
    if(w.splash>0){
      for(const t of this.tanks){
        const d=Math.hypot(t.x-b.x,t.z-b.z);
        if(t.alive&&t.id!==b.directHit&&d<w.splash+RADIUS)this.hit(t,w.damage*clamp(1-d/(w.splash+RADIUS),.2,1),b.owner);
      }
    }
  }
  respawnTank(t){
    const points=this.mode==='FFA'?FFA_SPAWNS:t.team===RED?SPAWN_RED:SPAWN_BLUE;
    const spots=[...points].filter(([x,z])=>isWalkable(x,z));
    spots.sort((a,b)=>{
      const dist=p=>Math.min(...this.tanks.filter(o=>o.alive&&o.team!==t.team&&o.id!==t.id).map(o=>Math.hypot(o.x-p[0],o.z-p[1])),99);
      return dist(b)-dist(a);
    });
    if(!spots.length)return;
    [t.x,t.z]=spots[0];
    t.hp=t.maxHp;t.shield=t.maxShield;t.alive=true;t.respawn=0;t.cooldown=.8;t.boostTime=0;t.abilityTime=0;t.ammo={chemical:18,ion_missile:8,mine:5};
    this.events.push({type:'respawn',id:t.id,x:t.x,z:t.z});
  }
  useItem(t,index){
    if(!t||!t.alive)return false;
    if(index===1&&t.repair>0&&t.repairCooldown<=0&&t.hp<t.maxHp){
      t.hp=Math.min(t.maxHp,t.hp+30);t.repair--;t.repairCooldown=25;
      this.events.push({type:'repair',id:t.id,x:t.x,z:t.z});return true;
    }
    if(index===2&&t.boostCooldown<=0){
      t.boostTime=5;t.boostCooldown=30;
      this.events.push({type:'boost',id:t.id,x:t.x,z:t.z});return true;
    }
    return false;
  }
  useAbility(t){
    if(!t||!t.alive||t.abilityCooldown>0||t.hp<=14)return false;
    t.abilityTime=6;t.abilityCooldown=20;t.hp-=12;
    this.events.push({type:'ability',id:t.id,x:t.x,z:t.z});return true;
  }
  ai(t,dt){
    t.aiThink-=dt;
    const enemies=this.tanks.filter(v=>v.alive&&v.id!==t.id&&(this.mode==='FFA'||v.team!==t.team));
    if(!enemies.length)return;
    enemies.sort((a,b)=>Math.hypot(a.x-t.x,a.z-t.z)-Math.hypot(b.x-t.x,b.z-t.z));
    let target=enemies[0];
    let gx=target.x,gz=target.z;
    if(this.mode==='FLAG_HOLD'&&!this.flag.holder){gx=this.flag.x;gz=this.flag.z;}
    else if(this.mode==='FLAG_HOLD'&&this.flag.holder&&this.flag.holder!==t.id){
      const holder=this.tanks.find(x=>x.id===this.flag.holder);
      if(holder&&holder.team!==t.team){gx=holder.x;gz=holder.z;}
    }
    if(t.aiThink<=0){t.aiThink=.5+this.rng()*.7;t.aiStrafe=this.rng()>.5?1:-1;}
    const dx=gx-t.x,dz=gz-t.z,d=Math.hypot(dx,dz);
    let vx=d>4?dx:dx*.1-dz*t.aiStrafe*.7;
    let vz=d>4?dz:dz*.1+dx*t.aiStrafe*.7;
    if(blocked(t.x+vx/Math.max(1,d)*1.1,t.z+vz/Math.max(1,d)*1.1)){vx=-dz*t.aiStrafe;vz=dx*t.aiStrafe;}
    const [mx,mz]=norm(vx,vz);this.move(t,mx,mz,dt);
    const a=Math.atan2(-(target.x-t.x),-(target.z-t.z));
    t.aimYaw=a;
    if(Math.hypot(target.x-t.x,target.z-t.z)<27&&this.rng()<.70)this.fire(t);
    if(t.hp<t.maxHp*.4&&t.repair>0)this.useItem(t,1);
    if(this.mode==='FLAG_HOLD'&&this.flag.holder===t.id&&!t.boostTime)this.useItem(t,2);
  }
  update(dt,input={},inputsById={}){
    if(this.ended)return [];
    dt=clamp(dt,0,.05);this.events=[];this.tick+=dt;this.time=Math.max(0,this.time-dt);
    for(const t of this.tanks){
      for(const key of ['cooldown','repairCooldown','boostCooldown','boostTime','abilityCooldown','abilityTime']) t[key]=Math.max(0,t[key]-dt);
      if(!t.alive){t.respawn-=dt;if(t.respawn<=0)this.respawnTank(t);continue;}
      // Shield recovery after the last 6s with no damage (prototype).
      if(this.tick-t.lastDamage>6)t.shield=Math.min(t.maxShield,t.shield+4*dt);
      if(t.abilityTime>0){t.hp=Math.max(1,t.hp-2*dt);}
      if(this.humanIds?this.humanIds.has(t.id):t.id==='player'){
        const cmd=this.humanIds ? inputsById[t.id]||{} : input;
        this.move(t,cmd.dx||0,cmd.dz||0,dt);
        if(Number.isFinite(cmd.aimYaw))t.aimYaw=cmd.aimYaw;
        if(cmd.weapon&&WEAPONS[cmd.weapon])t.weapon=cmd.weapon;
        if(cmd.fire)this.fire(t);
        if(cmd.item)this.useItem(t,cmd.item);
        if(cmd.ability)this.useAbility(t);
      }else this.ai(t,dt);
    }
    this.resolveTankCollisions();
    for(const b of this.projectiles){
      if(!b.alive)continue;
      const w=WEAPONS[b.kind];
      b.age=(b.age||0)+dt;
      if(w.mine){
        if(b.age>15){b.alive=false;continue;}
        if(b.age>.8&&this.tanks.some(t=>t.alive&&t.id!==b.owner&&(this.mode==='FFA'||t.team!==b.team)
          &&Math.hypot(t.x-b.x,t.z-b.z)<1.25)){
          b.alive=false;this.detonate(b);
        }
        continue;
      }
      if(w.homing){
        const enemies=this.tanks.filter(t=>t.alive&&t.id!==b.owner&&(this.mode==='FFA'||t.team!==b.team));
        enemies.sort((a,c)=>Math.hypot(a.x-b.x,a.z-b.z)-Math.hypot(c.x-b.x,c.z-b.z));
        const target=enemies[0];
        if(target&&Math.hypot(target.x-b.x,target.z-b.z)<24){
          const wanted=Math.atan2(target.z-b.z,target.x-b.x);
          const current=Math.atan2(b.vz,b.vx);
          let difference=Math.atan2(Math.sin(wanted-current),Math.cos(wanted-current));
          const next=current+clamp(difference,-2.4*dt,2.4*dt);
          b.vx=Math.cos(next)*w.speed;b.vz=Math.sin(next)*w.speed;
        }
      }
      const step=Math.max(1,Math.ceil(w.speed*dt/.3)),dx=b.vx*dt/step,dz=b.vz*dt/step;
      for(let k=0;k<step;k++){
        b.x+=dx;b.z+=dz;b.travel+=Math.hypot(dx,dz);
        if(blocked(b.x,b.z,w.radius)||b.travel>w.range){
          b.alive=false;this.detonate(b);break;
        }
        const hit=this.tanks.find(t=>t.alive&&t.id!==b.owner&&(this.mode==='FFA'||t.team!==b.team)&&Math.hypot(b.x-t.x,b.z-t.z)<RADIUS+w.radius);
        if(hit){b.directHit=hit.id;this.hit(hit,w.damage*TANKS[this.tanks.find(t=>t.id===b.owner)?.kind||'X'].power*(this.tanks.find(t=>t.id===b.owner)?.abilityTime>0&&TANKS[this.tanks.find(t=>t.id===b.owner)?.kind||'X'].ability==='nitro'?1.2:1),b.owner);
          b.alive=false;this.detonate(b);break;}
      }
    }
    this.projectiles=this.projectiles.filter(p=>p.alive);
    if(this.mode==='FLAG_HOLD'){
      if(this.flag.respawn>0){this.flag.respawn=Math.max(0,this.flag.respawn-dt);if(!this.flag.respawn)this.spawnFlag();}
      else if(this.flag.holder){
        const h=this.tanks.find(t=>t.id===this.flag.holder);
        if(!h||!h.alive){this.flag.holder=null;this.flag.respawn=3;this.flag.holdTime=0;}
        else {this.flag.x=h.x;this.flag.z=h.z;this.flag.holdTime+=dt;
          if(this.flag.holdTime>=15){this.scores[h.team]++;h.score++;this.events.push({type:'flagScore',team:h.team});
            if(this.scores[h.team]>=this.target)this.ended=true;else this.spawnFlag();}}
      } else {
        const picker=this.tanks.find(t=>t.alive&&Math.hypot(t.x-this.flag.x,t.z-this.flag.z)<1.6);
        if(picker){this.flag.holder=picker.id;this.flag.holdTime=0;this.events.push({type:'flagPickup',id:picker.id});}
      }
    }
    if(this.time<=0)this.ended=true;
    if(this.ended)this.events.push({type:'gameover'});
    return this.events;
  }
  summary(){
    const p=this.tanks[0];
    if(this.mode==='FFA'){
      const leaderboard=[...this.tanks].sort((a,b)=>b.score-a.score||a.deaths-b.deaths||b.damage-a.damage);
      return {title:leaderboard[0].id==='player'?'你贏了！':'對戰結束',rank:leaderboard.findIndex(t=>t.id==='player')+1,kills:p.kills,deaths:p.deaths,score:p.score,teamScore:null};
    }
    const winner=this.scores[RED]===this.scores[BLUE]?'平手':this.scores[RED]>this.scores[BLUE]?'你的小隊獲勝！':'敵隊獲勝';
    return {title:winner,rank:null,kills:p.kills,deaths:p.deaths,score:p.score,teamScore:[...this.scores]};
  }
}
