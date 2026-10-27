import test from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../src/simulation.js';
test('official item stocks are used only if owned and decrease exactly once',()=>{
 const g=new Game({mode:'FFA',mapId:'desk',selectedTank:'X'});
 const t=g.tanks[0];
 t.itemsRemaining={repair:1,speed_boost:0,shield_cell:1,radar_ping:0,smoke:0,team_repair:0};
 t.itemsUsed={};t.hp=40;t.shield=5;
 assert.equal(g.useItem(t,1),true);
 assert.equal(t.itemsUsed.repair,1);
 assert.equal(t.itemsRemaining.repair,0);
 t.repairCooldown=0;t.hp=20;
 assert.equal(g.useItem(t,1),false);
 assert.equal(g.useItem(t,2),false);
 assert.equal(g.useItem(t,3),true);
 assert.equal(t.itemsUsed.shield_cell,1);
 t.shieldCooldown=0;t.shield=0;
 assert.equal(g.useItem(t,3),false);
});
test('local single-player quick items remain available without persistent inventory',()=>{
 const g=new Game({mode:'FFA',mapId:'desk'}),t=g.tanks[0];
 t.hp=60;assert.equal(g.useItem(t,1),true);assert.equal(t.itemsUsed,undefined);
});
