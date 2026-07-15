import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  WebContentsView,
} from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseQuotaResponse } from "./quota-parser.js";
import type { AccountRecord, AppSettings, PersistedState } from "./types.js";

const OPENCODE_ORIGIN = "https://opencode.ai";
const LOGIN_VIEW_TOP = 68;
const DEFAULT_SETTINGS: AppSettings = { refreshIntervalMinutes: 5 };

interface CapturedResponse {
  url: string;
  type: string;
  mimeType: string;
  status: number;
}

interface ManagedView {
  view: WebContentsView;
  responses: Map<string, CapturedResponse>;
  loaded: boolean;
}

class StateStore {
  private readonly filePath: string;
  private state: PersistedState = { accounts: [], settings: DEFAULT_SETTINGS };

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "dashboard-state.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      this.state = {
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
        settings: {
          refreshIntervalMinutes:
            parsed.settings?.refreshIntervalMinutes ?? DEFAULT_SETTINGS.refreshIntervalMinutes,
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("读取本地状态失败，将使用空白配置。", error);
      }
    }
  }

  getState(): PersistedState {
    return structuredClone(this.state);
  }

  getAccount(id: string): AccountRecord | undefined {
    return this.state.accounts.find((account) => account.id === id);
  }

  async addAccount(name: string): Promise<AccountRecord> {
    const now = new Date().toISOString();
    const account: AccountRecord = {
      id: randomUUID(),
      name: name.trim(),
      createdAt: now,
      updatedAt: now,
      status: "等待登录",
      statusMessage: "请登录 OpenCode 并进入 Go 用量页面",
    };
    this.state.accounts.push(account);
    await this.save();
    return structuredClone(account);
  }

  async updateAccount(id: string, patch: Partial<AccountRecord>): Promise<AccountRecord | undefined> {
    const account = this.getAccount(id);
    if (!account) return undefined;
    Object.assign(account, patch, { updatedAt: new Date().toISOString() });
    await this.save();
    return structuredClone(account);
  }

  async removeAccount(id: string): Promise<void> {
    this.state.accounts = this.state.accounts.filter((account) => account.id !== id);
    await this.save();
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    this.state.settings = { ...this.state.settings, ...patch };
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let store: StateStore;
let visibleAccountId: string | undefined;
let scheduler: NodeJS.Timeout | undefined;
let isQuitting = false;
const managedViews = new Map<string, ManagedView>();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  isQuitting = true;
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
}

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill="#20231f"/>
      <rect x="14" y="31" width="9" height="19" rx="3" fill="#f5f0df"/>
      <rect x="28" y="14" width="9" height="36" rx="3" fill="#67b486"/>
      <rect x="42" y="23" width="9" height="27" rx="3" fill="#f5f0df"/>
    </svg>`;
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
  if (process.platform === "darwin") image.setTemplateImage(true);
  return image.resize({ width: process.platform === "darwin" ? 18 : 20, height: process.platform === "darwin" ? 18 : 20 });
}

function showMainWindow(): void {
  if (!mainWindow) {
    void createMainWindow().then(() => {
      mainWindow?.show();
      mainWindow?.focus();
    });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  if (tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip("OpenCode Go 多账号余量看板");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示面板",
        click: showMainWindow,
      },
      { type: "separator" },
      {
        label: "退出程序",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}

function partitionFor(accountId: string): string {
  return `persist:opencode-account-${accountId}`;
}

function targetUrl(account: AccountRecord): string {
  return account.workspaceId
    ? `${OPENCODE_ORIGIN}/workspace/${encodeURIComponent(account.workspaceId)}/go`
    : OPENCODE_ORIGIN;
}

function isInspectableResponse(response: CapturedResponse): boolean {
  if (!response.url.startsWith(OPENCODE_ORIGIN)) return false;
  if (response.status < 200 || response.status >= 400) return false;
  if (response.type === "Document" && /\/workspace\/[^/]+\/go(?:[?#]|$)/.test(response.url)) {
    return true;
  }
  return (
    ["XHR", "Fetch"].includes(response.type) &&
    (response.mimeType.includes("json") || /usage|billing|quota|\/go(?:[/?#]|$)/i.test(response.url))
  );
}

function workspaceIdFromUrl(url: string): string | undefined {
  const match = url.match(/^https:\/\/opencode\.ai\/workspace\/([^/?#]+)\/go(?:[/?#]|$)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function broadcastState(): void {
  mainWindow?.webContents.send("dashboard:state", store.getState());
}

function broadcastOverlay(): void {
  mainWindow?.webContents.send("dashboard:overlay", visibleAccountId ?? null);
}

async function captureResponseBody(
  accountId: string,
  requestId: string,
  response: CapturedResponse,
): Promise<void> {
  const managed = managedViews.get(accountId);
  if (!managed || !managed.view.webContents.debugger.isAttached()) return;

  try {
    const payload = (await managed.view.webContents.debugger.sendCommand(
      "Network.getResponseBody",
      { requestId },
    )) as { body?: string; base64Encoded?: boolean };
    if (!payload.body) return;
    const body = payload.base64Encoded
      ? Buffer.from(payload.body, "base64").toString("utf8")
      : payload.body;
    const snapshot = parseQuotaResponse(body, response.url);
    if (!snapshot) return;

    const workspaceId = workspaceIdFromUrl(response.url);
    const intervalMs = store.getState().settings.refreshIntervalMinutes * 60_000;
    await store.updateAccount(accountId, {
      ...(workspaceId ? { workspaceId } : {}),
      snapshot,
      status: "正常",
      statusMessage: "已从内嵌页面的网络响应更新",
      lastRefreshAt: snapshot.capturedAt,
      nextRefreshAt: new Date(Date.now() + intervalMs).toISOString(),
    });
    broadcastState();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/No resource with given identifier|No data found/i.test(message)) {
      console.warn(`账号 ${accountId} 的响应正文读取失败：${message}`);
    }
  }
}

function attachNetworkObserver(accountId: string, managed: ManagedView): void {
  const { webContents } = managed.view;
  try {
    if (!webContents.debugger.isAttached()) webContents.debugger.attach("1.3");
    void webContents.debugger.sendCommand("Network.enable", {
      maxTotalBufferSize: 20 * 1024 * 1024,
      maxResourceBufferSize: 5 * 1024 * 1024,
    });
  } catch (error) {
    console.error(`账号 ${accountId} 无法启动 Network 监听。`, error);
    void store.updateAccount(accountId, {
      status: "网络错误",
      statusMessage: "无法启动浏览器 Network 监听",
    }).then(broadcastState);
    return;
  }

  webContents.debugger.on("message", (_event, method, params: unknown) => {
    if (method === "Network.responseReceived") {
      const event = params as {
        requestId: string;
        type: string;
        response: { url: string; mimeType: string; status: number };
      };
      const response: CapturedResponse = {
        url: event.response.url,
        type: event.type,
        mimeType: event.response.mimeType,
        status: event.response.status,
      };
      if (isInspectableResponse(response)) managed.responses.set(event.requestId, response);
      return;
    }

    if (method === "Network.loadingFinished") {
      const event = params as { requestId: string };
      const response = managed.responses.get(event.requestId);
      if (!response) return;
      managed.responses.delete(event.requestId);
      void captureResponseBody(accountId, event.requestId, response);
    }
  });
}

async function handleNavigation(accountId: string, url: string): Promise<void> {
  const workspaceId = workspaceIdFromUrl(url);
  if (workspaceId) {
    await store.updateAccount(accountId, {
      workspaceId,
      status: "正在加载",
      statusMessage: "已识别 Go 工作区，正在读取余量",
    });
    broadcastState();
    return;
  }

  if (/\/login|\/auth|sign-in/i.test(url)) {
    await store.updateAccount(accountId, {
      status: "登录失效",
      statusMessage: "请重新登录后进入 Go 用量页面",
    });
    broadcastState();
  }
}

function createAccountView(accountId: string): ManagedView {
  const existing = managedViews.get(accountId);
  if (existing) return existing;

  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(accountId),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  view.setBackgroundColor("#f7f7f5");
  const managed: ManagedView = { view, responses: new Map(), loaded: false };
  managedViews.set(accountId, managed);
  attachNetworkObserver(accountId, managed);

  view.webContents.on("did-navigate", (_event, url) => void handleNavigation(accountId, url));
  view.webContents.on("did-navigate-in-page", (_event, url) => void handleNavigation(accountId, url));
  view.webContents.on("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    void store.updateAccount(accountId, {
      status: "网络错误",
      statusMessage: `${description}（${validatedUrl}）`,
    }).then(broadcastState);
  });
  view.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") return { action: "allow" };
    } catch {
      // 非法链接统一拒绝。
    }
    return { action: "deny" };
  });

  return managed;
}

function setAccountViewBounds(): void {
  if (!mainWindow || !visibleAccountId) return;
  const managed = managedViews.get(visibleAccountId);
  if (!managed) return;
  const [width, height] = mainWindow.getContentSize();
  managed.view.setBounds({
    x: 0,
    y: LOGIN_VIEW_TOP,
    width,
    height: Math.max(0, height - LOGIN_VIEW_TOP),
  });
}

async function loadAccountView(accountId: string, forceRefresh = false): Promise<void> {
  const account = store.getAccount(accountId);
  if (!account) return;
  const managed = createAccountView(accountId);
  const url = targetUrl(account);

  await store.updateAccount(accountId, {
    status: forceRefresh ? "正在刷新" : "正在加载",
    statusMessage: forceRefresh ? "正在重新载入 Go 用量页面" : "正在打开 OpenCode",
  });
  broadcastState();

  try {
    if (forceRefresh && managed.loaded && managed.view.webContents.getURL() === url) {
      managed.view.webContents.reloadIgnoringCache();
    } else {
      await managed.view.webContents.loadURL(url);
      managed.loaded = true;
    }
  } catch (error) {
    await store.updateAccount(accountId, {
      status: "网络错误",
      statusMessage: error instanceof Error ? error.message : String(error),
    });
    broadcastState();
  }
}

function hideAccountView(): void {
  if (!mainWindow || !visibleAccountId) return;
  const managed = managedViews.get(visibleAccountId);
  if (managed) mainWindow.contentView.removeChildView(managed.view);
  visibleAccountId = undefined;
  broadcastOverlay();
}

async function showAccountView(accountId: string): Promise<void> {
  if (!mainWindow || !store.getAccount(accountId)) return;
  if (visibleAccountId && visibleAccountId !== accountId) hideAccountView();
  const managed = createAccountView(accountId);
  mainWindow.contentView.addChildView(managed.view);
  visibleAccountId = accountId;
  setAccountViewBounds();
  broadcastOverlay();
  if (!managed.loaded) await loadAccountView(accountId);
}

async function removeAccount(accountId: string): Promise<void> {
  if (visibleAccountId === accountId) hideAccountView();
  const managed = managedViews.get(accountId);
  const browserSession = managed?.view.webContents.session;
  if (managed) {
    if (managed.view.webContents.debugger.isAttached()) managed.view.webContents.debugger.detach();
    managed.view.webContents.close();
    managedViews.delete(accountId);
  }
  await store.removeAccount(accountId);
  if (browserSession) {
    await Promise.allSettled([browserSession.clearStorageData(), browserSession.clearCache()]);
  }
  broadcastState();
}

async function refreshAllAccounts(): Promise<void> {
  const accounts = store.getState().accounts.filter((account) => account.workspaceId);
  for (const account of accounts) {
    await loadAccountView(account.id, true);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}

function startScheduler(): void {
  scheduler = setInterval(() => {
    const now = Date.now();
    const due = store
      .getState()
      .accounts.find(
        (account) =>
          account.workspaceId &&
          (!account.nextRefreshAt || new Date(account.nextRefreshAt).getTime() <= now),
      );
    if (due) void loadAccountView(due.id, true);
  }, 15_000);
}

function registerIpcHandlers(): void {
  ipcMain.handle("dashboard:get-state", () => store.getState());
  ipcMain.handle("dashboard:add-account", async (_event, name: string) => {
    if (!name?.trim()) throw new Error("账号名称不能为空");
    const account = await store.addAccount(name);
    createAccountView(account.id);
    broadcastState();
    await showAccountView(account.id);
    return account;
  });
  ipcMain.handle("dashboard:remove-account", (_event, id: string) => removeAccount(id));
  ipcMain.handle("dashboard:show-account", (_event, id: string) => showAccountView(id));
  ipcMain.handle("dashboard:hide-account", () => hideAccountView());
  ipcMain.handle("dashboard:refresh-account", (_event, id: string) => loadAccountView(id, true));
  ipcMain.handle("dashboard:refresh-all", () => refreshAllAccounts());
  ipcMain.handle("dashboard:update-settings", async (_event, patch: Partial<AppSettings>) => {
    const minutes = Math.max(1, Math.min(60, Number(patch.refreshIntervalMinutes) || 5));
    await store.updateSettings({ refreshIntervalMinutes: minutes });
    broadcastState();
  });
  ipcMain.handle("dashboard:open-external", (_event, url: string) => shell.openExternal(url));
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f4f3ef",
    title: "OpenCode Go 余量看板",
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on("resize", setAccountViewBounds);
  mainWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideAccountView();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }

  store.getState().accounts.forEach((account, index) => {
    createAccountView(account.id);
    if (account.workspaceId) {
      setTimeout(() => void loadAccountView(account.id), 1_000 + index * 1_250);
    }
  });
}

app.whenReady().then(async () => {
  store = new StateStore(app.getPath("userData"));
  await store.load();
  registerIpcHandlers();
  await createMainWindow();
  createTray();
  startScheduler();

  app.on("activate", () => {
    if (!mainWindow) void createMainWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  if (scheduler) clearInterval(scheduler);
  for (const managed of managedViews.values()) {
    if (managed.view.webContents.debugger.isAttached()) managed.view.webContents.debugger.detach();
  }
});

app.on("window-all-closed", () => {
  // 主窗口关闭时仅隐藏到系统托盘；真正退出由托盘菜单触发。
});
