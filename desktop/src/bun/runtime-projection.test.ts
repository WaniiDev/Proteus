import { describe, expect, it } from "bun:test";
import type { AgentControllerDisplayState } from "@mastra/core/agent-controller";
import type { ChatMessage, PendingInteraction } from "../shared/contracts";
import { findInteractionToolOutcome, parseSuspendedInteraction, projectPendingInteractions, projectTasks, projectionMessages, reconcileLiveAssistantTurn, submitPlanDecision, upsertChatMessage, type LiveAssistantProjection } from "./runtime-projection";

const displayState = (overrides: Partial<AgentControllerDisplayState> = {}): AgentControllerDisplayState => ({
  isRunning: true,
  currentMessage: null,
  queuedFollowUps: 0,
  tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  activeTools: new Map(),
  toolInputBuffers: new Map(),
  pendingApproval: null,
  pendingSuspensions: new Map(),
  activeSubagents: new Map(),
  omProgress: {} as AgentControllerDisplayState["omProgress"],
  bufferingMessages: false,
  bufferingObservations: false,
  modifiedFiles: new Map(),
  tasks: [],
  previousTasks: [],
  ...overrides,
});

const user = (id: string): ChatMessage => ({
  id,
  role: "user",
  text: "Help me",
  turnId: id,
  parts: [{ type: "text", id: `${id}:text:0`, text: "Help me" }],
  status: "complete",
  createdAt: "2026-08-03T12:00:00.000Z",
});
const assistant = (id: string, text: string, status: ChatMessage["status"] = "complete"): ChatMessage => ({
  id,
  role: "assistant",
  text,
  turnId: "user-1",
  parts: [{ type: "text", id: `${id}:text:0`, text }],
  status,
  createdAt: "2026-08-03T12:00:01.000Z",
});
const projection = (turnId: string, messages: ChatMessage[], outcome: ChatMessage["status"] | null = "complete"): LiveAssistantProjection => ({
  runId: `run-${turnId}`,
  threadId: "thread-1",
  turnId,
  runStartedAt: "2026-08-03T12:00:00.000Z",
  baselineAssistantIds: new Set(),
  messages: new Map(messages.map((message) => [message.id, message])),
  messageOrder: messages.map((message) => message.id),
  outcome,
});

describe("runtime display projection", () => {
  it("normalizes tool suspension payloads and preserves resolving interactions", () => {
    const question = parseSuspendedInteraction(
      {
        toolCallId: "ask-1",
        toolName: "ask_user",
        suspendPayload: { question: "Which route?", options: [{ label: "A" }] },
      },
      1,
    );
    expect(question).toMatchObject({
      kind: "ask_user",
      selectionMode: "single_select",
    });
    const existing: PendingInteraction = {
      id: "ask-1",
      toolCallId: "ask-1",
      kind: "ask_user",
      title: "Question",
      question: "Continue?",
      options: [],
      status: "resolving",
      createdAt: "2026-08-03T12:00:00.000Z",
    };
    expect(projectPendingInteractions(displayState(), [existing], 1)).toEqual([existing]);
  });

  it("projects task state and upserts streamed messages by id", () => {
    expect(
      projectTasks(
        displayState({
          tasks: [
            {
              id: "task-1",
              content: "Review",
              activeForm: "Reviewing",
              status: "in_progress",
            },
          ],
        }),
      ),
    ).toEqual([
      {
        id: "task-1",
        content: "Review",
        activeForm: "Reviewing",
        status: "in_progress",
      },
    ]);
    expect(upsertChatMessage([assistant("a", "Hi", "streaming")], assistant("a", "Hi there", "streaming"))).toEqual([assistant("a", "Hi there", "streaming")]);
  });

  it("keeps every assistant segment across a tool suspension while storage is partial", () => {
    const first = assistant("stream-before-tool", "I need your choice.");
    const resumed = assistant("stream-after-tool", "Thanks. Here is the completed answer.");
    const turn = projection("user-1", [first, resumed]);
    const partialPersisted = assistant("stored-assistant", "I need your choice.");

    const result = reconcileLiveAssistantTurn([user("user-1"), partialPersisted], turn, true);
    expect(result.settled).toBe(false);
    expect(result.messages).toEqual([user("user-1"), first, resumed]);
    expect(projectionMessages(turn)).toEqual([first, resumed]);
  });

  it("settles the full suspended/resumed turn when the final canonical row arrives with an older timestamp", () => {
    const first = assistant("stream-before-tool", "I need your choice.");
    const resumed = assistant("stream-after-tool", "Thanks. Here is the completed answer.");
    const finalPersisted = {
      ...resumed,
      id: "stored-assistant",
      createdAt: "2026-08-03T11:59:59.000Z",
    };

    const result = reconcileLiveAssistantTurn([user("user-1"), finalPersisted], projection("user-1", [first, resumed]), true);
    expect(result.settled).toBe(true);
    expect(result.persistedId).toBe("stored-assistant");
    expect(result.messages).toEqual([user("user-1"), finalPersisted]);
  });

  it("suppresses every persisted partial segment across multiple suspend/resume cycles", () => {
    const first = assistant("live-1", "First segment.");
    const second = assistant("live-2", "Second segment.");
    const final = assistant("live-3", "Final segment.");
    const storedFirst = { ...first, id: "stored-1" };
    const storedSecond = { ...second, id: "stored-2" };

    const result = reconcileLiveAssistantTurn([user("user-1"), storedFirst, storedSecond], projection("user-1", [first, second, final]), true);
    expect(result.settled).toBe(false);
    expect(result.messages).toEqual([user("user-1"), first, second, final]);
  });

  it("settles a steered turn against the new user signal, not the original turn", () => {
    const original = user("user-original");
    const steered = user("user-steered");
    const live = assistant("live-final", "Follow the new direction.");
    const stored = { ...live, id: "stored-final" };

    const result = reconcileLiveAssistantTurn([original, assistant("stored-partial", "Old direction."), steered, stored], projection("user-steered", [live]), true);
    expect(result.settled).toBe(true);
    expect(result.messages).toEqual([original, assistant("stored-partial", "Old direction."), steered, stored]);
  });

  it("never lets an identical answer from another user turn settle this turn", () => {
    const oldUser = user("user-old");
    const oldAnswer = assistant("stored-old", "Same answer.");
    const currentUser = user("user-current");
    const live = assistant("stream-current", "Same answer.");

    const result = reconcileLiveAssistantTurn([oldUser, oldAnswer, currentUser], projection("user-current", [live]), true);
    expect(result.settled).toBe(false);
    expect(result.messages).toEqual([oldUser, oldAnswer, currentUser, live]);
  });
});

describe("interaction terminal correlation", () => {
  const planInteraction: PendingInteraction = {
    id: "call-original",
    toolCallId: "call-original",
    kind: "submit_plan",
    title: "Test plan",
    options: [],
    status: "resolving",
    originMessageId: "user-1",
    createdAt: "2026-08-03T12:00:00.000Z",
  };
  const planToolMessage = (toolCallId: string, output: unknown, turnId = "user-1", status: "completed" | "declined" = "completed"): ChatMessage => ({
    ...assistant(`assistant-${toolCallId}`, ""),
    turnId,
    parts: [{ type: "tool", id: `tool-${toolCallId}`, toolCallId, name: "submit_plan", label: "Submit plan", status, output }],
  });

  it("accepts the trusted resumed plan result when Mastra replaces the tool-call ID", () => {
    const output = { content: "The user approved the plan. Continue with the approved work.", isError: false };
    expect(submitPlanDecision(output)).toBe("approved");
    expect(findInteractionToolOutcome([planToolMessage("call-resumed", output)], planInteraction, "approved")).toEqual({
      status: "completed",
      toolCallId: "call-resumed",
      decision: "approved",
    });
  });

  it("keeps an exact denial authoritative even if an aliased success is present", () => {
    const approved = { content: "The user approved the plan. Continue with the approved work.", isError: false };
    expect(findInteractionToolOutcome([
      planToolMessage("call-original", undefined, "user-1", "declined"),
      planToolMessage("call-resumed", approved),
    ], planInteraction, "approved")).toEqual({ status: "declined", toolCallId: "call-original" });
  });

  it("does not correlate a successful plan result from another user turn", () => {
    const approved = { content: "The user approved the plan. Continue with the approved work.", isError: false };
    expect(findInteractionToolOutcome([planToolMessage("call-resumed", approved, "user-other")], planInteraction, "approved")).toBeNull();
  });

  it("rejects lookalike output that does not match the trusted plan result contract", () => {
    expect(findInteractionToolOutcome([planToolMessage("call-resumed", { content: "Plan approved" })], planInteraction, "approved")).toBeNull();
  });
});
