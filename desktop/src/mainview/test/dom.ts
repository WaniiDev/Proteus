// Opt-in DOM for component tests that need events, focus or keyboard input.
// Import `useDom()` at the top of a test file; backend tests never load it.
import { afterAll, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

export function useDom(): void {
  beforeAll(() => { if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" }); });
  afterAll(async () => { if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister(); });
}
