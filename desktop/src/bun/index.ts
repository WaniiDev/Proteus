import { BrowserView, BrowserWindow, GlobalShortcut, Screen, Tray, Updater, app } from "electrobun/bun";
import type { ProviderId, ProviderModelId, ProteusRPCSchema } from "../shared/contracts";
import { encodeRuntimeSnapshot } from "../shared/runtime-snapshot-codec";
import { TextRuntime } from "./runtime";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const WINDOW_MARGIN = 24;
const DEFAULT_WINDOW_FRAME = {
  width: 1440,
  height: 760,
  x: 120,
  y: 40,
};
const runtime = new TextRuntime();

app.on("before-quit", () => {
  // Electrobun's event is synchronous. Start Mastra's documented shutdown
  // immediately so its workspace and LibSQL handles close during the native
  // shutdown grace window.
  void runtime.shutdown().catch((error) => console.error("Mastra shutdown failed", error));
});

function getInitialWindowFrame() {
  try {
    const { workArea } = Screen.getPrimaryDisplay();
    if (workArea.width > 0 && workArea.height > 0) {
      const width = Math.min(DEFAULT_WINDOW_FRAME.width, workArea.width - WINDOW_MARGIN * 2);
      const height = Math.min(DEFAULT_WINDOW_FRAME.height, workArea.height - WINDOW_MARGIN * 2);

      return {
        width,
        height,
        x: workArea.x + Math.max(WINDOW_MARGIN, Math.floor((workArea.width - width) / 2)),
        y: workArea.y + Math.max(WINDOW_MARGIN, Math.floor((workArea.height - height) / 2)),
      };
    }
  } catch (error) {
    console.warn("Unable to read the primary display work area; using the default window frame.", error);
  }

  return DEFAULT_WINDOW_FRAME;
}

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();

  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      return DEV_SERVER_URL;
    } catch {
      console.info("Vite HMR server is not running; using the bundled view.");
    }
  }

  return "views://mainview/index.html";
}

const rpc = BrowserView.defineRPC<ProteusRPCSchema>({
  maxRequestTime: 60_000,
  handlers: {
    requests: {
      "runtime.bootstrap": async () => encodeRuntimeSnapshot(await runtime.initialize()),
      "providers.connect": async ({ providerId, apiKey, mode }) => {
        try {
          await runtime.connectProvider(providerId, { apiKey, mode });
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "providers.disconnect": async ({ providerId }) => {
        try {
          await runtime.disconnectProvider(providerId);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "providers.auth.submit": async ({ providerId, value }) => {
        try {
          await runtime.submitProviderAuth(providerId, value);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "providers.auth.cancel": async ({ providerId }) => {
        try {
          await runtime.cancelProviderAuth(providerId);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "models.refresh": async () => {
        try {
          await runtime.refreshModels();
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "models.select": async ({ modelId }) => {
        try {
          await runtime.selectModel(modelId as ProviderModelId);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "providers.select": async ({ providerId }) => {
        try {
          await runtime.selectProvider(providerId as ProviderId);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "models.reasoning.select": async ({ reasoningEffort }) => {
        try {
          await runtime.selectReasoning(reasoningEffort);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "threads.create": async (params) => {
        try {
          const threadId = await runtime.createThread(params?.title);
          return { threadId };
        } catch (error) {
          runtime.reportError(error);
          return { threadId: "" };
        }
      },
      "threads.switch": async ({ threadId }) => {
        try {
          await runtime.switchThread(threadId);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "threads.select": async ({ threadId }) => {
        try {
          await runtime.selectThread(threadId);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "threads.rename": async ({ threadId, title }) => {
        try {
          await runtime.renameThread(threadId, title);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "threads.delete": async ({ threadId }) => {
        try {
          await runtime.deleteThread(threadId);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "chat.send": async ({ text, clientMessageId }) => {
        try {
          const { runId } = await runtime.send(text, clientMessageId);
          return { accepted: true, runId };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false, runId: "" };
        }
      },
      "chat.retry": async ({ messageId }) => {
        try {
          const { runId } = await runtime.retry(messageId);
          return { accepted: true, runId };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false, runId: "" };
        }
      },
      "chat.continue": async ({ messageId }) => {
        try {
          const { runId } = await runtime.continueFrom(messageId);
          return { accepted: true, runId };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false, runId: "" };
        }
      },
      "chat.interaction.respond": async ({ toolCallId, response }) => {
        const startedAt = performance.now();
        runtime.traceDiagnostic({ source: "rpc", type: "chat.interaction.respond", phase: "start", toolCallId, payload: { response } });
        try {
          const result = await runtime.respondToInteraction(toolCallId, response);
          runtime.traceDiagnostic({ source: "rpc", type: "chat.interaction.respond", phase: "end", toolCallId, durationMs: performance.now() - startedAt, payload: result });
          return result;
        } catch (error) {
          runtime.traceDiagnostic({ source: "rpc", type: "chat.interaction.respond", phase: "error", toolCallId, durationMs: performance.now() - startedAt, payload: error });
          runtime.reportError(error);
          return { accepted: false, code: "resume-failed" as const, message: "The interaction could not be processed.", retryable: true };
        }
      },
      "chat.interaction.dismiss": async ({ toolCallId }) => {
        try {
          return await runtime.dismissInteraction(toolCallId);
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false, code: "resume-failed" as const, message: "The interaction could not be dismissed.", retryable: true };
        }
      },
      "chat.tool-approval.respond": async ({ toolCallId, approved }) => {
        try {
          await runtime.respondToToolApproval(toolCallId, approved);
          return { accepted: true };
        } catch (error) {
          runtime.reportError(error);
          return { accepted: false };
        }
      },
      "chat.abort": async () => {
        runtime.abort();
        return { accepted: true };
      },
      "diagnostics.get": async (params) => runtime.getDiagnostics(params?.limit),
      "diagnostics.set-enabled": async ({ enabled }) => runtime.setDiagnosticsEnabled(enabled),
      "diagnostics.clear": async () => runtime.clearDiagnostics(),
      "diagnostics.export": async () => runtime.exportDiagnostics(),
    },
    messages: {},
  },
});

const mainWindow = new BrowserWindow({
  title: "Proteus",
  url: await getMainViewUrl(),
  // Keep the initial window inside the OS work area, including scaled Windows
  // displays where a fixed frame can otherwise extend behind the taskbar.
  frame: getInitialWindowFrame(),
  titleBarStyle: "hidden",
  rpc,
});

runtime.onSnapshot((snapshot) => {
  rpc.send["runtime.changed"](encodeRuntimeSnapshot(snapshot));
});

let windowVisible = true;

const tray = new Tray({
  title: "Proteus",
  // Electrobun's native Windows tray loader expects an icon resource even
  // though views:// PNGs work on the other desktop platforms.
  image: process.platform === "win32" ? "views://mainview/assets/proteus.ico" : "views://mainview/assets/proteus-orb-32.png",
  template: false,
  width: 20,
  height: 20,
});
tray.setMenu([
  { type: "normal", label: "Show Proteus", action: "show" },
  { type: "normal", label: "Quit", action: "quit" },
]);
tray.on("tray-clicked", async (event) => {
  const action = ((event as unknown as { data?: unknown }).data as { action?: string } | undefined)?.action;
  if (action === "quit") {
    await runtime.shutdown();
    mainWindow.close();
    return;
  }
  mainWindow.show();
  windowVisible = true;
});

GlobalShortcut.register("Super+Shift+P", () => {
  if (windowVisible) {
    mainWindow.hide();
    windowVisible = false;
  } else {
    mainWindow.show();
    windowVisible = true;
  }
});

console.info("Proteus desktop shell started", { tray, mainWindow });
