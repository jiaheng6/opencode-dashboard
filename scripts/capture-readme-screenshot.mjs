import { app, BrowserWindow, ipcMain } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "docs", "images", "dashboard-preview.png");

app.disableHardwareAcceleration();

function quota(remainingPercent, resetOffsetMs) {
  return {
    remainingPercent,
    resetAt: new Date(Date.now() + resetOffsetMs).toISOString(),
  };
}

const capturedAt = new Date().toISOString();
const demoState = {
  settings: { refreshIntervalMinutes: 5 },
  accounts: [
    {
      id: "demo-backup",
      name: "项目备用 02",
      createdAt: capturedAt,
      updatedAt: capturedAt,
      workspaceId: "wksp_demo_backup",
      status: "正常",
      statusMessage: "已从内嵌页面的网络响应更新",
      lastRefreshAt: capturedAt,
      snapshot: {
        capturedAt,
        rolling: quota(8, 45 * 60 * 1000),
        weekly: quota(42, 3 * 24 * 60 * 60 * 1000),
        monthly: quota(67, 18 * 24 * 60 * 60 * 1000),
      },
    },
    {
      id: "demo-main",
      name: "主账号",
      createdAt: capturedAt,
      updatedAt: capturedAt,
      workspaceId: "wksp_demo_main",
      status: "正常",
      statusMessage: "已从内嵌页面的网络响应更新",
      lastRefreshAt: capturedAt,
      snapshot: {
        capturedAt,
        rolling: quota(76, 4 * 60 * 60 * 1000),
        weekly: quota(58, 5 * 24 * 60 * 60 * 1000),
        monthly: quota(81, 22 * 24 * 60 * 60 * 1000),
      },
    },
  ],
};

ipcMain.handle("dashboard:get-state", () => demoState);
ipcMain.handle("dashboard:update-settings", () => undefined);
ipcMain.handle("dashboard:refresh-all", () => undefined);
ipcMain.handle("dashboard:refresh-account", () => undefined);
ipcMain.handle("dashboard:show-account", () => undefined);
ipcMain.handle("dashboard:hide-account", () => undefined);
ipcMain.handle("dashboard:add-account", () => undefined);
ipcMain.handle("dashboard:remove-account", () => undefined);
ipcMain.handle("dashboard:open-external", () => undefined);

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    show: true,
    backgroundColor: "#f4f3ef",
    webPreferences: {
      preload: path.join(projectRoot, "electron", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  await window.loadFile(path.join(projectRoot, "dist", "index.html"));
  window.show();
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  const image = await window.webContents.capturePage();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, image.toPNG());
  console.log(`运行截图已生成：${outputPath}`);
  app.quit();
});
