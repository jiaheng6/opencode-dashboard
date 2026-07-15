export type AccountStatus =
  | "等待登录"
  | "正在加载"
  | "正在刷新"
  | "正常"
  | "登录失效"
  | "解析失败"
  | "网络错误";

export interface QuotaWindow {
  usagePercent: number;
  remainingPercent: number;
  resetInSec: number;
  resetAt: string;
}

export interface QuotaSnapshot {
  rolling?: QuotaWindow;
  weekly?: QuotaWindow;
  monthly?: QuotaWindow;
  capturedAt: string;
  sourceUrl: string;
}

export interface AccountRecord {
  id: string;
  name: string;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  status: AccountStatus;
  statusMessage?: string;
  lastRefreshAt?: string;
  nextRefreshAt?: string;
  snapshot?: QuotaSnapshot;
}

export interface AppSettings {
  refreshIntervalMinutes: number;
}

export interface PersistedState {
  accounts: AccountRecord[];
  settings: AppSettings;
}
