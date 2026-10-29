// The only bridge between the renderer and the main process. Each function
// maps to one IPC channel; nothing else from Node or Electron is exposed.

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('glasscase', {
  app: {
    info: invoke('app:info'),
  },
  window: {
    minimize: invoke('win:minimize'),
    toggleMaximize: invoke('win:toggle-maximize'),
    close: invoke('win:close'),
    onState: listen('win:state'),
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
    setSecret: invoke('secrets:set'),
    checkKey: invoke('secrets:check-key'),
  },
  profiles: {
    recent: invoke('profiles:recent'),
    removeRecent: invoke('profiles:remove-recent'),
  },
  scan: {
    start: invoke('scan:start'),
    cancel: invoke('scan:cancel'),
    skip: invoke('scan:skip'),
    reprice: invoke('scan:reprice'),
    onProgress: listen('scan:progress'),
  },
  history: {
    list: invoke('history:list'),
    clear: invoke('history:clear'),
  },
  library: {
    get: invoke('library:get'),
  },
  data: {
    info: invoke('data:info'),
    clearCache: invoke('data:clear-cache'),
    openFolder: invoke('data:open-folder'),
  },
  share: {
    save: invoke('share:save'),
  },
  openExternal: invoke('shell:open'),
  driver: {
    onCommand: listen('driver:command'),
    done: (id, info) => ipcRenderer.send('driver:done', id, info),
  },
});
