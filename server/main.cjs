'use strict';
const {createHost}=require('./host.cjs');
const port=Number(process.env.PORT||8787);
const host=process.env.BIND_HOST||'0.0.0.0';
createHost({port,host}).then(s=>{
 console.log('X-TANK multiplayer server listening at '+host+':'+s.port);
 const shutdown=()=>s.close().then(()=>process.exit(0));
 process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}).catch(e=>{console.error(e);process.exitCode=1;});
