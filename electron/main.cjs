const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('node:path');

function makeWindow() {
  const win = new BrowserWindow({
    width: 1366, height: 850, minWidth: 940, minHeight: 640,
    title: 'X-TANK Revival — Prototype',
    backgroundColor: '#0c1524',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
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
  makeWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) makeWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
