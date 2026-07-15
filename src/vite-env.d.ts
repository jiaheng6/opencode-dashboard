/// <reference types="vite/client" />

import type { DashboardApi } from "./types";

declare global {
  interface Window {
    dashboardApi: DashboardApi;
  }
}

export {};
