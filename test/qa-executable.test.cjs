'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {resolveExecutable}=require('../scripts/qa-executable.cjs');
test('first client runs portable executable, second uses independently packaged Electron binary',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xtank-exe-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'XTANK-Prototype-0.2.2-Windows.exe'),'first');
 fs.mkdirSync(path.join(dir,'win-unpacked'));
 fs.writeFileSync(path.join(dir,'win-unpacked','X-TANK Revival.exe'),'second');
 assert.equal(resolveExecutable({releaseDir:dir,clientIndex:0}),path.join(dir,'XTANK-Prototype-0.2.2-Windows.exe'));
 assert.equal(resolveExecutable({releaseDir:dir,clientIndex:1}),path.join(dir,'win-unpacked','X-TANK Revival.exe'));
 assert.notEqual(resolveExecutable({releaseDir:dir,clientIndex:0}),resolveExecutable({releaseDir:dir,clientIndex:1}));
 assert.equal(resolveExecutable({releaseDir:dir,clientIndex:2}),path.join(dir,'win-unpacked','X-TANK Revival.exe'));
});
test('missing native unpacked client fails loudly, never silently reuses portable launcher',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xtank-exe-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(path.join(dir,'XTANK.exe'),'first');
 assert.throws(()=>resolveExecutable({releaseDir:dir,clientIndex:1}),/SECONDARY_UNPACKED_EXE_MISSING/);
 assert.throws(()=>resolveExecutable({releaseDir:dir,clientIndex:-1}),/INVALID_QA_CLIENT/);
});
