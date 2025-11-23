const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Открыть OnlyFans в BrowserView
  openOnlyFans: (sessionData) => ipcRenderer.invoke('open-onlyfans', sessionData),
  
  // Закрыть OnlyFans view
  closeOnlyFans: () => ipcRenderer.invoke('close-onlyfans'),
  
  // Получить информацию о платформе
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  
  // События от main process (с cleanup)
  onOnlyFansLoaded: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('onlyfans-loaded', listener);
    // Return cleanup function
    const cleanup = () => ipcRenderer.removeListener('onlyfans-loaded', listener);
    return cleanup;
  },
  
  onOnlyFansError: (callback) => {
    const listener = (event, error) => callback(error);
    ipcRenderer.on('onlyfans-error', listener);
    // Return cleanup function  
    const cleanup = () => ipcRenderer.removeListener('onlyfans-error', listener);
    return cleanup;
  },
  
  onOnlyFansClosed: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('onlyfans-closed', listener);
    // Return cleanup function
    const cleanup = () => ipcRenderer.removeListener('onlyfans-closed', listener);
    return cleanup;
  }
});

console.log('✅ Electron preload script loaded');
