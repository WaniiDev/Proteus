import type { Processor, ProcessorViolation, ProcessInputStepArgs, ProcessInputStepResult, ProcessOutputStepArgs } from "@mastra/core/processors";

export type NativeToolCallViolation = {
  violation: "textual-tool-imitation";
  toolName: string;
};

const TOOL_CALL_IMITATION = /(?:^|\n)\s*to\s*=\s*(?:functions\.)?([A-Za-z][A-Za-z0-9_.-]*)\b/gim;

function availableToolNames(state: Record<string, unknown>): Set<string> {
  const names = state.availableToolNames;
  return new Set(Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : []);
}

function imitatedToolName(text: string, available: Set<string>): string | undefined {
  for (const match of text.matchAll(TOOL_CALL_IMITATION)) {
    const name = match[1];
    if (available.has(name)) return name;
  }
  return undefined;
}

/**
 * Uses Mastra's exact per-step tool dictionary as the source of truth. If a
 * provider writes an available tool call as prose, request one bounded native
 * retry instead of persisting a convincing but inert pseudo-call.
 */
export class NativeToolCallGuard implements Processor<"native-tool-call-guard", NativeToolCallViolation> {
  readonly id = "native-tool-call-guard" as const;
  readonly name = "Native tool-call integrity";
  onViolation?: (violation: ProcessorViolation) => void | Promise<void>;

  processInputStep({ tools, state }: ProcessInputStepArgs<NativeToolCallViolation>): ProcessInputStepResult | undefined {
    state.availableToolNames = Object.keys(tools ?? {}).sort();
    return undefined;
  }

  processOutputStep(args: ProcessOutputStepArgs<NativeToolCallViolation>) {
    if (!args.text) return args.messages;
    const toolName = imitatedToolName(args.text, availableToolNames(args.state));
    if (!toolName) return args.messages;
    if (args.toolCalls?.some((toolCall) => toolCall.toolName === toolName)) return args.messages;

    const retry = args.retryCount < 1;
    args.abort(
      retry
        ? `The ${toolName} tool is available, but you wrote a pseudo-call as text. Retry by invoking ${toolName} through the native tool-call interface. Do not print or explain tool-call syntax.`
        : `The ${toolName} tool was repeatedly emitted as text instead of a native tool call.`,
      {
        retry,
        metadata: { violation: "textual-tool-imitation", toolName },
      },
    );
  }
}
