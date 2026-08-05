import { AcpAgent } from "@mastra/acp";
import type { RequestPermissionRequest, RequestPermissionResponse, SessionUpdate } from "@agentclientprotocol/sdk";
import type { ChatToolPart, ProviderModel, ReasoningEffort, TokenUsage, WorkbenchTask } from "../shared/contracts";
import { resolveCodexAcpLaunch } from "./codex-acp";

export type CodexProjection = {
  text: string;
  tools: Map<string, ChatToolPart>;
  tasks: WorkbenchTask[];
  usage: TokenUsage;
};

export type CodexPermission = {
  toolCallId: string;
  toolName: string;
  args: unknown;
};

const reasoningValues = new Set<ReasoningEffort>(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);

export function mapCodexModels(models: Awaited<ReturnType<AcpAgent["getAvailableModels"]>>): ProviderModel[] {
  const effortsByBase = new Map<string, ReasoningEffort[]>();
  for (const model of models) {
    const match = model.modelId.match(/^(.*)\[([^\]]+)]$/);
    if (!match || !reasoningValues.has(match[2] as ReasoningEffort)) continue;
    const efforts = effortsByBase.get(match[1]) ?? [];
    efforts.push(match[2] as ReasoningEffort);
    effortsByBase.set(match[1], efforts);
  }
  return models.map((model) => {
    const match = model.modelId.match(/^(.*)\[([^\]]+)]$/);
    const reasoningEffort = match && reasoningValues.has(match[2] as ReasoningEffort) ? match[2] as ReasoningEffort : undefined;
    const baseModelId = match?.[1] ?? model.modelId;
    return {
      id: `codex/${model.modelId}`,
      providerId: "codex",
      rawId: model.modelId,
      baseModelId,
      name: model.name,
      description: model.description ?? undefined,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(effortsByBase.has(baseModelId) ? { reasoningOptions: [...new Set(effortsByBase.get(baseModelId)!)] } : {}),
      inputModalities: ["text"],
      outputModalities: ["text"],
    };
  });
}

function textFromContent(content: unknown): string {
  return content && typeof content === "object" && "type" in content && content.type === "text" && "text" in content && typeof content.text === "string" ? content.text : "";
}

function toolStatus(status: unknown): ChatToolPart["status"] {
  if (status === "completed") return "completed";
  if (status === "failed") return "error";
  if (status === "pending") return "streaming_input";
  return "running";
}

export function emptyCodexProjection(): CodexProjection {
  return { text: "", tools: new Map(), tasks: [], usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
}

export function projectCodexUpdate(state: CodexProjection, update: SessionUpdate): CodexProjection {
  if (update.sessionUpdate === "agent_message_chunk") {
    return { ...state, text: state.text + textFromContent(update.content) };
  }
  if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
    const previous = state.tools.get(update.toolCallId);
    const name = update.name ?? previous?.name ?? update.kind ?? "tool";
    const next: ChatToolPart = {
      type: "tool",
      id: `codex-tool:${update.toolCallId}`,
      toolCallId: update.toolCallId,
      name,
      label: update.title ?? previous?.label ?? name,
      status: toolStatus(update.status ?? previous?.status),
      ...(update.rawInput !== undefined ? { input: update.rawInput, inputSummary: JSON.stringify(update.rawInput).slice(0, 500) } : previous?.input !== undefined ? { input: previous.input, inputSummary: previous.inputSummary } : {}),
      ...(update.rawOutput !== undefined ? { output: update.rawOutput, outputSummary: JSON.stringify(update.rawOutput).slice(0, 500) } : previous?.output !== undefined ? { output: previous.output, outputSummary: previous.outputSummary } : {}),
    };
    const tools = new Map(state.tools);
    tools.set(update.toolCallId, next);
    return { ...state, tools };
  }
  if (update.sessionUpdate === "plan") {
    return {
      ...state,
      tasks: update.entries.map((entry, index) => ({ id: `codex-plan-${index}`, content: entry.content, activeForm: entry.content, status: entry.status })),
    };
  }
  if (update.sessionUpdate === "usage_update") {
    return { ...state, usage: { promptTokens: update.used, completionTokens: 0, totalTokens: update.used } };
  }
  return state;
}

type PendingPermission = {
  request: RequestPermissionRequest;
  resolve: (response: RequestPermissionResponse) => void;
};

export class CodexProviderRuntime {
  private readonly agents = new Map<string, AcpAgent>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();

  constructor(
    private readonly cwd: string,
    private readonly onPermission: (permission: CodexPermission | null) => void,
  ) {}

  private createAgent(threadId: string): AcpAgent {
    return new AcpAgent({
      id: `proteus-codex-${threadId}`,
      name: "PROTEUS Codex",
      description: "Codex coding agent connected through Mastra ACP",
      ...resolveCodexAcpLaunch(),
      cwd: this.cwd,
      persistSession: true,
      onPermissionRequest: (request) => new Promise((resolve) => {
        this.pendingPermissions.set(request.toolCall.toolCallId, { request, resolve });
        this.onPermission({
          toolCallId: request.toolCall.toolCallId,
          toolName: request.toolCall.kind ?? request.toolCall.title ?? "Codex action",
          args: request.toolCall.rawInput ?? request.toolCall.content ?? {},
        });
      }),
    });
  }

  private agent(threadId: string): AcpAgent {
    const current = this.agents.get(threadId);
    if (current) return current;
    const created = this.createAgent(threadId);
    this.agents.set(threadId, created);
    return created;
  }

  async listModels(): Promise<ProviderModel[]> {
    return mapCodexModels(await this.agent("catalog").getAvailableModels());
  }

  async run(threadId: string, modelId: string, prompt: string, signal: AbortSignal, onUpdate: (update: SessionUpdate) => void): Promise<void> {
    const agent = this.agent(threadId);
    await agent.setModel(modelId);
    for await (const event of agent.connection.promptStream(prompt, signal)) {
      if (event.type === "session-update") onUpdate(event.update);
      else onUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: event.text } });
    }
  }

  respondToPermission(toolCallId: string, approved: boolean): boolean {
    const pending = this.pendingPermissions.get(toolCallId);
    if (!pending) return false;
    this.pendingPermissions.delete(toolCallId);
    const preferredKind = approved ? "allow_once" : "reject_once";
    const option = pending.request.options.find((candidate) => candidate.kind === preferredKind)
      ?? pending.request.options.find((candidate) => approved ? candidate.kind.startsWith("allow") : candidate.kind.startsWith("reject"));
    pending.resolve(option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } });
    this.onPermission(null);
    return true;
  }

  async cancel(threadId: string): Promise<void> {
    await this.agents.get(threadId)?.connection.cancel();
  }

  disconnect(): void {
    for (const agent of this.agents.values()) agent.connection.disconnect();
    this.agents.clear();
  }
}
