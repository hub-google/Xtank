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
 noise(duration=.3,loudness=.16,cutoff=440){
  const c=this.ctx;if(!c||c.state!=='running'||!this.volume)return;
  const samples=Math.max(64,Math.floor(c.sampleRate*duration));
  const buffer=c.createBuffer(1,samples,c.sampleRate),data=buffer.getChannelData(0);
  // Generated locally from deterministic pseudo-random samples; no external SFX assets.
  let seed=0x91e10da5;
  for(let i=0;i<samples;i++){
   seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
   data[i]=((seed>>>0)/2147483647-1)*(1-i/samples);
  }
  const src=c.createBufferSource(),filter=c.createBiquadFilter(),gain=c.createGain();
  src.buffer=buffer;filter.type='lowpass';filter.frequency.value=cutoff;
  gain.gain.value=this.volume*loudness;
  src.connect(filter);filter.connect(gain);gain.connect(c.destination);src.start();
  src.onended=()=>{src.disconnect();filter.disconnect();gain.disconnect()};
 },
 event(e,own){
  const t=performance.now(),type=e.type;
  if(t-(this.last[type]||0)<(type==='fire'?85:150))return;
  this.last[type]=t;const k=own?1:.5;
  if(type==='fire'){
   const weapon=e.weapon;
   if(weapon==='vulcan'||weapon==='plasma')this.play(weapon==='plasma'?800:360,weapon==='plasma'?120:80,.055,.08*k);
   else if(weapon==='ion_missile')this.play(520,44,.28,.16*k);
   else if(weapon==='mine')this.play(90,60,.1,.12*k);
   else this.play(400,70,.09,.1*k);
  }
  else if(type==='hit'){this.play(160,40,.1,.13*k);this.noise(.11,.06*k,1100);}
  else if(type==='explosion'){this.play(120,30,.35,.24*k);this.noise(.35,.19*k,260);}
  else if(type==='death'){this.play(240,35,.5,.25*k);this.noise(.48,.16*k,180);}
  else if(type==='respawn')this.play(210,730,.22,.13*k);
  else if(type==='boost'||type==='repair')this.play(250,570,.23,.14*k);
  else if(type==='flagPickup'||type==='flagScore')this.play(620,900,.25,.15*k);
 }
};