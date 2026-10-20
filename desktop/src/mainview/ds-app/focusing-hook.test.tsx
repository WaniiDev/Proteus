import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useDom } from "../test/dom";
import { useFocusingMoment } from "./focusing";

useDom();

function mount(runActive: boolean) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const played: string[] = [];
  const orb = { pulse() {}, nudge() {}, playFocusing: () => void played.push("orb") };
  let api!: ReturnType<typeof useFocusingMoment>;
  function Probe() {
    api = useFocusingMoment({ orb: () => orb, surgeLayer: () => null, origin: () => null, runActive });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return { played, root, api: () => api, render: () => act(async () => root.render(<Probe />)) };
}

describe("useFocusingMoment", () => {
  test("plays the orb once per arrival and re-arms on leaving the top", async () => {
    const m = mount(false);
    await m.render();
    m.api().onTopLevel();
    m.api().onTopLevel();
    expect(m.played).toEqual(["orb"]);
    m.api().onLeaveTop();
    m.api().onTopLevel();
    expect(m.played).toEqual(["orb", "orb"]);
    await act(async () => m.root.unmount());
  });

  test("does nothing while a run is going", async () => {
    const m = mount(true);
    await m.render();
    m.api().onTopLevel();
    expect(m.played).toEqual([]);
    await act(async () => m.root.unmount());
  });
});
