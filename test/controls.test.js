import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BINDINGS,assignBinding,normalizeBindings,loadBindings,saveBindings,isAllowedCode} from '../src/controls.js';
test('unique defaults for movement, skills, weapons, consumables',()=>{
 assert.equal(Object.keys(DEFAULT_BINDINGS).length,21);
 assert.equal(new Set(Object.values(DEFAULT_BINDINGS)).size,20);
});
test('already-bound keys exchange actions instead of losing a command',()=>{
 const next=assignBinding(DEFAULT_BINDINGS,'forward','KeyS');
 assert.equal(next.forward,'KeyS');assert.equal(next.backward,'KeyW');
 assert.equal(new Set(Object.values(next)).size,20);
});
test('system Escape and unknown actions cannot be rebound',()=>{
 assert.equal(isAllowedCode('Escape'),false);
 assert.throws(()=>assignBinding(DEFAULT_BINDINGS,'fire','Escape'),/UNSUPPORTED_KEY/);
 assert.throws(()=>assignBinding(DEFAULT_BINDINGS,'invalid','KeyX'),/UNKNOWN_BINDING/);
});
test('custom bindings persist, malformed storage falls back to defaults',()=>{
 const values=new Map(), storage={getItem:key=>values.get(key)||null,setItem:(key,val)=>values.set(key,val)};
 const changed=assignBinding(DEFAULT_BINDINGS,'ability','KeyQ');
 saveBindings(storage,changed);assert.deepEqual(loadBindings(storage),changed);
 values.set('xtankKeyboardBindingsV1','{invalid');
 assert.deepEqual(loadBindings(storage),DEFAULT_BINDINGS);
 assert.deepEqual(normalizeBindings({fire:'Escape'}),DEFAULT_BINDINGS);
});
