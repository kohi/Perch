import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser } from "@playwright/test";

/**
 * 実プロセスの Chromium を、固定 user-data-dir ＋ CDP で spawn する。
 *
 * なぜ launchPersistentContext ではなく手動 spawn か:
 *   - launchPersistentContext は underlying プロセスの PID を公開しない → SIGKILL できない。
 *   - 手動 spawn + connectOverCDP なら ChildProcess を握れる → 実 SIGKILL が可能。
 *   - 固定 user-data-dir により IndexedDB が実ディスクに永続し、プロセスをまたいで残る。
 * これで「強制kill→再起動でメモが残る」(TC-103) を偽装なしで再現できる。
 *
 * macOS 本番は WKWebView（tauri-driver 非対応）。ここは Chromium での近似検証であり、
 * アプリの「1文字ごと保存→再起動で復元」ロジックと IndexedDB 永続の実挙動を検証する。
 */
export interface ChromeHandle {
  proc: ChildProcess;
  browser: Browser;
}

async function waitForCdp(port: number, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return `http://127.0.0.1:${port}`;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`CDP endpoint not ready on port ${port}: ${String(lastErr)}`);
}

export async function launchChrome(userDataDir: string, port: number): Promise<ChromeHandle> {
  const exe = chromium.executablePath();
  const proc = spawn(
    exe,
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-features=Translate",
      "--headless=new",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const endpoint = await waitForCdp(port);
  const browser = await chromium.connectOverCDP(endpoint);
  return { proc, browser };
}

/** 実 SIGKILL（保存猶予を与えない・graceful close しない）。プロセス終了まで待つ。 */
export async function sigkill(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  proc.kill("SIGKILL");
  await exited;
}

/** 通常終了相当（graceful）。CDP 経由で閉じ、プロセス終了まで待つ。 */
export async function gracefulClose(handle: ChromeHandle): Promise<void> {
  const { proc, browser } = handle;
  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  try {
    await browser.close();
  } catch {
    /* 既に切断されていてもよい */
  }
  // browser.close だけでプロセスが残る場合に備え、猶予後に SIGTERM
  const timer = setTimeout(() => proc.kill("SIGTERM"), 2000);
  await exited;
  clearTimeout(timer);
}
