export const GRAPHICS_PRESETS=Object.freeze({
 low:Object.freeze({pixelRatioCap:1,shadows:false,shadowSize:512}),
 balanced:Object.freeze({pixelRatioCap:1.35,shadows:true,shadowSize:1024}),
 high:Object.freeze({pixelRatioCap:1.8,shadows:true,shadowSize:2048})
});
export const GRAPHICS_STORAGE_KEY='xtankGraphicsQualityV1';
export const CONTRAST_STORAGE_KEY='xtankHighContrastV1';
export const normalizeGraphicsQuality=value=>Object.hasOwn(GRAPHICS_PRESETS,value)?value:'high';
export function loadGraphicsQuality(storage){
 try{return normalizeGraphicsQuality(storage.getItem(GRAPHICS_STORAGE_KEY))}catch{return 'high'}
}
export function saveGraphicsQuality(storage,value){
 const normalized=normalizeGraphicsQuality(value);
 try{storage.setItem(GRAPHICS_STORAGE_KEY,normalized)}catch{}
 return normalized;
}
export function loadHighContrast(storage){
 try{return storage.getItem(CONTRAST_STORAGE_KEY)==='1'}catch{return false}
}
export function saveHighContrast(storage,on){
 const enabled=on===true;
 try{storage.setItem(CONTRAST_STORAGE_KEY,enabled?'1':'0')}catch{}
 return enabled;
}
