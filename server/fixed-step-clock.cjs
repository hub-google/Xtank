'use strict';
const {performance}=require('node:perf_hooks');

// Converts the event-loop's wall-clock time into stable fixed simulation steps.
// A short stall catches up (to prevent slow-motion matches); a long stall
// is bounded so the process cannot spiral indefinitely after CPU starvation.
function createFixedStepClock({periodMs=50,maxCatchUpSteps=5,now=()=>performance.now()}={}){
 if(!Number.isFinite(periodMs)||periodMs<=0||!Number.isSafeInteger(maxCatchUpSteps)||maxCatchUpSteps<1)
  throw Error('INVALID_SIMULATION_CLOCK');
 let previous=now(),pending=0;
 return ()=>{
  const current=now();
  const elapsed=Math.max(0,current-previous);
  previous=current;
  pending=Math.min(periodMs*maxCatchUpSteps,pending+elapsed);
  const steps=Math.floor(pending/periodMs);
  pending-=steps*periodMs;
  return steps;
 };
}
module.exports={createFixedStepClock};
