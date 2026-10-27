'use strict';
const fs=require('node:fs');
const path=require('node:path');
// The portable NSIS wrapper is used for client 0; client 1 must run the
// independently packaged Electron binary, not a second copy of that wrapper.
function resolveExecutable({releaseDir,clientIndex,portableOverride,unpackedOverride}){
 if(!Number.isSafeInteger(clientIndex)||clientIndex<0)throw Error('INVALID_QA_CLIENT');
 if(clientIndex===0){
  if(portableOverride)return path.resolve(portableOverride);
  const names=fs.readdirSync(releaseDir).filter(n=>n.toLowerCase().endsWith('.exe')).sort();
  const name=names.find(n=>n.startsWith('XTANK-'))||names[0];
  if(!name)throw Error('PORTABLE_EXE_MISSING');
  return path.resolve(releaseDir,name);
 }
 if(unpackedOverride)return path.resolve(unpackedOverride);
 const dir=path.join(releaseDir,'win-unpacked');
 if(!fs.existsSync(dir))throw Error('SECONDARY_UNPACKED_EXE_MISSING: download XTANK-Windows-Unpacked in QA job');
 const names=fs.readdirSync(dir).filter(n=>n.toLowerCase().endsWith('.exe')).sort();
 const name=names.find(n=>n.startsWith('X-TANK Revival'))||names.find(n=>!/proxy|helper|crashpad/i.test(n));
 if(!name)throw Error('SECONDARY_UNPACKED_EXE_MISSING');
 return path.resolve(dir,name);
}
module.exports={resolveExecutable};
