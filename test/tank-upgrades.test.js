import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/simulation.js';

function fresh(){
 const game=new Game({mode:'FFA',mapId:'desk',selectedTank:'X',seed:27,size:2});
 return game;
}
test('speed growth increases authoritative tank travel with identical input',()=>{
 const a=fresh(),b=fresh();
 a.tanks[0].upgrades={speed:0};
 b.tanks[0].upgrades={speed:10};
 const ax=a.tanks[0].x,bx=b.tanks[0].x;
 a.move(a.tanks[0],1,0,.05);
 b.move(b.tanks[0],1,0,.05);
 assert(b.tanks[0].x-bx > a.tanks[0].x-ax,'speed upgrade has real movement effect');
});
test('attack and defense growth change authoritative damage rather than UI-only statistics',()=>{
 const a=fresh(),b=fresh();
 a.tanks[0].upgrades={attack:0};
 b.tanks[0].upgrades={attack:10};
 a.tanks[1].shield=0;b.tanks[1].shield=0;
 const ha=a.tanks[1].hp,hb=b.tanks[1].hp;
 a.hit(a.tanks[1],20,'player','hurricane');
 b.hit(b.tanks[1],20,'player','hurricane');
 assert(b.tanks[1].hp<hb-(ha-a.tanks[1].hp),'attack growth must add damage');
 const c=fresh(),d=fresh();
 c.tanks[1].upgrades={defense:0};d.tanks[1].upgrades={defense:10};
 c.tanks[1].shield=0;d.tanks[1].shield=0;
 c.hit(c.tanks[1],20,'player','hurricane');
 d.hit(d.tanks[1],20,'player','hurricane');
 assert(d.tanks[1].hp>c.tanks[1].hp,'defense upgrade must prevent actual HP loss');
});
