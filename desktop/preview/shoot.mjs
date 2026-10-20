// Usage: NODE_PATH=$(npm root -g) node preview/shoot.mjs <outDir> [scenario[:view][,...]] [--themes=light,dark]
// Needs the preview server running (see README). BASE_URL overrides http://localhost:5181.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.env.BASE_URL ?? "http://localhost:5181";
const args = process.argv.slice(2);
const outDir = args.find((arg) => !arg.startsWith("--") && args.indexOf(arg) === 0);
if (!outDir) { console.error("usage: shoot.mjs <outDir> [scenario[:view],...] [--themes=light,dark]"); process.exit(1); }
const listArg = args.slice(1).find((arg) => !arg.startsWith("--"));
const themes = (args.find((arg) => arg.startsWith("--themes="))?.slice(9) ?? "light,dark").split(",");

// Default shots: scenario -> optional view to open by clicking the sidebar / settings tabs.
const defaults = ["empty", "thread", "running", "ask", "settings:providers", "settings:models", "projects:projects", "long"];
const shots = (listArg ? listArg.split(",") : defaults).map((item) => {
  const [scenario, view] = item.split(":");
  return { scenario, view };
});

async function open(page, view) {
  if (!view) return;
  if (view === "projects") await page.getByRole("button", { name: "Projects", exact: true }).click();
  else {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    if (view !== "providers") await page.getByRole("tab", { name: new RegExp(`^${view}`, "i") }).click();
  }
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
let failures = 0;
for (const { scenario, view } of shots) {
  for (const theme of themes) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${base}/?scenario=${scenario}&theme=${theme}`, { waitUntil: "networkidle" });
      await page.waitForSelector("#root *");
      await open(page, view);
      await page.waitForTimeout(500);
      const file = join(outDir, `${scenario}${view && view !== scenario ? `-${view}` : ""}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log(file + (errors.length ? `  (page errors: ${errors.join("; ")})` : ""));
    } catch (error) {
      failures += 1;
      console.error(`FAILED ${scenario}:${view ?? ""} ${theme}: ${error.message}`);
    }
    await page.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
