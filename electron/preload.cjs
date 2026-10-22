'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('xtankHost',Object.freeze({
 start:()=>ipcRenderer.invoke('xtank-start-lan')
}));
