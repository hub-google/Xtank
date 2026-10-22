import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,TANKS,WEAPONS,isWalkable} from './simulation.js';
test('eight distinct selectable tanks and weapon definitions',()=>{
 assert.equal(Object.keys(TANKS).length,8);assert.equal(Object.keys(WEAPONS).length,7);
 for(const kind of Object.keys(TANKS)) assert.equal(new Game({selectedTank:kind}).tanks[0].kind,kind);
});
test('tanks cannot move through giant desk obstacles or off map',()=>{
 const g=new Game({selectedTank:'R'});const p=g.tanks[0];
 for(let i=0;i<700;i++)g.move(p,-1,0,1/60);
 assert.ok(p.x>1);assert.ok(isWalkable(p.x,p.z));
 p.x=19;p.z=25;
 for(let i=0;i<200;i++)g.move(p,1,0,1/60);
 assert.ok(p.x<21);assert.ok(isWalkable(p.x,p.z));
});
test('weapon cooldown and ammo cannot be bypassed by spam',()=>{
 const g=new Game();const p=g.tanks[0];p.weapon='chemical';
 assert.equal(g.fire(p),true);assert.equal(g.fire(p),false);assert.equal(p.ammo.chemical,17);
 p.cooldown=0;assert.equal(g.fire(p),true);assert.equal(p.ammo.chemical,16);
});
test('damage consumes shield first; duplicate kills impossible',()=>{
 const g=new Game();const e=g.tanks[1];const p=g.tanks[0];
 g.hit(e,e.shield+20,p.id);assert.equal(e.shield,0);assert.ok(e.hp<e.maxHp);
 g.hit(e,999,p.id);g.hit(e,999,p.id);assert.equal(p.kills,1);assert.equal(e.deaths,1);
});
test('flag pickup only one holder and deterministic scoring',()=>{
 const g=new Game({mode:'FLAG_HOLD'});const p=g.tanks[0],b=g.tanks[4];
 p.x=g.flag.x;p.z=g.flag.z;b.x=g.flag.x;b.z=g.flag.z;
 g.update(.02,{});assert.equal(g.flag.holder,'player');
 p.hp=1;g.hit(p,999,b.id);assert.equal(g.flag.holder,null);
});
test('repair never exceeds maximum hp',()=>{
 const g=new Game();const p=g.tanks[0];p.hp=p.maxHp-8;
 assert.equal(g.useItem(p,1),true);assert.equal(p.hp,p.maxHp);assert.equal(p.repair,1);
 assert.equal(g.useItem(p,1),false);
});
test('selected tank health and mode player count',()=>{
 for(const mode of ['FFA','TDM','FLAG_HOLD']){
  const g=new Game({mode});assert.equal(g.tanks.length,mode==='FFA'?4:8);
  const s=g.summary();assert.ok(s.title);
 }
});

test('ramming physically separates tanks and causes shield damage only once per cooldown',()=>{
 const g=new Game({mode:'FFA',selectedTank:'X'}),a=g.tanks[0],b=g.tanks[1];
 a.x=17.8;a.z=16;b.x=19.35;b.z=16;
 g.humanIds=new Set(g.tanks.map(t=>t.id));
 const oldA=a.shield,oldB=b.shield;
 g.update(.05,{},{
  [a.id]:{dx:1,dz:0,aimYaw:0,fire:false},
  [b.id]:{dx:-1,dz:0,aimYaw:0,fire:false}
 });
 assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=1.35,'vehicles may not occupy same space');
 assert.ok(a.shield<oldA&&b.shield<oldB,'relative impact damage should apply');
 const after=a.shield;
 g.update(.05,{},{
  [a.id]:{dx:0,dz:0},[b.id]:{dx:0,dz:0}
 });
 assert.equal(a.shield,after,'same collision pair cannot spam damage each tick');
});
test('eight-person FFA allocates eight unique player slots',()=>{
 const g=new Game({mode:'FFA',size:8});
 assert.equal(g.tanks.length,8);
 assert.equal(new Set(g.tanks.map(t=>t.id)).size,8);
});

test('mine requires arming, damages nearby enemy and spends limited ammo',()=>{
 const g=new Game({mode:'FFA'}),p=g.tanks[0],enemy=g.tanks[1];
 p.weapon='mine';p.x=17;p.z=15;enemy.x=17;enemy.z=18;
 assert.equal(g.fire(p),true);assert.equal(p.ammo.mine,4);
 const mine=g.projectiles[0];assert.equal(mine.kind,'mine');
 g.humanIds=new Set(g.tanks.map(t=>t.id));
 for(let i=0;i<20;i++)g.update(.05,{},{}); // arm the mine
 enemy.x=17;enemy.z=15.8;
 const oldShield=enemy.shield;
 g.update(.05,{},{});
 assert.ok(enemy.shield<oldShield||enemy.hp<enemy.maxHp,'armed mine should hit enemy');
 assert.ok(!g.projectiles.some(b=>b.id===mine.id),'detonated mine should disappear');
});
test('six numbered consumables apply clamped recovery or create timed zones',()=>{
 const g=new Game(),p=g.tanks[0];
 p.shield=10;p.hp=50;
 assert.equal(g.useItem(p,3),true);assert.equal(p.shield,45);
 assert.equal(g.useItem(p,3),false);
 assert.equal(g.useItem(p,4),true);assert.equal(p.radarTime,5);
 assert.equal(g.useItem(p,5),true);assert.equal(g.smokes.length,1);
 assert.equal(g.useItem(p,6),true);assert.equal(g.repairFields.length,1);
 const before=p.hp;
 g.update(.05,{},{});
 assert.ok(p.hp>before,'team healing field should recover HP');
});
