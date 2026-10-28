import test from 'node:test';
import assert from 'node:assert/strict';
import {GRAPHICS_PRESETS,loadGraphicsQuality,saveGraphicsQuality,loadHighContrast,saveHighContrast} from '../src/graphics-settings.js';
test('quality choices have bounded GPU settings and safe defaults',()=>{
 assert.deepEqual(Object.keys(GRAPHICS_PRESETS),['low','balanced','high']);
 assert.equal(GRAPHICS_PRESETS.low.shadows,false);
 assert(GRAPHICS_PRESETS.high.pixelRatioCap>GRAPHICS_PRESETS.balanced.pixelRatioCap);
 assert(GRAPHICS_PRESETS.high.shadowSize>GRAPHICS_PRESETS.low.shadowSize);
 assert.equal(loadGraphicsQuality({getItem:()=>null}),'high');
 assert.equal(loadGraphicsQuality({getItem:()=> '__proto__'}),'high');
});
test('quality and high contrast survive reload through storage and tolerate blocked storage',()=>{
 const data=new Map();
 const store={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
 assert.equal(saveGraphicsQuality(store,'low'),'low');
 assert.equal(loadGraphicsQuality(store),'low');
 assert.equal(saveGraphicsQuality(store,'invalid'),'high');
 assert.equal(loadGraphicsQuality(store),'high');
 assert.equal(saveHighContrast(store,true),true);
 assert.equal(loadHighContrast(store),true);
 assert.equal(saveHighContrast(store,false),false);
 assert.equal(loadHighContrast(store),false);
 const blocked={getItem:()=>{throw Error('denied')},setItem:()=>{throw Error('denied')}};
 assert.equal(loadGraphicsQuality(blocked),'high');
 assert.equal(saveGraphicsQuality(blocked,'balanced'),'balanced');
 assert.equal(loadHighContrast(blocked),false);
 assert.equal(saveHighContrast(blocked,true),true);
});
