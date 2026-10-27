export const DEFAULT_BINDINGS=Object.freeze({forward:'KeyW',backward:'KeyS',left:'KeyA',right:'KeyD',fire:'Space',ability:'KeyE',pause:'KeyP',weapon1:'Digit1',weapon2:'Digit2',weapon3:'Digit3',weapon4:'Digit4',weapon5:'Digit5',weapon6:'Digit6',weapon7:'Digit7',item1:'F1',item2:'F2',item3:'F3',item4:'F4',item5:'F5',item6:'F6'});
export const ACTION_LABELS=Object.freeze({forward:'前進',backward:'後退',left:'向左',right:'向右',fire:'射擊',ability:'特殊技能',pause:'暫停',weapon1:'武器 1',weapon2:'武器 2',weapon3:'武器 3',weapon4:'武器 4',weapon5:'武器 5',weapon6:'武器 6',weapon7:'武器 7',item1:'道具 1',item2:'道具 2',item3:'道具 3',item4:'道具 4',item5:'道具 5',item6:'道具 6'});
const STORAGE_KEY='xtankKeyboardBindingsV1';
export function isAllowedCode(code){return typeof code==='string'&&/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|Space)$/.test(code)}
export function assignBinding(previous,action,code){
 if(!Object.hasOwn(DEFAULT_BINDINGS,action))throw Error('UNKNOWN_BINDING');
 if(!isAllowedCode(code))throw Error('UNSUPPORTED_KEY');
 const next={...previous},existing=Object.keys(DEFAULT_BINDINGS).find(name=>name!==action&&next[name]===code);
 if(existing)next[existing]=next[action];
 next[action]=code;return next;
}
export function normalizeBindings(raw){
 let bindings={...DEFAULT_BINDINGS};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return bindings;
 for(const action of Object.keys(DEFAULT_BINDINGS))if(isAllowedCode(raw[action]))bindings=assignBinding(bindings,action,raw[action]);
 return bindings;
}
export function loadBindings(storage){try{return normalizeBindings(JSON.parse(storage.getItem(STORAGE_KEY)||'null'))}catch{return {...DEFAULT_BINDINGS}}}
export function saveBindings(storage,bindings){storage.setItem(STORAGE_KEY,JSON.stringify(normalizeBindings(bindings)))}
export function displayCode(code){if(code==='Space')return '空白鍵';if(code.startsWith('Key'))return code.slice(3);if(code.startsWith('Digit'))return code.slice(5);return {ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'}[code]||code}
