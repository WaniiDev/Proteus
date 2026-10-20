import { afterEach, describe, expect, it } from "bun:test";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_INSTRUCTIONS } from "../core/agent-instructions";
import { scriptedStreamingModel, waitFor } from "../native/native-mastra-test-harness";
import { z } from "zod";
import { createShowAnswerTool } from "./show-answer-tool";

const headline = { type: "headline", text: "Two things need you today." };
const valid = { v: 2, title: "Today", blocks: [headline, { type: "sources", items: ["a.md"] }] };
const noHeadline = { v: 2, title: "Today", blocks: [{ type: "text", text: "Context." }] };

describe("show_answer tool", () => {
  it("is described in the agent instructions", () => {
    expect(AGENT_INSTRUCTIONS).toContain("Use show_answer when the reply is a set of things to act on, a comparison, a plan, numbers or a trend; answer in prose otherwise");
  });

  it("acknowledges a valid answer", async () => {
    const tool = createShowAnswerTool();
    expect(await tool.execute!(valid as never, {} as never)).toEqual({ ok: true, shown: true });
  });

  it("allows one retry, then tells the model to answer in prose, then resets", async () => {
    const tool = createShowAnswerTool();
    const run = () => tool.execute!(noHeadline as never, {} as never) as Promise<{ ok: boolean; retry?: boolean; message?: string }>;
    const first = await run();
    expect(first).toMatchObject({ ok: false, retry: true });
    expect(first.message).toContain("headline");
    expect(await run()).toMatchObject({ ok: false, retry: false });
    expect(await run()).toMatchObject({ ok: false, retry: true });
  });

  it("counts failures per turn: turn 2's first failure gets a retry", async () => {
    const tool = createShowAnswerTool();
    const turn = (users: number) => ({ agent: { threadId: "t", messages: Array.from({ length: users }, () => ({ role: "user" })) } }) as never;
    const run = (users: number) => tool.execute!(noHeadline as never, turn(users)) as Promise<{ retry?: boolean }>;
    expect(await run(1)).toMatchObject({ retry: true });
    expect(await run(1)).toMatchObject({ retry: false });
    expect(await run(2)).toMatchObject({ retry: true });
    // a failure left unresolved in turn 2 does not leak into turn 3 either
    expect(await run(3)).toMatchObject({ retry: true });
  });

  it("returns the retry as a normal result, not an error", async () => {
    const tool = createShowAnswerTool();
    const result = await tool.execute!(noHeadline as never, {} as never) as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect(result.isError).toBeUndefined();
    expect(typeof result.message).toBe("string");
  });

  it("a block that breaks its limits is a fallback, not a rejection", async () => {
    const tool = createShowAnswerTool();
    const input = { v: 2, title: "Today", blocks: [headline, { type: "text", text: "see [x](http://a.b)" }] };
    expect(await tool.execute!(input as never, {} as never)).toEqual({ ok: true, shown: true });
  });

  it("sends a JSON schema with no tuple items arrays", () => {
    const schema = JSON.stringify(z.toJSONSchema(createShowAnswerTool().inputSchema as never));
    expect(schema).not.toContain('"prefixItems"');
    expect(/"items":\s*\[/.test(schema)).toBe(false);
  });

  it("a valid answer clears the failure count", async () => {
    const tool = createShowAnswerTool();
    await tool.execute!(noHeadline as never, {} as never);
    await tool.execute!(valid as never, {} as never);
    expect(await tool.execute!(noHeadline as never, {} as never)).toMatchObject({ retry: true });
  });
});

describe("show_answer retry then prose (Mastra harness)", () => {
  const directories: string[] = [];
  const instances: Mastra[] = [];
  afterEach(async () => {
    await Promise.all(instances.splice(0).map((m) => m.shutdown()));
    await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)));
  });

  async function run(steps: Parameters<typeof scriptedStreamingModel>[0]) {
    const directory = await mkdtemp(join(tmpdir(), "show-answer-"));
    directories.push(directory);
    const storage = new LibSQLStore({ id: `show-answer-${crypto.randomUUID()}`, url: `file:${join(directory, "mastra.db")}` });
    const memory = new Memory({ storage });
    const agent = new Agent({
      id: `show-answer-agent-${crypto.randomUUID()}`,
      name: "Show answer test",
      instructions: "Answer with show_answer when useful.",
      model: scriptedStreamingModel(steps),
      memory,
      tools: { show_answer: createShowAnswerTool() },
    });
    const mastra = new Mastra({ storage, agents: { test: agent }, logger: false });
    instances.push(mastra);
    const resourceId = "user";
    const threadId = `thread-${crypto.randomUUID()}`;
    const chunks: Array<{ type: string; payload?: any }> = [];
    const subscription = await agent.subscribeToThread({ resourceId, threadId });
    void (async () => { for await (const chunk of subscription.stream) chunks.push(chunk as never); })();
    agent.queueMessage({ contents: "What does my day look like?", metadata: { clientMessageId: crypto.randomUUID() } }, { resourceId, threadId });
    await waitFor("run finish", () => chunks.find((c) => c.type === "finish" || c.type === "error"), 15_000);
    return chunks;
  }

  const results = (chunks: Array<{ type: string; payload?: any }>) => chunks.filter((c) => c.type === "tool-result").map((c) => c.payload?.result);
  const text = (chunks: Array<{ type: string; payload?: any }>) => chunks.filter((c) => c.type === "text-delta").map((c) => c.payload?.text ?? c.payload?.delta ?? "").join("");

  it("rejects a bad composition, accepts the retry", async () => {
    const chunks = await run([
      { type: "tool", toolName: "show_answer", input: noHeadline },
      { type: "tool", toolName: "show_answer", input: valid },
      { type: "text", text: "Done." },
    ]);
    const r = results(chunks);
    expect(r[0]).toMatchObject({ ok: false, retry: true });
    expect(r[1]).toEqual({ ok: true, shown: true });
  });

  it("counts an 11-block answer and a bad block under the retry rule instead of failing input validation", async () => {
    const eleven = { v: 2, title: "Today", blocks: [headline, ...Array.from({ length: 10 }, () => ({ type: "text", text: "x" }))] };
    const withBad = { v: 2, title: "Today", blocks: [headline, { type: "text", text: "<b>x</b>" }] };
    const chunks = await run([
      { type: "tool", toolName: "show_answer", input: eleven },
      { type: "tool", toolName: "show_answer", input: withBad },
      { type: "text", text: "Done." },
    ]);
    const r = results(chunks);
    expect(r[0]).toMatchObject({ ok: false, retry: true });
    expect(r[1]).toEqual({ ok: true, shown: true });
  });

  it("falls back to prose when the retry fails too", async () => {
    const chunks = await run([
      { type: "tool", toolName: "show_answer", input: noHeadline },
      { type: "tool", toolName: "show_answer", input: noHeadline },
      { type: "text", text: "Here it is in prose." },
    ]);
    const r = results(chunks);
    expect(r[0]).toMatchObject({ ok: false, retry: true });
    expect(r[1]).toMatchObject({ ok: false, retry: false });
    expect(text(chunks)).toContain("Here it is in prose.");
  });
});
