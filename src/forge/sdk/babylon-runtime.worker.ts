import * as BabylonCore from "@babylonjs/core";
import { LoadSceneAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import "@babylonjs/core/Loading/Plugins/babylonFileLoader.js";
import { ensureBabylonLoaders, executeBabylonCodeInScene } from "./execute-babylon.ts";
import { errorToIssue, issue } from "../errors.ts";
import type { RunResult } from "../types.ts";

type WorkerRequest = {
  type: "run";
  requestId: string;
  code: string;
  initialScene: Record<string, unknown>;
};

type WorkerResponse = {
  type: "result";
  requestId: string;
  result: RunResult;
};

const workerScope = globalThis as unknown as {
  addEventListener: (type: "message", listener: (event: MessageEvent<WorkerRequest>) => void) => void;
  postMessage: (message: WorkerResponse) => void;
  fetch: typeof fetch;
  location: Location;
};

let activeRequest = false;

function lockWorkerApi(name: string): void {
  try {
    Object.defineProperty(globalThis, name, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: undefined,
    });
  } catch {
    // Some browser implementations expose non-configurable worker globals.
  }
}

/**
 * This runtime never receives a Window, Document, cookie jar, or app storage object.
 * It also denies same-origin requests and network write transports. Remote HTTPS GET
 * remains available for user-selected Babylon texture/model assets and never carries
 * same-origin credentials. The parent terminates the worker after a hard deadline.
 */
function hardenWorkerNetwork(): void {
  const originalFetch = workerScope.fetch.bind(globalThis);
  const safeFetch: typeof fetch = async (input, init = {}) => {
    const requestUrl = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    const url = new URL(requestUrl, workerScope.location.href);
    const method = String(init.method ?? (typeof input === "object" && !(input instanceof URL) ? input.method : "GET")).toUpperCase();

    if (url.protocol === "data:" || url.protocol === "blob:") {
      return originalFetch(input, { ...init, method, credentials: "omit" });
    }
    if (url.protocol !== "https:" || url.origin === workerScope.location.origin) {
      throw new TypeError("MVM BABYLON worker blocked same-origin or non-HTTPS network access.");
    }
    if (method !== "GET" && method !== "HEAD") {
      throw new TypeError("MVM BABYLON worker allows only read-only HTTPS asset requests.");
    }
    return originalFetch(input, {
      ...init,
      method,
      mode: "cors",
      credentials: "omit",
    });
  };

  Object.defineProperty(globalThis, "fetch", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: safeFetch,
  });

  for (const name of [
    "window",
    "document",
    "localStorage",
    "sessionStorage",
    "indexedDB",
    "caches",
    "cookieStore",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "WebTransport",
    "BroadcastChannel",
    "SharedWorker",
    "Worker",
    "importScripts",
  ]) {
    lockWorkerApi(name);
  }
}

workerScope.addEventListener("message", async (event) => {
  const request = event.data;
  if (!request || request.type !== "run" || activeRequest) return;
  activeRequest = true;
  const engine = new BabylonCore.NullEngine({ renderWidth: 1024, renderHeight: 768 });
  let scene: BabylonCore.Scene | null = null;

  try {
    hardenWorkerNetwork();
    await ensureBabylonLoaders();
    scene = await LoadSceneAsync(
      `data:${JSON.stringify(request.initialScene)}`,
      engine,
      { pluginExtension: ".babylon" },
    );
    const result = await executeBabylonCodeInScene(request.code, scene, engine, null);
    workerScope.postMessage({ type: "result", requestId: request.requestId, result });
  } catch (error) {
    const parsed = errorToIssue(error, "MVM_E_BABYLON_WORKER");
    const runtimeIssue = issue(
      parsed.code || "MVM_E_BABYLON_WORKER",
      parsed.message || "The isolated Babylon runtime could not load the scene.",
      {
        recoveryHint: parsed.recoveryHint || "Check external asset URLs, then run the script again.",
        line: parsed.line,
        column: parsed.column,
      },
    );
    workerScope.postMessage({
      type: "result",
      requestId: request.requestId,
      result: { ok: false, error: runtimeIssue, logs: [], issues: [runtimeIssue] },
    });
  } finally {
    scene?.dispose();
    engine.dispose();
    activeRequest = false;
  }
});
