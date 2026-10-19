import type { LanguageModelV2, LanguageModelV2StreamPart } from "@ai-sdk/provider-v5";

export type ScriptedModelStep =
  | { type: "tool"; toolName: string; input: Record<string, unknown> }
  | { type: "text"; text: string };

function modelStream(parts: LanguageModelV2StreamPart[]) {
  return {
    rawCall: { rawPrompt: null, rawSettings: {} },
    warnings: [],
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "response-metadata", id: crypto.randomUUID(), modelId: "native-contract-model", timestamp: new Date(0) });
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

export function scriptedStreamingModel(
  steps: ScriptedModelStep[],
  onRequest?: (input: { toolNames: string[]; toolChoice: unknown }) => void,
): LanguageModelV2 {
  let index = 0;
  return {
    specificationVersion: "v2",
    provider: "proteus-test",
    modelId: "native-contract-model",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("This native contract fixture exercises streaming only.");
    },
    doStream: async (options) => {
      onRequest?.({
        toolNames: (options.tools ?? []).map((tool) => tool.name),
        toolChoice: options.toolChoice,
      });
      const step = steps[index++];
      if (!step || step.type === "text") {
        const text = step?.text ?? "Done.";
        return modelStream([
          { type: "text-start", id: `text-${index}` },
          { type: "text-delta", id: `text-${index}`, delta: text },
          { type: "text-end", id: `text-${index}` },
          { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        ]);
      }
      return modelStream([
        { type: "tool-call", toolCallId: `call-${index}`, toolName: step.toolName, input: JSON.stringify(step.input) },
        { type: "finish", finishReason: "tool-calls", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ]);
    },
  };
}

export async function waitFor<T>(description: string, read: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
