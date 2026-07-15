import { describe, expect, it } from "vitest";
import { parseQuotaResponse } from "./quota-parser.js";

describe("parseQuotaResponse", () => {
  it("解析 SolidJS SSR 三档余量", () => {
    const html = `
      <script>
        rollingUsage:$R[1]={usagePercent:65.5,resetInSec:2520};
        weeklyUsage:$R[2]={resetInSec:259200,usagePercent:30};
        monthlyUsage:$R[3]={usagePercent:12,resetInSec:1728000};
      </script>
    `;
    const capturedAt = new Date("2026-07-15T12:00:00.000Z");
    const result = parseQuotaResponse(html, "https://opencode.ai/workspace/demo/go", capturedAt);

    expect(result?.rolling?.remainingPercent).toBe(34.5);
    expect(result?.weekly?.remainingPercent).toBe(70);
    expect(result?.monthly?.remainingPercent).toBe(88);
    expect(result?.rolling?.resetAt).toBe("2026-07-15T12:42:00.000Z");
  });

  it("解析 JSON 响应中的配额数据", () => {
    const json = JSON.stringify({
      rollingUsage: { usagePercent: 10, resetInSec: 300 },
      weeklyUsage: { usagePercent: 20, resetInSec: 400 },
      monthlyUsage: { usagePercent: 30, resetInSec: 500 },
    });
    const result = parseQuotaResponse(json, "https://opencode.ai/internal/usage");

    expect(result?.rolling?.remainingPercent).toBe(90);
    expect(result?.weekly?.remainingPercent).toBe(80);
    expect(result?.monthly?.remainingPercent).toBe(70);
  });

  it("解析 data-slot 页面结构", () => {
    const html = `
      <div data-slot="usage-item">
        <span data-slot="usage-label">Rolling Usage</span>
        <span data-slot="usage-value">42%</span>
        <span data-slot="reset-time">Resets in 1 hour 20 minutes</span>
      </div>
      <div data-slot="usage-item">
        <span data-slot="usage-label">Weekly Usage</span>
        <span data-slot="usage-value">7%</span>
        <span data-slot="reset-time">Resets in 3 days 2 hours</span>
      </div>
      <div data-slot="usage-item">
        <span data-slot="usage-label">Monthly Usage</span>
        <span data-slot="usage-value">91%</span>
        <span data-slot="reset-now">Reset now</span>
      </div>
    `;
    const result = parseQuotaResponse(html, "https://opencode.ai/workspace/demo/go");

    expect(result?.rolling?.resetInSec).toBe(4_800);
    expect(result?.weekly?.resetInSec).toBe(266_400);
    expect(result?.monthly?.remainingPercent).toBe(9);
  });

  it("无配额字段时不产生快照", () => {
    expect(parseQuotaResponse("<html>普通页面</html>", "https://opencode.ai/")).toBeUndefined();
  });
});
