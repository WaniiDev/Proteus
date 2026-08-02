import { BrowserWindow, GlobalShortcut, Tray, Updater } from "electrobun/bun";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

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

const mainWindow = new BrowserWindow({
  title: "PROTEUS",
  url: await getMainViewUrl(),
  frame: {
    width: 1440,
    height: 900,
    x: 120,
    y: 80,
  },
  titleBarStyle: "hidden",
});

let windowVisible = true;

const tray = new Tray({ title: "PROTEUS" });
tray.setMenu([
  { type: "normal", label: "Show PROTEUS", action: "show" },
  { type: "normal", label: "Quit", action: "quit" },
]);
tray.on("tray-clicked", (event) => {
  const action = ((event as unknown as { data?: unknown }).data as { action?: string } | undefined)?.action;
  if (action === "quit") {
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

console.info("PROTEUS desktop shell started", { tray, mainWindow });
