import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AccountRecord, PersistedState, QuotaWindow } from "./types";

const EMPTY_STATE: PersistedState = {
  accounts: [],
  settings: { refreshIntervalMinutes: 5 },
};

function Icon({ name }: { name: "plus" | "refresh" | "external" | "trash" | "close" | "shield" }) {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: <path d="M20 11a8 8 0 1 0-2.35 5.65M20 4v7h-7" />,
    external: <path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />,
    trash: <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    shield: <path d="M12 3 5 6v5c0 4.6 2.8 8.2 7 10 4.2-1.8 7-5.4 7-10V6l-7-3Zm-3 9 2 2 4-5" />,
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function minimumRemaining(account: AccountRecord): number | undefined {
  const values = [
    account.snapshot?.rolling?.remainingPercent,
    account.snapshot?.weekly?.remainingPercent,
    account.snapshot?.monthly?.remainingPercent,
  ].filter((value): value is number => value !== undefined);
  return values.length ? Math.min(...values) : undefined;
}

function formatRelativeTime(iso: string | undefined, now: number): string {
  if (!iso) return "尚未更新";
  const seconds = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1_000));
  if (seconds <= 0) return "即将重置";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days} 天 ${hours} 小时后`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分后`;
  return `${Math.max(1, minutes)} 分钟后`;
}

function formatTimestamp(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function quotaTone(remaining: number): "good" | "warn" | "danger" {
  if (remaining <= 10) return "danger";
  if (remaining <= 25) return "warn";
  return "good";
}

function QuotaMeter({ label, data, now }: { label: string; data?: QuotaWindow; now: number }) {
  if (!data) {
    return (
      <div className="quota-meter quota-empty">
        <div className="quota-heading"><span>{label}</span><strong>等待数据</strong></div>
        <div className="quota-track"><span /></div>
        <div className="quota-reset">进入 Go 用量页后自动读取</div>
      </div>
    );
  }

  const remaining = Math.round(data.remainingPercent * 10) / 10;
  const tone = quotaTone(remaining);
  return (
    <div className={`quota-meter ${tone}`}>
      <div className="quota-heading">
        <span>{label}</span>
        <strong>{remaining}% <small>剩余</small></strong>
      </div>
      <div className="quota-track" aria-label={`${label}剩余 ${remaining}%`}>
        <span style={{ width: `${remaining}%` }} />
      </div>
      <div className="quota-reset">{formatRelativeTime(data.resetAt, now)}</div>
    </div>
  );
}

function AccountCard({
  account,
  now,
  onOpen,
  onRefresh,
  onDelete,
}: {
  account: AccountRecord;
  now: number;
  onOpen: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const minimum = minimumRemaining(account);
  const tone = minimum === undefined ? "neutral" : quotaTone(minimum);
  const statusClass = account.status === "正常"
    ? "online"
    : ["登录失效", "解析失败", "网络错误"].includes(account.status)
      ? "error"
      : "pending";

  return (
    <article className={`account-card card-${tone}`}>
      <div className="account-card-head">
        <div className="account-identity">
          <div className="account-avatar">{account.name.trim().slice(0, 1).toUpperCase()}</div>
          <div>
            <h2>{account.name}</h2>
            <div className="account-status">
              <span className={`status-dot ${statusClass}`} />
              <span>{account.status}</span>
              {account.workspaceId && <code>{account.workspaceId.slice(0, 8)}</code>}
            </div>
          </div>
        </div>
        {minimum !== undefined && (
          <div className={`minimum-badge ${tone}`}>
            <span>最低余量</span>
            <strong>{Math.round(minimum)}%</strong>
          </div>
        )}
      </div>

      <div className="quota-grid">
        <QuotaMeter label="5 小时" data={account.snapshot?.rolling} now={now} />
        <QuotaMeter label="本周" data={account.snapshot?.weekly} now={now} />
        <QuotaMeter label="本月" data={account.snapshot?.monthly} now={now} />
      </div>

      <div className="account-message" title={account.statusMessage}>
        {account.statusMessage ?? "等待下一次刷新"}
      </div>
      <footer className="account-footer">
        <span>更新于 {formatTimestamp(account.lastRefreshAt)}</span>
        <div className="account-actions">
          <button className="icon-button subtle" title="刷新" onClick={onRefresh}>
            <Icon name="refresh" />
          </button>
          <button className="text-button" onClick={onOpen}>
            <Icon name="external" />
            打开账号页
          </button>
          <button className="icon-button danger-button" title="删除账号" onClick={onDelete}>
            <Icon name="trash" />
          </button>
        </div>
      </footer>
    </article>
  );
}

function AddAccountDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-head">
          <div>
            <span className="eyebrow">新增监控目标</span>
            <h2>添加 OpenCode Go 账号</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}><Icon name="close" /></button>
        </div>
        <label>
          <span>账号备注名</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：主账号、项目备用 02"
            maxLength={40}
          />
        </label>
        <div className="dialog-note">
          <Icon name="shield" />
          <p>创建后会打开独立的内嵌网页。请完成登录并进入 Go 用量页，应用不会读取或保存你的 Cookie。</p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose}>取消</button>
          <button type="submit" className="primary-button" disabled={!name.trim() || submitting}>
            {submitting ? "正在创建…" : "创建并登录"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<PersistedState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void window.dashboardApi.getState().then((value) => {
      setState(value);
      setLoading(false);
    });
    const offState = window.dashboardApi.onState(setState);
    const offOverlay = window.dashboardApi.onOverlay(setActiveAccountId);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      offState();
      offOverlay();
      window.clearInterval(clock);
    };
  }, []);

  const accounts = useMemo(
    () => [...state.accounts].sort((a, b) => {
      const left = minimumRemaining(a) ?? 101;
      const right = minimumRemaining(b) ?? 101;
      return left - right || a.name.localeCompare(b.name, "zh-CN");
    }),
    [state.accounts],
  );
  const activeAccount = state.accounts.find((account) => account.id === activeAccountId);
  const normalCount = state.accounts.filter((account) => account.status === "正常").length;
  const warningCount = state.accounts.filter((account) => (minimumRemaining(account) ?? 101) <= 25).length;
  const latestUpdate = state.accounts
    .map((account) => account.lastRefreshAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  async function run(action: () => Promise<unknown>, successMessage?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (successMessage) setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="loading-screen">正在启动本地余量看板…</div>;

  return (
    <div className="app-shell">
      {activeAccountId && (
        <div className="webview-toolbar">
          <div className="webview-account">
            <span className="live-mark" />
            <strong>{activeAccount?.name ?? "账号页面"}</strong>
            <span>独立登录环境</span>
          </div>
          <div className="webview-guide">请登录并进入 Go 用量页，识别成功后可返回看板</div>
          <div className="webview-actions">
            <button onClick={() => void window.dashboardApi.refreshAccount(activeAccountId)}>
              <Icon name="refresh" />刷新页面
            </button>
            <button className="toolbar-close" onClick={() => void window.dashboardApi.hideAccount()}>
              <Icon name="close" />返回看板
            </button>
          </div>
        </div>
      )}

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span /><span /><span /></div>
          <div>
            <strong>OpenCode Go</strong>
            <span>多账号余量看板</span>
          </div>
        </div>
        <div className="topbar-actions">
          <label className="interval-control">
            <span>自动刷新</span>
            <select
              value={state.settings.refreshIntervalMinutes}
              onChange={(event) => void window.dashboardApi.updateSettings({ refreshIntervalMinutes: Number(event.target.value) })}
            >
              <option value={1}>1 分钟</option>
              <option value={3}>3 分钟</option>
              <option value={5}>5 分钟</option>
              <option value={10}>10 分钟</option>
              <option value={30}>30 分钟</option>
            </select>
          </label>
          <button
            className="secondary-button"
            disabled={busy || state.accounts.length === 0}
            onClick={() => void run(() => window.dashboardApi.refreshAll(), "已开始依次刷新全部账号")}
          >
            <Icon name="refresh" />刷新全部
          </button>
          <button className="primary-button" onClick={() => setAdding(true)}>
            <Icon name="plus" />添加账号
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <span className="eyebrow">本机实时监控</span>
            <h1>先看余量，再决定切换哪个账号。</h1>
            <p>每个账号使用独立 WebContentsView 与登录态，按最低余量自动排序。</p>
          </div>
          <div className="summary-grid">
            <div><span>账号总数</span><strong>{state.accounts.length}</strong></div>
            <div><span>数据正常</span><strong>{normalCount}</strong></div>
            <div className={warningCount > 0 ? "summary-warning" : ""}><span>需要关注</span><strong>{warningCount}</strong></div>
            <div><span>最近更新</span><strong className="summary-time">{formatTimestamp(latestUpdate)}</strong></div>
          </div>
        </section>

        <section className="section-heading">
          <div>
            <h2>账号余量</h2>
            <p>卡片按 5 小时、周、月三档中的最低余量升序排列</p>
          </div>
          <div className="legend"><span className="good" />充足 <span className="warn" />注意 <span className="danger" />即将耗尽</div>
        </section>

        {message && <div className="notice" onClick={() => setMessage(null)}>{message}</div>}

        {accounts.length === 0 ? (
          <section className="empty-state">
            <div className="empty-illustration"><span /><span /><span /></div>
            <h2>还没有要监控的账号</h2>
            <p>添加第一个账号，完成登录并打开 OpenCode Go 用量页面。</p>
            <button className="primary-button" onClick={() => setAdding(true)}><Icon name="plus" />添加账号</button>
          </section>
        ) : (
          <section className="account-list">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                now={now}
                onOpen={() => void run(() => window.dashboardApi.showAccount(account.id))}
                onRefresh={() => void run(() => window.dashboardApi.refreshAccount(account.id))}
                onDelete={() => {
                  if (window.confirm(`确定删除“${account.name}”吗？对应的本地登录态也会被清除。`)) {
                    void run(() => window.dashboardApi.removeAccount(account.id), "账号已删除");
                  }
                }}
              />
            ))}
          </section>
        )}
      </main>

      <footer className="page-footer">
        <span>数据来自账号内嵌页面的 Network 响应，仅保存在本机。</span>
        <button onClick={() => void window.dashboardApi.openExternal("https://opencode.ai/legal/terms-of-service")}>查看 OpenCode 服务条款</button>
      </footer>

      {adding && (
        <AddAccountDialog
          onClose={() => setAdding(false)}
          onSubmit={(name) => run(() => window.dashboardApi.addAccount(name)) as Promise<void>}
        />
      )}
    </div>
  );
}
