import { executeUserCode } from "./execute.ts";

type ForgeWorkerScope = {
  onmessage: ((event: MessageEvent<{ code: string }>) => void) | null;
  postMessage: (message: unknown) => void;
};

const scope = self as unknown as ForgeWorkerScope;

scope.onmessage = (event: MessageEvent<{ code: string }>) => {
  void executeUserCode(event.data.code)
    .then((result) => {
      scope.postMessage(result);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      scope.postMessage({
        ok: false,
        error: {
          code: "MVM_E_RUN_FAILED",
          message,
          severity: "error",
          timestamp: Date.now(),
          recoveryHint: "The sandbox crashed before it could return a scene. The previous scene is unchanged.",
        },
        logs: [],
        issues: [],
      });
    });
};
