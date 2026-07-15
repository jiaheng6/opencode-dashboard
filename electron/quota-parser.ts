import type { QuotaSnapshot, QuotaWindow } from "./types.js";

type WindowKey = "rolling" | "weekly" | "monthly";

interface RawWindow {
  usagePercent: number;
  resetInSec: number;
}

const NUMBER = String.raw`(-?\d+(?:\.\d+)?)`;

function parseWindowFromSerializedState(body: string, key: WindowKey): RawWindow | undefined {
  const property = `${key}Usage`;
  const candidates = [
    new RegExp(
      String.raw`${property}\s*:\s*(?:\$R\[\d+\]\s*=\s*)?\{[^}]*?usagePercent\s*:\s*${NUMBER}[^}]*?resetInSec\s*:\s*${NUMBER}[^}]*?\}`,
    ),
    new RegExp(
      String.raw`${property}\s*:\s*(?:\$R\[\d+\]\s*=\s*)?\{[^}]*?resetInSec\s*:\s*${NUMBER}[^}]*?usagePercent\s*:\s*${NUMBER}[^}]*?\}`,
    ),
    new RegExp(
      String.raw`["']${property}["']\s*:\s*\{[^}]*?["']usagePercent["']\s*:\s*${NUMBER}[^}]*?["']resetInSec["']\s*:\s*${NUMBER}[^}]*?\}`,
    ),
    new RegExp(
      String.raw`["']${property}["']\s*:\s*\{[^}]*?["']resetInSec["']\s*:\s*${NUMBER}[^}]*?["']usagePercent["']\s*:\s*${NUMBER}[^}]*?\}`,
    ),
  ];

  for (const [index, pattern] of candidates.entries()) {
    const match = pattern.exec(body);
    if (!match) continue;

    const usagePercent = Number(index % 2 === 0 ? match[1] : match[2]);
    const resetInSec = Number(index % 2 === 0 ? match[2] : match[1]);
    if (Number.isFinite(usagePercent) && Number.isFinite(resetInSec)) {
      return { usagePercent, resetInSec };
    }
  }

  return undefined;
}

function parseDuration(text: string): number | undefined {
  const normalized = text
    .replace(/<!--.*?-->/g, "")
    .replace(/Resets?\s*in\s*/i, "")
    .trim()
    .toLowerCase();

  if (["now", "reset now", "resets now", "reset-now"].includes(normalized)) return 0;

  const units: Array<[RegExp, number]> = [
    [/(\d+(?:\.\d+)?)\s*days?/, 86_400],
    [/(\d+(?:\.\d+)?)\s*hours?/, 3_600],
    [/(\d+(?:\.\d+)?)\s*minutes?/, 60],
    [/(\d+(?:\.\d+)?)\s*seconds?/, 1],
  ];

  let seconds = 0;
  let matched = false;
  for (const [pattern, multiplier] of units) {
    const match = normalized.match(pattern);
    if (!match) continue;
    matched = true;
    seconds += Number(match[1]) * multiplier;
  }

  return matched ? seconds : undefined;
}

function parseDataSlotHtml(body: string): Partial<Record<WindowKey, RawWindow>> {
  const result: Partial<Record<WindowKey, RawWindow>> = {};
  const items = body.split(/data-slot=["']usage-item["']/i).slice(1);

  for (const item of items) {
    const label = item.match(/data-slot=["']usage-label["'][^>]*>([^<]+)/i)?.[1]?.toLowerCase();
    const usage = item.match(/data-slot=["']usage-value["'][^>]*>[^0-9]*(\d+(?:\.\d+)?)/i)?.[1];
    const reset = item.match(/data-slot=["'](?:reset-time|reset-now)["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
    if (!label || !usage || reset === undefined) continue;

    const key: WindowKey | undefined = label.includes("rolling")
      ? "rolling"
      : label.includes("weekly")
        ? "weekly"
        : label.includes("monthly")
          ? "monthly"
          : undefined;
    const resetInSec = parseDuration(reset);
    if (key && resetInSec !== undefined) {
      result[key] = { usagePercent: Number(usage), resetInSec };
    }
  }

  return result;
}

function normalizeWindow(raw: RawWindow, capturedAt: Date): QuotaWindow {
  const usagePercent = Math.min(100, Math.max(0, raw.usagePercent));
  const resetInSec = Math.max(0, raw.resetInSec);
  return {
    usagePercent,
    remainingPercent: Math.max(0, 100 - usagePercent),
    resetInSec,
    resetAt: new Date(capturedAt.getTime() + resetInSec * 1_000).toISOString(),
  };
}

export function parseQuotaResponse(
  body: string,
  sourceUrl: string,
  capturedAt = new Date(),
): QuotaSnapshot | undefined {
  const serialized: Partial<Record<WindowKey, RawWindow>> = {
    rolling: parseWindowFromSerializedState(body, "rolling"),
    weekly: parseWindowFromSerializedState(body, "weekly"),
    monthly: parseWindowFromSerializedState(body, "monthly"),
  };
  const raw = Object.values(serialized).some(Boolean) ? serialized : parseDataSlotHtml(body);

  if (!raw.rolling && !raw.weekly && !raw.monthly) return undefined;

  return {
    ...(raw.rolling ? { rolling: normalizeWindow(raw.rolling, capturedAt) } : {}),
    ...(raw.weekly ? { weekly: normalizeWindow(raw.weekly, capturedAt) } : {}),
    ...(raw.monthly ? { monthly: normalizeWindow(raw.monthly, capturedAt) } : {}),
    capturedAt: capturedAt.toISOString(),
    sourceUrl,
  };
}
