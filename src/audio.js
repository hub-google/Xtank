// Original procedurally synthesized effects; no external audio files.
export const battleAudio={
 ctx:null,volume:.7,last:{},
 unlock(){
  const C=window.AudioContext||window.webkitAudioContext;if(!C)return;
  if(!this.ctx)this.ctx=new C();
  if(this.ctx.state==='suspended')this.ctx.resume().catch(()=>{});
 },
 setMasterVolume(n){n=Number(n);if(Number.isFinite(n))this.volume=Math.max(0,Math.min(1,n));},
 play(start,end,duration,loudness){
  const c=this.ctx;if(!c||c.state!=='running'||!this.volume)return;
  const at=c.currentTime,o=c.createOscillator(),g=c.createGain();
  o.type='triangle';o.frequency.setValueAtTime(start,at);
  o.frequency.exponentialRampToValueAtTime(end,at+duration);
  g.gain.setValueAtTime(.001,at);
  g.gain.exponentialRampToValueAtTime(this.volume*loudness,at+.01);
  g.gain.exponentialRampToValueAtTime(.001,at+duration);
  o.connect(g);g.connect(c.destination);o.start(at);o.stop(at+duration);
  o.onended=()=>{o.disconnect();g.disconnect()};
 },
 event(e,own){
  const t=performance.now(),type=e.type;
  if(t-(this.last[type]||0)<(type==='fire'?85:150))return;
  this.last[type]=t;const k=own?1:.5;
  if(type==='fire')this.play(400,70,.09,.1*k);
  else if(type==='hit')this.play(160,40,.1,.13*k);
  else if(type==='explosion')this.play(120,30,.35,.24*k);
  else if(type==='death')this.play(240,35,.5,.25*k);
  else if(type==='respawn')this.play(210,730,.22,.13*k);
  else if(type==='boost'||type==='repair')this.play(250,570,.23,.14*k);
  else if(type==='flagPickup'||type==='flagScore')this.play(620,900,.25,.15*k);
 }
};