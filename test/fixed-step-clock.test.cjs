'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createFixedStepClock}=require('../server/fixed-step-clock.cjs');

test('simulation advances 20 Hz regardless of polling cadence',()=>{
 let ms=0;
 const step=createFixedStepClock({now:()=>ms});
 assert.equal(step(),0);
 ms=24;assert.equal(step(),0);
 ms=50;assert.equal(step(),1);
 ms=99;assert.equal(step(),0);
 ms=101;assert.equal(step(),1);
 ms=250;assert.equal(step(),3);
});

test('a 220 ms event-loop pause catches up the missing simulation steps',()=>{
 let ms=0;const step=createFixedStepClock({now:()=>ms,periodMs:50,maxCatchUpSteps:5});
 ms=220;assert.equal(step(),4,'do not limit stalled timer callbacks to one tick');
 ms=250;assert.equal(step(),1);
 ms=300;assert.equal(step(),1);
});

test('clock caps multi-second backlog to five steps and rejects invalid configuration',()=>{
 let ms=0;const step=createFixedStepClock({now:()=>ms,periodMs:50,maxCatchUpSteps:5});
 ms=5000;assert.equal(step(),5);
 assert.equal(step(),0,'no phantom catch-up on same timestamp');
 ms=5050;assert.equal(step(),1);
 assert.throws(()=>createFixedStepClock({periodMs:0}),/INVALID_SIMULATION_CLOCK/);
 assert.throws(()=>createFixedStepClock({maxCatchUpSteps:0}),/INVALID_SIMULATION_CLOCK/);
});
