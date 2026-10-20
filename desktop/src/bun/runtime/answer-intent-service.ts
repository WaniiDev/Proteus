import { z } from "zod";
import { ANSWER_INTENTS, compositionIssues, isSafeDiffPath, validateBlock, type CheckedBlock, type AnswerBlock, type AnswerRow } from "../../shared/answer-catalog";
import type { AnswerIntentParams, AnswerIntentResult, ChatAnswerPart } from "../../shared/contracts";
import type { RuntimeDiagnostics } from "../core/diagnostics";
import { ANSWER_INTENT_GATES, answerWriteFingerprint } from "../tools/approval-policy";
import type { WorkspaceRegistry } from "../workspace/workspace-registry";
import type { RuntimeContext } from "./context";
import type { ThreadService } from "./thread-service";

const paramsSchema = z.object({
  threadId: z.string().min(1),
  answerId: z.string().min(1),
  blockId: z.string().optional(),
  rowId: z.string().min(1).optional(),
  intent: z.enum(ANSWER_INTENTS),
  optionId: z.string().min(1).optional(),
}).strict();

/** The runtime's own message for a file that moved on since it was read (WorkspaceRegistry.write). */
export const STALE_FILE_MESSAGE = "File changed outside Proteus; refresh before saving";
const NOT_ALLOWED = "That action is not available for this answer.";
const SKIPPED = "Not now · unchanged";

type Target =
  | { kind: "row"; key: string; row: AnswerRow }
  | { kind: "choice"; key: string; block: Extract<AnswerBlock, { type: "choice" }> }
  | { kind: "diff"; key: string; block: Extract<AnswerBlock, { type: "diff" }> };

type Deps = {
  threads: Pick<ThreadService, "stateFor" | "updateThreadState" | "persistThreadState">;
  workspaceRegistry: Pick<WorkspaceRegistry, "read" | "write">;
  workspaces: { selectedWorkspaceRoot(): Promise<string> };
  runs: { send(text: string): Promise<{ runId: string }> };
  diagnostics: Pick<RuntimeDiagnostics, "record">;
};

const refuse = (message = NOT_ALLOWED, code: "refused" | "already-done" | "stale" | "failed" = "refused"): AnswerIntentResult => ({ accepted: false, code, message });

/** A workspace-relative file path cited by a row (its sub line, else its title); anything else is not a file. */
function citedPath(row: AnswerRow): string | undefined {
  for (const text of [row.sub, row.title]) {
    const token = text?.split(/\s+/).find((word) => /^[\w.@~-]+(?:[\\/][\w.@~ -]+)*\.[A-Za-z0-9]{1,8}$/.test(word) || /^[\w.@-]+(?:\/[\w.@-]+)+$/.test(word));
    if (token) return token.replaceAll("\\", "/");
  }
  return undefined;
}

/** Edit a file's lines exactly as a diff block shows them, or null when the file no longer matches what was shown. */
export function applyShownLines(content: string, lines: ReadonlyArray<{ n?: string; text: string; del?: boolean; ins?: boolean }>): string | null {
  const file = content.split("\n");
  const before = lines.filter((line) => !line.ins).map((line) => line.text);
  const after = lines.filter((line) => !line.del).map((line) => line.text);
  const first = lines[0]?.n === undefined ? NaN : Number.parseInt(lines[0].n, 10);
  const anchored = Number.isInteger(first) && first >= 1 && /^\d+$/.test(lines[0]!.n!.trim());
  const at: number[] = [];
  if (before.length === 0) {
    // A pure insertion needs its line number: without it there is nowhere exact to put it.
    if (!anchored || first - 1 > file.length) return null;
    at.push(first - 1);
  } else if (anchored) {
    if (before.every((text, i) => file[first - 1 + i] === text)) at.push(first - 1);
  } else {
    for (let i = 0; i + before.length <= file.length; i += 1) if (before.every((text, j) => file[i + j] === text)) at.push(i);
  }
  if (at.length !== 1) return null;
  return [...file.slice(0, at[0]), ...after, ...file.slice(at[0]! + before.length)].join("\n");
}

/**
 * `chat.answer.intent`: the only way an answer acts (ADR 0003 > Intents and safety). Intents are a closed set mapped to
 * fixed runtime operations; the renderer names a row or block and the service reads everything else (path, lines, option text)
 * from the stored answer, never from the request. Each row or block runs at most once; the outcome is stored in the thread metadata.
 */
export class AnswerIntentService {
  private readonly inFlight = new Set<string>();

  constructor(private readonly ctx: RuntimeContext, private readonly deps: Deps) {}

  async run(raw: AnswerIntentParams): Promise<AnswerIntentResult> {
    const parsed = paramsSchema.safeParse(raw);
    if (!parsed.success) return refuse();
    const params = parsed.data;
    if (params.threadId !== this.ctx.selectedThreadId) return refuse("Open that conversation first.");
    const answer = this.findAnswer(params.answerId);
    if (!answer || answer.streaming) return refuse();
    const target = this.findTarget(answer, params);
    if (!target) return refuse();

    const lock = `${params.threadId}:${params.answerId}:${target.key}`;
    const done = this.deps.threads.stateFor(params.threadId).answerOutcomes?.[params.answerId]?.[target.key];
    if (done || this.inFlight.has(lock)) return refuse(done ? `Already done · ${done}` : "That action is already running.", "already-done");
    this.inFlight.add(lock);
    this.deps.diagnostics.record({ source: "runtime", type: "answer.intent", phase: "start", threadId: params.threadId, toolCallId: params.answerId, payload: { intent: params.intent, key: target.key, gate: ANSWER_INTENT_GATES[params.intent] } });
    try {
      const result = await this.execute(target, params);
      if (result.accepted) await this.record(params.threadId, params.answerId, target.key, result.outcome);
      this.deps.diagnostics.record({ source: "runtime", type: "answer.intent", phase: result.accepted ? "end" : "refused", threadId: params.threadId, toolCallId: params.answerId, payload: { intent: params.intent, key: target.key, outcome: result.accepted ? result.outcome : result.code } });
      return result;
    } catch (error) {
      this.deps.diagnostics.record({ source: "runtime", type: "answer.intent", phase: "error", threadId: params.threadId, toolCallId: params.answerId, payload: error });
      return refuse(error instanceof Error && error.message ? error.message : "That action could not be completed.", "failed");
    } finally {
      this.inFlight.delete(lock);
    }
  }

  private findAnswer(answerId: string): ChatAnswerPart | undefined {
    for (const message of this.ctx.snapshot.messages) {
      if (message.role !== "assistant") continue;
      const part = message.parts.find((candidate): candidate is ChatAnswerPart => candidate.type === "answer" && candidate.answerId === answerId);
      if (part) return part;
    }
    return undefined;
  }

  /** The row or block the request names, and only when the answer really offers this intent on it. */
  private findTarget(answer: ChatAnswerPart, params: z.infer<typeof paramsSchema>): Target | undefined {
    // Only an answer the tool confirmed as shown can act, and only when it still passes its composition rules (the call can be
    // acted on between its input chunk and a rejecting result, or after a reload of a stored call that never got a result).
    if (answer.confirmed !== true) return undefined;
    const checked: CheckedBlock[] = answer.blocks.map((block) => (block.type === "fallback" ? block : validateBlock(block).ok ? (block as AnswerBlock) : { type: "fallback" as const }));
    if (compositionIssues(checked).length > 0) return undefined;
    const blocks = checked.filter((block): block is AnswerBlock => block.type !== "fallback");
    if (params.rowId) {
      const rows = blocks.flatMap((block) => (block.type === "list" || block.type === "timeline" ? (block.rows as AnswerRow[]) : [])).filter((row) => row.id === params.rowId);
      const row = rows[0];
      // An id that matches two rows is ambiguous, so it is refused rather than guessed.
      if (rows.length !== 1 || !row?.act || row.act.intent !== params.intent || !["open", "reply", "approve", "skip"].includes(params.intent)) return undefined;
      return { kind: "row", key: row.id, row };
    }
    const matches = blocks.filter((block) => (block.type === "choice" || block.type === "diff") && block.id === params.blockId);
    const block = matches[0];
    if (matches.length !== 1) return undefined;
    if (block?.type === "choice" && params.intent === "choose" && block.options.some((option) => option.id === params.optionId)) return { kind: "choice", key: block.id, block };
    if (block?.type === "diff" && (params.intent === "approve" || params.intent === "skip")) return { kind: "diff", key: block.id, block };
    return undefined;
  }

  private async execute(target: Target, params: z.infer<typeof paramsSchema>): Promise<AnswerIntentResult> {
    switch (params.intent) {
      case "skip":
        return { accepted: true, outcome: SKIPPED };
      case "reply":
        // A draft for the composer: nothing is sent until the person presses Send.
        return target.kind === "row" ? { accepted: true, outcome: "Drafted", draft: target.row.title } : refuse();
      case "open": {
        if (target.kind !== "row") return refuse();
        const path = citedPath(target.row);
        if (!path) return refuse("This row does not cite a file in the workspace.");
        // Read-only and contained: the registry resolves symlinks and rejects anything outside the workspace root.
        const view = await this.deps.workspaceRegistry.read(await this.deps.workspaces.selectedWorkspaceRoot(), path, 1, 1);
        return { accepted: true, outcome: "Opened", open: { path: view.path } };
      }
      case "choose": {
        if (target.kind !== "choice") return refuse();
        const option = target.block.options.find((candidate) => candidate.id === params.optionId);
        if (!option) return refuse();
        // The person's own answer, through the normal send path. It starts a turn; any write that turn proposes goes through its own approval.
        await this.deps.runs.send(option.title);
        return { accepted: true, outcome: `Chosen · ${option.title}` };
      }
      case "approve":
        return target.kind === "diff" ? this.applyDiff(target.block) : target.kind === "row" ? this.approveRow(target.row) : refuse();
    }
  }

  /**
   * A row proposes an action in words, not a concrete write, so approving it tells the agent as the person's reply. The agent
   * then works through its own tools, where every write is approval-gated (ADR 0001). The answer itself writes nothing here.
   */
  private async approveRow(row: AnswerRow): Promise<AnswerIntentResult> {
    await this.deps.runs.send(`Approved: ${row.title}`);
    return { accepted: true, outcome: "Approved" };
  }

  /**
   * The one write an answer can cause. It is the person's click on the exact lines the diff shows; the lines come from the stored
   * answer, the path is contained by the workspace registry, and the file must still hold the shown lines at that place and be
   * unchanged between read and write (expectedVersion). Otherwise nothing is written.
   */
  private async applyDiff(block: Extract<AnswerBlock, { type: "diff" }>): Promise<AnswerIntentResult> {
    // Defence in depth: the path written is the path shown, exactly (no traversal, no normalisation, no VCS metadata).
    if (!isSafeDiffPath(block.file)) return refuse("This file cannot be changed from an answer.");
    const root = await this.deps.workspaces.selectedWorkspaceRoot();
    const view = await this.deps.workspaceRegistry.read(root, block.file, 1, Number.MAX_SAFE_INTEGER);
    if (view.kind !== "text" || view.truncated || view.content === undefined) return refuse("Only a text file can be changed from an answer.");
    // A CRLF or BOM file would be rewritten differently from what was shown, so it is left alone.
    if (Buffer.byteLength(view.content, "utf8") !== view.size) return refuse("This file cannot be changed safely from an answer.");
    const next = applyShownLines(view.content, block.lines);
    if (next === null) return refuse(STALE_FILE_MESSAGE, "stale");
    this.deps.diagnostics.record({ source: "runtime", type: "answer.approve", phase: "write", payload: { fingerprint: answerWriteFingerprint(block.file, block.lines), file: view.path } });
    try {
      await this.deps.workspaceRegistry.write(root, view.path, next, view.version);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return message === STALE_FILE_MESSAGE ? refuse(STALE_FILE_MESSAGE, "stale") : refuse(message || "The change could not be applied.", "failed");
    }
    return { accepted: true, outcome: "Approved" };
  }

  private async record(threadId: string, answerId: string, key: string, outcome: string): Promise<void> {
    const next = this.deps.threads.updateThreadState(threadId, (state) => ({
      ...state,
      answerOutcomes: { ...state.answerOutcomes, [answerId]: { ...state.answerOutcomes?.[answerId], [key]: outcome } },
    }));
    // Publish first: the person sees the outcome even if the metadata write fails (the in-memory record still blocks a second run).
    this.ctx.publish({ messages: this.ctx.snapshot.messages });
    await this.deps.threads.persistThreadState(threadId, next, true).catch((error) => this.ctx.reportError(error));
  }
}
