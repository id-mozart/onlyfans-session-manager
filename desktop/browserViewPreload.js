const { contextBridge, ipcRenderer } = require('electron');

// Expose только необходимые IPC каналы для overlay
contextBridge.exposeInMainWorld('desktopOverlay', {
  toggleDevTools: () => ipcRenderer.send('overlay-toggle-devtools'),
  closeOnlyFans: () => ipcRenderer.send('overlay-close-onlyfans')
});

console.log('✅ BrowserView preload loaded');
