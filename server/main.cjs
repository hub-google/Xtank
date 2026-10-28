'use strict';
const {createHost}=require('./host.cjs');
const port=Number(process.env.PORT||8787);
const host=process.env.BIND_HOST||'0.0.0.0';
if(!Number.isSafeInteger(port)||port<1||port>65535){
 console.error('Invalid official game server port');
 process.exitCode=1;
}else if(process.env.XTANK_OFFICIAL_MODE==='1'&&
 process.env.NODE_ENV==='production'&&!process.env.XTANK_SETTLEMENT_DIR){
 console.error('Official server requires a persistent XTANK_SETTLEMENT_DIR');
 process.exitCode=1;
}else{
 createHost({port,host}).then(server=>{
  console.log('X-TANK authoritative WSS backend listening at '+host+':'+server.port);
  let closing=false;
  const shutdown=signal=>{
   if(closing)return;
   closing=true;
   console.log('Graceful X-TANK shutdown: '+signal);
   // The container supervisor will restart a failed process. In-flight results
   // are already persisted to the settlement outbox before DB delivery.
   const deadline=setTimeout(()=>{
    console.error('Shutdown exceeded 20 seconds');
    process.exit(1);
   },20000);
   server.close().then(()=>{
    clearTimeout(deadline);
    process.exit(0);
   }).catch(error=>{
    clearTimeout(deadline);
    console.error('Shutdown failed:',error);
    process.exit(1);
   });
  };
  process.once('SIGTERM',()=>shutdown('SIGTERM'));
  process.once('SIGINT',()=>shutdown('SIGINT'));
 }).catch(e=>{console.error(e);process.exitCode=1;});
}
