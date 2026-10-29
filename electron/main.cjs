const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const os=require('node:os');
const path = require('node:path');

let lanHost=null;
function addresses(port){
 const list=['ws://127.0.0.1:'+port];
 for(const entries of Object.values(os.networkInterfaces()))for(const address of entries||[]){
  if(address.family==='IPv4'&&!address.internal)list.push('ws://'+address.address+':'+port);
 }
 return [...new Set(list)];
}
function makeWindow() {
  // A GitHub-hosted Windows runner has no discrete GPU. When verifying two
  // real Windows EXEs on that machine, use the game's smallest supported
  // window and allow Chromium to throttle an occluded window. This flag
  // changes no normal player's rendering or gameplay defaults.
  const dualNativeQA=process.env.XTANK_QA_DUAL_NATIVE==='1';
  const win = new BrowserWindow({
    width: dualNativeQA?940:1366, height: dualNativeQA?640:850, minWidth: 940, minHeight: 640,
    title: 'X-TANK Revival — Prototype',
    backgroundColor: '#0c1524',
    autoHideMenuBar: true,
    webPreferences: {
      preload:path.join(__dirname,'preload.cjs'),
      contextIsolation: true,
      backgroundThrottling: dualNativeQA,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
}
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle('xtank-start-lan',async event=>{
    const page=BrowserWindow.fromWebContents(event.sender);
    if(!page||event.sender.getURL()!==page.webContents.getURL()||!event.sender.getURL().startsWith('file://'))throw Error('Unauthorized renderer');
    if(!lanHost)lanHost=await require('../server/host.cjs').createHost({port:8787,host:'0.0.0.0'});
    return {port:lanHost.port,urls:addresses(lanHost.port)};
  });
  makeWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) makeWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
