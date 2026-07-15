const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dashboardApi", {
  getState: () => ipcRenderer.invoke("dashboard:get-state"),
  addAccount: (name) => ipcRenderer.invoke("dashboard:add-account", name),
  removeAccount: (id) => ipcRenderer.invoke("dashboard:remove-account", id),
  showAccount: (id) => ipcRenderer.invoke("dashboard:show-account", id),
  hideAccount: () => ipcRenderer.invoke("dashboard:hide-account"),
  refreshAccount: (id) => ipcRenderer.invoke("dashboard:refresh-account", id),
  refreshAll: () => ipcRenderer.invoke("dashboard:refresh-all"),
  updateSettings: (patch) => ipcRenderer.invoke("dashboard:update-settings", patch),
  openExternal: (url) => ipcRenderer.invoke("dashboard:open-external", url),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("dashboard:state", listener);
    return () => ipcRenderer.removeListener("dashboard:state", listener);
  },
  onOverlay: (callback) => {
    const listener = (_event, accountId) => callback(accountId);
    ipcRenderer.on("dashboard:overlay", listener);
    return () => ipcRenderer.removeListener("dashboard:overlay", listener);
  },
});
