'use strict';
// Reliable official-match delivery. Persistent filesystem outbox is an explicit host requirement.
// The SQL endpoint itself is idempotent on server_round_id, including across server restarts.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function createSettlementOutbox({directory,deliver,intervalMs=10000}){
 if(typeof directory!=='string'||!directory)throw Error('Settlement storage directory is required');
 if(typeof deliver!=='function')throw Error('Settlement delivery callback is required');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 let closed=false,running=false;
 const inFlight=new Map();
 const retryAt=new Map();
 const filename=roundId=>{
  if(typeof roundId!=='string'||roundId.length<12||roundId.length>128)throw Error('Invalid round ID');
  const hash=crypto.createHash('sha256').update(roundId).digest('hex');
  return path.join(directory,hash+'.json');
 };
 function queue(payload){
  const filenameOnDisk=filename(payload?.round_id);
  if(fs.existsSync(filenameOnDisk))return filenameOnDisk;
  const tmp=filenameOnDisk+'.'+process.pid+'.'+crypto.randomBytes(4).toString('hex')+'.tmp';
  // A completed official match must be durable BEFORE attempting network delivery.
  // Otherwise a successful write held only in OS buffers may disappear on a
  // sudden server shutdown, losing the match's sole recovery record.
  try{
   const fd=fs.openSync(tmp,'wx',0o600);
   try{
    fs.writeFileSync(fd,JSON.stringify(payload));
    fs.fsyncSync(fd);
   }finally{fs.closeSync(fd);}
   fs.renameSync(tmp,filenameOnDisk);
   // Linux containers and persistent volumes support syncing the containing
   // directory. On Windows the underlying handle cannot reliably be synced.
   if(process.platform!=='win32'){
    const dfd=fs.openSync(directory,'r');
    try{fs.fsyncSync(dfd)}finally{fs.closeSync(dfd);}
   }
  }finally{try{fs.unlinkSync(tmp)}catch{}}
  return filenameOnDisk;
 }
 async function deliverFile(file){
  if(inFlight.has(file))return inFlight.get(file);
  const task=(async()=>{
   const data=JSON.parse(fs.readFileSync(file,'utf8'));
   const result=await deliver(data);
   fs.unlinkSync(file);
   retryAt.delete(file);
   return result;
  })();
  inFlight.set(file,task);
  try{return await task}finally{inFlight.delete(file)}
 }
 async function retry(){
  if(closed||running)return;
  running=true;
  try{
   const files=fs.readdirSync(directory).filter(name=>/^[0-9a-f]{64}\.json$/.test(name)).sort();
   for(const name of files){
    const file=path.join(directory,name);
    if((retryAt.get(file)||0)>Date.now())continue;
    try{await deliverFile(file)}catch(err){
     const current=retryAt.get(file)||0;
     retryAt.set(file,Date.now()+(current>0?60000:10000));
     console.error('Official match outbox retry pending:',name,err.message);
    }
   }
  }finally{running=false;}
 }
 async function settle(payload){
  const file=queue(payload);
  try{return await deliverFile(file)}
  catch(err){retryAt.set(file,Date.now()+10000);throw err}
 }
 function hasPending(){
  return fs.readdirSync(directory).some(name=>/^[0-9a-f]{64}\.json$/.test(name));
 }
 const timer=setInterval(()=>{retry().catch(err=>console.error('X-TANK settlement outbox:',err.message))},intervalMs);
 timer.unref?.();
 return {queue,retry,settle,hasPending,close:()=>{closed=true;clearInterval(timer)},directory};
}
module.exports={createSettlementOutbox};
