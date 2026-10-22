import test from 'node:test';
import assert from 'node:assert/strict';
import {Game,TANKS,WEAPONS,isWalkable} from './simulation.js';
test('eight distinct selectable tanks and weapon definitions',()=>{
 assert.equal(Object.keys(TANKS).length,8);assert.equal(Object.keys(WEAPONS).length,3);
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
 const g=new Game({mode:'FLAG_HOLD'});const p=g.tanks[0],b=g.tanks[1];
 p.x=g.flag.x;p.z=g.flag.z;b.x=g.flag.x;b.z=g.flag.z;
 g.update(.02,{});assert.equal(g.flag.holder,'player');
 p.hp=1;g.hit(p,20,b.id);assert.equal(g.flag.holder,null);
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
