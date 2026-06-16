/* Exposes a minimal, safe desktop bridge to the renderer. */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("typographus", {
  platform: process.platform,
  minimize: () => ipcRenderer.send("win:minimize"),
  toggleMaximize: () => ipcRenderer.send("win:toggle-maximize"),
  close: () => ipcRenderer.send("win:close"),
  license: {
    status: () => ipcRenderer.invoke("license:status"),
    hwid: () => ipcRenderer.invoke("license:hwid"),
    activate: (token) => ipcRenderer.invoke("license:activate", token),
    deactivate: () => ipcRenderer.invoke("license:deactivate"),
  },
});
