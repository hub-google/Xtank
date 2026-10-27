'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {needsNetworkClient}=require('../scripts/qa-scope.cjs');
test('72 tank matrix never launches unnecessary secondary Electron windows',()=>{
 assert.equal(needsNetworkClient(/^B-D-/),false);
 assert.equal(needsNetworkClient(/^B-[XDMRHAOS]-/),false);
 assert.equal(needsNetworkClient(/^(A-|B-|C-)/),false);
 assert.equal(needsNetworkClient(/^C-/),false);
});
test('only the real multiplayer scenario requires the secondary client',()=>{
 assert.equal(needsNetworkClient(null),true);
 assert.equal(needsNetworkClient(/^/),true);
 assert.equal(needsNetworkClient(/^D-/),true);
 assert.equal(needsNetworkClient(/^D-LAN-/),true);
 assert.equal(needsNetworkClient(/^B-/),false);
});
