import { describe, expect, it } from "bun:test";
import { orbStates } from "../shared/contracts";
import { ORB_CAMERA_DISTANCE, ORB_INITIAL_FX } from "./orb3d";
import { ORB_STATES } from "./orb-spec";

describe("orb visual contract", () => {
  it("contains every guide state with a pastel palette and motion target", () => {
    expect(Object.keys(ORB_STATES)).toEqual([...orbStates]);
    for (const state of orbStates) {
      const spec = ORB_STATES[state];
      expect(spec.a).toMatch(/^#[0-9a-f]{6}$/i);
      expect(spec.b).toMatch(/^#[0-9a-f]{6}$/i);
      expect(spec.amp).toBeGreaterThanOrEqual(0);
      expect(spec.speed).toBeGreaterThanOrEqual(0);
      expect(spec.freq).toBeGreaterThan(0);
      expect(spec.scale).toBeGreaterThan(0);
    }
  });

  it("keeps the guide's key liquid extremes", () => {
    expect(ORB_STATES.idle).toMatchObject({ amp: 0.10, speed: 0.40, a: "#a7e5d3", b: "#c8b8e0" });
    expect(ORB_STATES.working).toMatchObject({ amp: 0.27, speed: 1.65, a: "#f4c5a8", b: "#c8b8e0" });
    expect(ORB_STATES.interrupted).toMatchObject({ amp: 0.03, speed: 0.10, scale: 0.80 });
    expect(ORB_STATES.done).toMatchObject({ scale: 1.12, a: "#a7e5d3", b: "#d8f3e8" });
    expect(ORB_STATES.summoned).toMatchObject({ amp: 0.14, speed: 0.90, freq: 1.10, scale: 1.06, voice: 0, a: "#a8c8e8", b: "#c8b8e0" });
    expect(ORB_STATES.remembering).toMatchObject({ amp: 0.16, speed: 0.55, freq: 0.80, scale: 0.98, voice: 0, a: "#c8b8e0", b: "#e8b8c4" });
    expect(ORB_STATES.drafting).toMatchObject({ amp: 0.18, speed: 1.10, freq: 1.25, scale: 1.02, voice: 0.35, a: "#f4c5a8", b: "#e8b8c4" });
    expect(ORB_STATES.verifying).toMatchObject({ amp: 0.12, speed: 1.40, freq: 2.10, scale: 1.00, voice: 0, a: "#a7e5d3", b: "#a8c8e8" });
    expect(ORB_STATES.away).toMatchObject({ amp: 0.02, speed: 0.08, freq: 1.00, scale: 0.90, voice: 0, a: "#f0efed", b: "#e7e5e4" });
    expect(ORB_STATES.error).toMatchObject({ amp: 0.08, speed: 0.30, freq: 1.90, scale: 0.94, voice: 0, a: "#e8b8c4", b: "#d6d3d1" });
  });

  it("keeps every state palette pair unique", () => {
    const pairs = orbStates.map((state) => `${ORB_STATES[state].a}:${ORB_STATES[state].b}`);
    expect(new Set(pairs).size).toBe(orbStates.length);
  });

  it("keeps the resting state free of helper copy", () => {
    expect(ORB_STATES.idle.description).toBe("");
  });

  it("defines every new overlay, fallback, and reduced-motion guard", async () => {
    const css = await Bun.file(new URL("./proteus.css", import.meta.url)).text();
    for (const state of ["summoned", "remembering", "drafting", "verifying", "away", "error"]) {
      expect(css).toContain(`data-state="${state}"`);
    }
    expect(css).toContain("animation: ripple 1.2s ease-out 1");
    expect(css).toContain("animation: draftBreath 2.4s ease-in-out infinite");
    expect(css).toContain("animation: scanSpin 1.6s linear infinite");
    expect(css).toContain("opacity: .55");
    expect(css).toContain(".orb-float { transition: none !important; }");
  });

  it("keeps one prototype-sized surface across hero and header anchors", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();

    expect(css).toContain(".persistent-orb-surface");
    expect(css).toContain("width: 220px");
    expect(css).toContain(".orb-presence-docked .orb-anchor { width: 76px; height: 76px; }");
  });

  it("matches the prototype fallback geometry", async () => {
    const css = await Bun.file(new URL("./proteus.css", import.meta.url)).text();

    expect(css).toContain("position: absolute; inset: 6%; border-radius: 50%");
    expect(css).toContain("position: absolute; inset: 4%; border-radius: 50%; opacity: 0");
  });

  it("matches the prototype camera and initial liquid values", () => {
    expect(ORB_CAMERA_DISTANCE).toBe(3.15);
    expect(ORB_INITIAL_FX).toMatchObject({ amp: 0.14, speed: 0.45, freq: 1.15 });
  });

  it("exposes whether the live renderer is WebGL or the CSS fallback", async () => {
    const source = await Bun.file(new URL("./orb3d.ts", import.meta.url)).text();

    expect(source).toContain('floatEl.dataset.renderer = "webgl"');
    expect(source).toContain('floatEl.dataset.renderer = "fallback"');
  });

  it("keeps one WebGL orb mounted while its surface changes anchors", async () => {
    const source = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

    expect(source.match(/<Orb ref=/g)).toHaveLength(1);
    expect(source).toContain("function PersistentOrbSurface");
    expect(source).toContain("docked ? dockAnchor : heroAnchor");
    expect(source).toContain('anchor.closest<HTMLElement>(".companion-view")');
    expect(source).toContain("measureOrbPlacement(anchor.getBoundingClientRect(), companion.getBoundingClientRect())");
    expect(source).toContain("advanceOrbPlacement(current, target");
    expect(source).toContain("requestAnimationFrame(placeSurface)");
    expect(source).not.toContain('querySelector<HTMLElement>(".orb-float")');
  });

  it("moves a fixed-resolution WebGL surface without resizing its drawing buffer", async () => {
    const css = await Bun.file(new URL("./index.css", import.meta.url)).text();

    expect(css).toMatch(/\.persistent-orb-surface\s*\{[^}]*width:\s*220px;[^}]*height:\s*220px;/s);
    expect(css).toContain("will-change: transform, opacity");
    expect(css).not.toContain("transition: left 820ms");
  });

  it("does not deliberately lose the WebGL context during React cleanup", async () => {
    const source = await Bun.file(new URL("./orb3d.ts", import.meta.url)).text();

    expect(source).not.toContain("forceContextLoss");
  });
});
