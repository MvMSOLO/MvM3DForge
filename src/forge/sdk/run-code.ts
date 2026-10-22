import { LIMITS } from "../limits.ts";
import { issue } from "../errors.ts";
import type { RunResult } from "../types.ts";
import { executeUserCode } from "./execute.ts";

let generation = 0;
let active: Worker | null = null;

export function cancelRun() {
  generation += 1;
  active?.terminate();
  active = null;
}

export function runInSandbox(code: string, timeoutMs = LIMITS.codeTimeoutMs): Promise<RunResult> {
  cancelRun();
  const token = generation;
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./runtime.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void executeUserCode(code).then((result) => {
        if (result.ok) {
          result.logs.unshift({
            id: crypto.randomUUID(),
            level: "warn",
            message: `Sandbox worker was unavailable (${message}). Code ran on the main thread with weaker isolation.`,
            timestamp: Date.now(),
          });
        }
        resolve(result);
      });
      return;
    }
    active = worker;
    const timer = setTimeout(() => {
      if (token !== generation) return;
      worker.terminate();
      active = null;
      resolve({
        ok: false,
        error: issue("MVM_E_RUN_TIMEOUT", `Code exceeded ${timeoutMs} ms and was stopped.`, {
          recoveryHint: "Remove infinite loops or heavy synchronous work. The previous scene was kept.",
          context: { timeoutMs },
        }),
        logs: [],
        issues: [],
      });
    }, timeoutMs);
    worker.onmessage = (event: MessageEvent<RunResult>) => {
      if (token !== generation) return;
      clearTimeout(timer);
      worker.terminate();
      active = null;
      resolve(event.data);
    };
    worker.onerror = (event) => {
      if (token !== generation) return;
      clearTimeout(timer);
      worker.terminate();
      active = null;
      resolve({
        ok: false,
        error: issue("MVM_E_RUN_FAILED", event.message || "Sandbox worker failed.", {
          recoveryHint: "Check the script for syntax that the worker rejected.",
        }),
        logs: [],
        issues: [],
      });
    };
    worker.postMessage({ code });
  });
}
