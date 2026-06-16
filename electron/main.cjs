/* Typographus — Electron main process.
   Frameless desktop window with a custom titlebar (rendered by the app). */

const { app, BrowserWindow, ipcMain, shell, nativeTheme } = require("electron");
const path = require("path");
const license = require("./license.cjs");

const START_URL = process.env.ELECTRON_START_URL; // set in dev to the Vite server
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: "#0d0d0f",
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (START_URL) {
    win.loadURL(START_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  win.once("ready-to-show", () => win.show());

  // open external links in the system browser, never in-app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => (win = null));
}

app.setName("Typographus");
nativeTheme.themeSource = "dark";

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* licensing (offline, HWID-bound) */
ipcMain.handle("license:status", () => license.status());
ipcMain.handle("license:hwid", () => license.getHWID());
ipcMain.handle("license:activate", (_e, token) => license.activate(token));
ipcMain.handle("license:deactivate", () => {
  license.removeToken();
  return license.status();
});

/* window controls from the renderer titlebar */
ipcMain.on("win:minimize", () => win && win.minimize());
ipcMain.on("win:toggle-maximize", () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on("win:close", () => win && win.close());
