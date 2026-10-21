import { afterEach, describe, expect, it } from "bun:test";
import { createAnthropic } from "@ai-sdk/anthropic";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import type { ProviderModel } from "../../shared/contracts";
import { openRouterGateway } from "../providers/openrouter";
import { reasoningProviderOptions, withReasoning } from "./reasoning-options";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const claude: ProviderModel = { id: "anthropic/claude-opus-4-8", providerId: "anthropic", rawId: "claude-opus-4-8", name: "Claude Opus 4.8", inputModalities: ["text"], outputModalities: ["text"], reasoningOptions: ["none", "low", "medium", "high", "xhigh", "max"], reasoningEffort: "medium" };
const gpt: ProviderModel = { id: "openrouter/openai/gpt-5", providerId: "openrouter", rawId: "openai/gpt-5", name: "GPT-5", inputModalities: ["text"], outputModalities: ["text"], reasoningOptions: ["none", "low", "medium", "high"], reasoningEffort: "medium" };

describe("reasoning provider options", () => {
  it("sends only a level the model offers, falling back to its default", () => {
    expect(reasoningProviderOptions(claude, "xhigh")).toEqual({ anthropic: { thinking: { type: "adaptive" }, effort: "xhigh" } });
    expect(reasoningProviderOptions(claude, null)).toEqual({ anthropic: { thinking: { type: "adaptive" }, effort: "medium" } });
    expect(reasoningProviderOptions(claude, "none")).toEqual({ anthropic: { thinking: { type: "disabled" } } });
    expect(reasoningProviderOptions(gpt, "xhigh")).toBeUndefined();
    expect(reasoningProviderOptions({ ...gpt, reasoningOptions: undefined, reasoningEffort: undefined }, null)).toBeUndefined();
    expect(reasoningProviderOptions(undefined, "high")).toBeUndefined();
  });

  it("keeps options set elsewhere in the step", () => {
    const args = { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } }, openai: { store: false } } };
    expect(withReasoning(args, { toolChoice: "none" }, { anthropic: { effort: "high" } })).toEqual({
      toolChoice: "none",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" }, effort: "high" }, openai: { store: false } },
    });
    expect(withReasoning(args, undefined, undefined)).toBeUndefined();
  });

  it("reaches the Anthropic request as thinking and effort", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "claude-opus-4-8", content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const model = createAnthropic({ apiKey: "sk-ant-test" })("claude-opus-4-8");
    const prompt = [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }];

    await model.doGenerate({ prompt, providerOptions: reasoningProviderOptions(claude, "xhigh") });
    await model.doGenerate({ prompt, providerOptions: reasoningProviderOptions(claude, "none") });

    expect(bodies[0]).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "xhigh" } });
    expect(bodies[1]).toMatchObject({ thinking: { type: "disabled" } });
    expect(bodies[1]?.output_config).toBeUndefined();
  });

  it("reaches the OpenRouter request through a Mastra agent step", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const chunks = [
        { id: "c", object: "chat.completion.chunk", created: 1, model: "openai/gpt-5", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] },
        { id: "c", object: "chat.completion.chunk", created: 1, model: "openai/gpt-5", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      ];
      return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    const run = async (level: "high" | "none") => {
      const agent = new Agent({
        id: `reasoning-${level}`,
        name: "Reasoning test",
        instructions: "Answer.",
        model: () => ({ id: gpt.id, apiKey: "sk-or-v1-test" }) as never,
        defaultOptions: { prepareStep: (args) => withReasoning(args, undefined, reasoningProviderOptions(gpt, level)) },
      });
      new Mastra({ agents: { agent }, gateways: { "models.dev": openRouterGateway }, logger: false });
      await (await agent.stream("hi")).text;
    };

    await run("high");
    await run("none");

    expect(bodies[0]?.reasoning).toEqual({ effort: "high" });
    expect(bodies[1]?.reasoning).toEqual({ enabled: false });
  });
});
