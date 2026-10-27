import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_VIEWS,cameraPose} from '../src/camera-presets.js';
test('five distinct camera positions, including a first-person forward view',()=>{
 const player={x:24,z:16,yaw:0,aimYaw:0};
 assert.equal(CAMERA_VIEWS.length,5);
 const poses=CAMERA_VIEWS.map((_,i)=>cameraPose(player,i));
 assert.equal(new Set(poses.map(p=>JSON.stringify(p.position))).size,5);
 assert.equal(poses[0].position.z,21);
 assert.equal(poses[4].position.z,15.2);
 assert(poses[4].target.z<poses[4].position.z);
});
test('camera orbit follows tank facing and first-person aim orientation',()=>{
 const p=cameraPose({x:10,z:12,yaw:Math.PI/2,aimYaw:-Math.PI/2},0);
 assert(Math.abs(p.position.x-15)<1e-10);
 const inside=cameraPose({x:10,z:12,yaw:0,aimYaw:-Math.PI/2},4);
 assert(inside.target.x>10);
 assert.throws(()=>cameraPose({x:0,z:0},5),/INVALID_CAMERA_MODE/);
});
