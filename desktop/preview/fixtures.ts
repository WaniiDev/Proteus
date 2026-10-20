import { runtimeSnapshotSchema, type RuntimeSnapshot } from "../src/shared/contracts";

export const scenarios = ["empty", "thread", "recovery", "unconnected", "pinned", "max", "running", "ask", "approval", "ask-question", "ask-plan", "settings", "settings-rejected", "settings-checking", "settings-device", "projects", "long", "answer", "answer-stream", "answer-ready"] as const;
export type Scenario = (typeof scenarios)[number];

const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

type Input = Partial<RuntimeSnapshot>;
const parse = (input: Input): RuntimeSnapshot => runtimeSnapshotSchema.parse({ ...base, ...input });

const providers: RuntimeSnapshot["providers"] = [
  { id: "openrouter", name: "OpenRouter", configured: true, verified: true, availability: "ready" },
  { id: "codex", name: "Codex", configured: true, verified: true, availability: "ready" },
  { id: "anthropic", name: "Anthropic", configured: false, verified: false, availability: "needs-configuration" },
];

const models: RuntimeSnapshot["models"] = [
  { id: "openrouter/anthropic/claude-sonnet-5-5", providerId: "openrouter", rawId: "anthropic/claude-sonnet-5-5", name: "Sonnet 5.5", reasoningOptions: ["none", "low", "medium", "high", "max"], reasoningEffort: "medium", contextLength: 200_000, promptPrice: 0.000003, completionPrice: 0.000015, popularityRank: 1, useCount: 24, lastUsedAt: iso(30), inputModalities: ["text", "image"], outputModalities: ["text"], description: "Balanced speed and depth for everyday work" },
  { id: "openrouter/anthropic/claude-opus-5-5", providerId: "openrouter", rawId: "anthropic/claude-opus-5-5", name: "Opus 5.5", reasoningOptions: ["low", "medium", "high", "xhigh", "max"], reasoningEffort: "medium", contextLength: 200_000, promptPrice: 0.000015, completionPrice: 0.000075, popularityRank: 2, inputModalities: ["text", "image"], outputModalities: ["text"], description: "Deepest reasoning for long, careful work" },
  { id: "openrouter/anthropic/claude-haiku-5-5", providerId: "openrouter", rawId: "anthropic/claude-haiku-5-5", name: "Haiku 5.5", reasoningOptions: ["none", "low", "medium"], contextLength: 200_000, promptPrice: 0.0000008, completionPrice: 0.000004, popularityRank: 3, inputModalities: ["text"], outputModalities: ["text"], description: "Quick replies for light tasks" },
  { id: "codex/gpt-5-codex", providerId: "codex", rawId: "gpt-5-codex", name: "GPT-5 Codex", reasoningOptions: ["minimal", "low", "medium", "high", "xhigh"], reasoningEffort: "high", contextLength: 400_000, inputModalities: ["text"], outputModalities: ["text"], description: "Through your ChatGPT account" },
  { id: "anthropic/claude-opus-5-5", providerId: "anthropic", rawId: "claude-opus-5-5", name: "Claude Opus 5.5", contextLength: 200_000, inputModalities: ["text"], outputModalities: ["text"], description: "Most capable, for long and careful work" },
  { id: "anthropic/claude-sonnet-5-5", providerId: "anthropic", rawId: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", contextLength: 200_000, inputModalities: ["text"], outputModalities: ["text"], description: "Fast and capable for everyday work" },
  { id: "anthropic/claude-haiku-5-5", providerId: "anthropic", rawId: "claude-haiku-5-5", name: "Claude Haiku 5.5", contextLength: 200_000, inputModalities: ["text"], outputModalities: ["text"], description: "Quickest, for light tasks" },
];

const base = {
  revision: 1,
  status: "ready" as const,
  credential: { configured: true, verified: true },
  providerAuth: null,
  providers,
  models,
  selectedProviderId: "openrouter" as const,
  selectedModelId: "openrouter/anthropic/claude-sonnet-5-5" as const,
  selectedReasoningEffort: "medium" as const,
  projects: [],
  activeWorkspace: { binding: { kind: "app" as const }, label: "Proteus", availability: "ready" as const },
  threads: [],
  activeThreadId: null,
  retryMessageId: null,
  messages: [],
  events: [],
  interactions: [],
  workbench: { status: "idle" as const, tasks: [], pendingInteractions: [], queuedFollowUpCount: 0, tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
  activeRun: null,
  continuation: null,
  error: null,
};

const thread = (id: string, title: string, minutesAgo: number, extra: Partial<RuntimeSnapshot["threads"][number]> = {}) => ({
  id, title, createdAt: iso(minutesAgo + 5), updatedAt: iso(minutesAgo), activity: "idle" as const, attention: 0,
  workspace: { binding: { kind: "app" as const }, label: "Proteus workspace", availability: "ready" as const }, pinned: false, pinnedAt: null, ...extra,
});

const user = (id: string, text: string, minutesAgo: number): RuntimeSnapshot["messages"][number] => ({
  id, role: "user", text, status: "complete", createdAt: iso(minutesAgo), turnId: id, parts: [{ type: "text", id: `${id}:t`, text }],
});
const tool = (id: string, name: string, label: string, status: "running" | "completed" | "waiting" | "error", inputSummary: string, outputSummary?: string) => ({
  type: "tool" as const, id: `${id}:p`, toolCallId: id, name, label, status, inputSummary, input: name.endsWith("grep") ? { path: "notes/", pattern: inputSummary } : { path: inputSummary }, ...(outputSummary ? { outputSummary } : {}),
});
const assistant = (id: string, turnId: string, parts: RuntimeSnapshot["messages"][number]["parts"], minutesAgo: number, status: "complete" | "streaming" | "error" = "complete"): RuntimeSnapshot["messages"][number] => ({
  id, role: "assistant", status, createdAt: iso(minutesAgo), turnId: `turn-${turnId}`,
  text: parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n\n"), parts,
});


const protoThread = (id: string, title: string, minutesAgo: number, extra: Partial<RuntimeSnapshot["threads"][number]> = {}) => thread(id, title, minutesAgo, { workspace: { binding: { kind: "app" as const }, label: "Launch notes", availability: "ready" as const }, ...extra });
/** The prototype's sample sessions: Today holds the live one, Earlier holds the two past ones. */
const protoThreads = (active: "tidy" | "calendar" | "check" | "brief", activity: "idle" | "waiting" | "running" = "idle", liveTitle?: string) => {
  const live = active === "check" || active === "brief";
  return [
    ...(live ? [protoThread(active, liveTitle ?? (active === "brief" ? "Morning brief" : "Check the Q3 review notes"), 0, { activity, workspace: { binding: { kind: "app" as const }, label: "Proteus", availability: "ready" as const } })] : []),
    protoThread("tidy", "Tidy project notes", 2 * 24 * 60),
    protoThread("calendar", "Import calendar", 3 * 24 * 60, { activity: "error" as const }),
  ];
};

const protoProject = (id: string, name: string, rootPath: string, availability: "ready" | "missing", added: string, opened: string) => ({ id, name, rootPath, availability, createdAt: added, updatedAt: opened, lastOpenedAt: opened });
const protoProjects = [
  protoProject("p1", "Proteus", "C:\\Users\\you\\code\\Proteus", "ready", "2026-09-02T09:00:00.000Z", iso(20)),
  protoProject("p2", "Launch notes", "D:\\Notes\\launch", "ready", "2026-10-01T09:00:00.000Z", iso(1500)),
  protoProject("p3", "Archive 2025", "E:\\Archive\\2025", "missing", "2026-03-12T09:00:00.000Z", "2026-08-30T09:00:00.000Z"),
];
const protoWorkspace = { binding: { kind: "project" as const, projectId: "p1" }, label: "Proteus", availability: "ready" as const };
const launchWorkspace = { binding: { kind: "project" as const, projectId: "p2" }, label: "Launch notes", availability: "ready" as const };
const newChat = thread("new", "New chat", 0, { workspace: { binding: { kind: "app" as const }, label: "Proteus", availability: "ready" as const } });
const tidyMessages = (): RuntimeSnapshot["messages"] => [
  user("tm1", "Tidy the launch notes folder — merge duplicates and tell me what you changed.", 2 * 24 * 60),
  assistant("tm2", "tm1", [
    tool("tt1", "mastra_workspace_read_file", "Read file", "completed", "notes/ (14 files)"),
    tool("tt2", "mastra_workspace_edit_file", "Edit file", "completed", "notes/launch-faq.md", "merged 2 duplicates"),
    tool("tt3", "mastra_workspace_edit_file", "Edit file", "completed", "notes/index.md", "fixed 6 links"),
    { type: "text", id: "tm2:t", text: "Done. I merged the two FAQ drafts into notes/launch-faq.md and fixed the links in notes/index.md. I didn’t delete anything — the old drafts are still in notes/archive/." },
  ], 2 * 24 * 60 - 1),
];
const askTools = (scenario: string) => scenario === "ask-question"
  ? [tool("t1", "mastra_workspace_grep", "Search workspace", "completed", "Mai", "2 matches"), tool("t2", "mastra_workspace_read_file", "Read file", "completed", "notes/launch-thread.md")]
  : scenario === "ask-plan"
    ? [tool("t1", "mastra_workspace_read_file", "Read file", "completed", "docs/roadmap.md"), tool("t2", "mastra_workspace_grep", "Search workspace", "completed", "open tasks", "9 open tasks")]
    : [tool("t1", "mastra_workspace_read_file", "Read file", "completed", "docs/plan.md"), tool("t2", "mastra_workspace_grep", "Search workspace", "completed", "launch review", "4 matches"), tool("t3", "mastra_workspace_read_file", "Read file", "completed", "notes/2026-10-14-review.md"), tool("t4", "mastra_workspace_edit_file", "Edit file", "waiting", "docs/plan.md")];
const calendarMessages = (): RuntimeSnapshot["messages"] => [
  user("cm1", "Import my calendar export into the launch notes.", 3 * 24 * 60),
  assistant("cm2", "cm1", [tool("ct1", "mastra_workspace_read_file", "Read file", "completed", "exports/calendar.ics"), { ...tool("ct2", "mastra_workspace_read_file", "Read file", "error", "exports/calendar.ics", "the last event is cut off"), error: "the last event is cut off" }], 3 * 24 * 60 - 1, "error"),
];



const answerPart = (id: string, blocks: unknown[], streaming: boolean, title = "Your week", question = "What needs my attention this week?"): RuntimeSnapshot["messages"][number]["parts"][number] => ({
  type: "answer", id: `${id}:a`, toolCallId: id, answerId: id, title, question,
  blocks: blocks as never, streaming, outcomes: {},
});

const finishedAnswerBlocks = [
  { type: "headline", text: "Three things need you before Friday" },
  { type: "text", text: "The renewal is the only one with a hard deadline." },
  { type: "stats", items: [{ value: "3", label: "Open items", delta: "1 more than last week", dir: "up", spark: [2, 3, 3, 5, 6] }, { value: "2 h", label: "Focus time left", dir: "flat" }] },
  { type: "list", label: "To do", count: "2 of 3", rows: [
    { id: "r1", title: "Reply to the vendor about the renewal", sub: "Due Thursday", dot: "warn", act: { label: "Draft reply", intent: "reply", primary: true, done: "Drafted" } },
    { id: "r2", title: "Book the design review room", sub: "Tuesday afternoon", act: { label: "Open calendar", intent: "open", done: "Opened" } },
  ] },
  { type: "timeline", label: "Today", rows: [
    { id: "t1", title: "Stand-up", time: "9:30", past: true },
    { id: "t2", title: "Design review", time: "11:00", now: true },
    { id: "t3", title: "Deep work", time: "14:00" },
  ] },
  { type: "progress", label: "Quarter goals", items: [{ label: "Launch", now: 7, max: 10, value: "7 of 10" }, { label: "Budget", now: 9, max: 10, value: "90%", warn: true }] },
  { type: "table", label: "Options", cols: ["Plan", "Cost"], rows: [{ cells: ["Annual", "$480"], pick: true }, { cells: ["Monthly", "$55"] }] },
  { type: "bars", label: "Focus hours", aria: "Focus hours by day, Wednesday highest", bars: [["Mon", 4], ["Tue", 6], ["Wed", 9, true], ["Thu", 5]] },
  { type: "choice", id: "c1", label: "Which plan?", options: [{ id: "o1", title: "Annual", sub: "Saves $180", tag: "Best value" }, { id: "o2", title: "Monthly" }], confirm: { label: "Choose", done: "Chosen" } },
  { type: "quote", text: "Keep Friday light.", cite: "Your notes" },
  { type: "sources", items: ["notes/week.md", "Vendor email"] },
  { type: "suggest", items: ["Draft the reply", "Show next week"] },
];


const briefBlocks = [
  { type: "headline", text: "Three things need you. The plan date is the urgent one." },
  { type: "list", label: "Needs you", count: "3", rows: [
    { id: "n1", dot: "warn", title: "Edit docs/plan.md · beta date", sub: "Still says Sep 12; the review agreed Sep 26", act: { label: "Approve", intent: "approve", primary: true, done: "Approved" } },
    { id: "n2", title: "Mai · launch thread", sub: "Wants the new date confirmed by Thursday", act: { label: "Reply", intent: "reply", done: "Drafted" } },
    { id: "n3", title: "3 checklist items overdue", sub: "QA sign-off, release notes, screenshots", act: { label: "Open", intent: "open", done: "Opened" } },
  ] },
  { type: "list", label: "Handled overnight", count: "3", rows: [
    { id: "h1", tick: true, title: "Merged the two FAQ drafts", sub: "notes/launch-faq.md", time: "07:02" },
    { id: "h2", tick: true, title: "Filed the review notes", sub: "notes/2026-10-14-review.md", time: "07:03" },
    { id: "h3", tick: true, title: "Summarised the launch thread", sub: "notes/launch-thread.md", time: "07:05" },
  ] },
  { type: "stats", items: [{ value: "2", label: "meetings today" }, { value: "14", label: "things I learned this week" }] },
  { type: "sources", items: ["calendar.ics", "docs/plan.md", "notes/"] },
  { type: "suggest", items: ["What does my day look like?", "Is the launch on track?", "Compare the three launch options"] },
];
const briefTurn = (streaming: boolean, count: number) => [
  user("b1", "What needs me this morning?", 2),
  assistant("b2", "b1", [
    tool("bt1", "mastra_workspace_read_file", "Read file", "completed", "calendar.ics", "2 events today"),
    tool("bt2", "mastra_workspace_grep", "Search workspace", "completed", "approvals/", "1 waiting"),
    tool("bt3", "mastra_workspace_read_file", "Read file", "completed", "notes/launch-thread.md"),
    answerPart("a1", briefBlocks.slice(0, count), streaming, "Morning brief", "What needs me this morning?"),
  ], 1, streaming ? "streaming" : "complete"),
];

export function buildFixture(scenario: Scenario): RuntimeSnapshot {
  switch (scenario) {
    case "empty":
      return parse({ projects: protoProjects, activeWorkspace: protoWorkspace, threads: [newChat, ...protoThreads("tidy")], activeThreadId: "new" });
    case "thread":
      return parse({ threads: protoThreads("tidy"), activeThreadId: "tidy", messages: tidyMessages() });
    case "recovery":
      return parse({
        threads: protoThreads("calendar"), activeThreadId: "calendar", messages: calendarMessages(),
        error: { code: "unknown", message: "The calendar file ends partway through an event, so I couldn’t convert it. Nothing was imported or changed.", retryable: true },
        retryMessageId: "cm2",
      });
    case "unconnected":
      return parse({
        status: "needs-key", credential: { configured: false, verified: false },
        providers: [{ id: "openrouter", name: "OpenRouter", configured: false, verified: false, availability: "needs-configuration" }, providers[1]!, providers[2]!],
        threads: [newChat, ...protoThreads("tidy")], activeThreadId: "new", projects: protoProjects, activeWorkspace: protoWorkspace,
      });
    case "pinned":
      return parse({ threads: protoThreads("tidy").map((item) => (item.id === "tidy" ? { ...item, pinned: true, pinnedAt: iso(60) } : item)), activeThreadId: "tidy", messages: tidyMessages() });
    case "max":
      return parse({ projects: protoProjects, threads: [newChat, ...protoThreads("tidy")], activeThreadId: "new", activeWorkspace: protoWorkspace, selectedReasoningEffort: "max" });
    case "running": {
      const messages = [
        user("m1", "Check the Q3 review notes", 1),
        assistant("m2", "m1", [
          tool("t1", "mastra_workspace_read_file", "Read file", "completed", "docs/plan.md"),
          tool("t2", "mastra_workspace_grep", "Search workspace", "completed", "launch review", "4 matches"),
          tool("t3", "mastra_workspace_read_file", "Read file", "running", "notes/2026-10-14-review.md"),
        ], 1, "streaming"),
      ];
      return parse({
        threads: protoThreads("check"), activeThreadId: "check", messages,
        status: "running", activeRun: { runId: "run1", threadId: "check", status: "running" },
        workbench: { ...base.workbench, status: "active", tokenUsage: { promptTokens: 4000, completionTokens: 900, totalTokens: 4900 } },
      });
    }
    case "approval":
    case "ask-question":
    case "ask-plan": {
      const approval: RuntimeSnapshot["interactions"][number] = { id: "i1", toolCallId: "t4", threadId: "check", runId: "run1", kind: "tool_approval", title: "Edit docs/plan.md", toolName: "mastra_workspace_edit_file", args: { path: "docs/plan.md", old_string: "Beta: 2026-09-12", new_string: "Beta: 2026-09-26" }, argsSummary: "docs/plan.md (1 line changed)", fingerprint: "fp-1", policyVersion: 1, options: [], status: "pending", createdAt: iso(1) };
      const question: RuntimeSnapshot["interactions"][number] = { id: "i2", toolCallId: "t5", threadId: "check", runId: "run1", kind: "ask_user", title: "Who should the reply go to?", question: "Who should the reply go to?", options: [{ label: "Mai only", description: "She asked the question." }, { label: "The launch channel", description: "Everyone in the review sees it." }], selectionMode: "single_select", status: "pending", createdAt: iso(1) };
      const plan: RuntimeSnapshot["interactions"][number] = { id: "i3", toolCallId: "t6", threadId: "check", runId: "run1", kind: "submit_plan", title: "Launch week plan", options: [], plan: { version: 1, title: "Launch week plan", summary: "Five days, one focus each. Nothing is scheduled until you approve.", steps: ["Monday — freeze scope and tag the release candidate", "Tuesday — QA on Windows and macOS", "Wednesday — fix blockers only", "Thursday — release notes, held for your review", "Friday — ship the beta and watch for reports"], status: "draft" }, status: "pending", createdAt: iso(1) };
      const interactions = scenario === "ask-question" ? [question] : scenario === "ask-plan" ? [plan] : [approval];
      const said = scenario === "ask-question" ? "Mai asked in the launch thread, so either works." : scenario === "ask-plan" ? "Here’s how I’d shape launch week. Nothing is scheduled until you approve it." : "Mostly, yes. Two things changed since the review: the beta moved from September 12 to September 26, and Windows ARM support was dropped from scope.";
      return parse({
        threads: protoThreads("check", "waiting", scenario === "ask-question" ? "Reply to Mai" : scenario === "ask-plan" ? "Launch week plan" : undefined), activeThreadId: "check",
        messages: [user("m1", scenario === "ask-question" ? "Draft a reply to Mai" : scenario === "ask-plan" ? "Plan launch week" : "Check the Q3 review notes", 3), assistant("m2", "m1", [...askTools(scenario), { type: "text", id: "m2:t", text: said }], 2, "streaming")],
        status: "running", activeRun: { runId: "run1", threadId: "check", status: "running" }, interactions,
        workbench: { ...base.workbench, status: "waiting", pendingInteractions: interactions },
      });
    }
    case "settings":
      return parse({
        providers: [providers[0]!, { id: "codex", name: "Codex", configured: false, verified: false, availability: "needs-configuration", detail: "Sign in with your ChatGPT account" }, providers[2]!],
        threads: protoThreads("tidy"), activeThreadId: "tidy", messages: tidyMessages(),
      });
    case "settings-rejected":
      return parse({
        status: "needs-key", credential: { configured: true, verified: false },
        providers: [{ id: "openrouter", name: "OpenRouter", configured: true, verified: false, availability: "needs-configuration" }, providers[1]!, providers[2]!],
        error: { code: "invalid-credential", message: "OpenRouter rejected that key. Check it and try again.", retryable: false },
        threads: protoThreads("tidy"), activeThreadId: "tidy", messages: tidyMessages(),
      });
    case "settings-checking":
      return parse({
        status: "validating-key", credential: { configured: false, verified: false },
        providers: [{ id: "openrouter", name: "OpenRouter", configured: false, verified: false, availability: "needs-configuration" }, providers[1]!, providers[2]!],
        threads: protoThreads("tidy"), activeThreadId: "tidy", messages: tidyMessages(),
      });
    case "settings-device":
      return parse({
        providers: [providers[0]!, { id: "codex", name: "Codex", configured: false, verified: false, availability: "checking" }, providers[2]!],
        providerAuth: { providerId: "codex", mode: "device", status: "waiting", url: "https://auth.example.com/device", instructions: "Open the page and enter this code.", code: "QX7K-4MPD" },
        selectedProviderId: "codex", selectedModelId: "codex/gpt-5-codex",
        threads: protoThreads("tidy"), activeThreadId: "tidy", messages: tidyMessages(),
      });
    case "projects":
      return parse({
        projects: protoProjects,
        threads: protoThreads("tidy").map((item) => ({ ...item, workspace: launchWorkspace })),
        activeThreadId: "tidy", messages: tidyMessages(),
      });
    case "answer-stream":
      return parse({
        threads: protoThreads("brief", "running"), activeThreadId: "brief", messages: briefTurn(true, 3),
        status: "running", activeRun: { runId: "run1", threadId: "brief", status: "running" },
      });
    case "answer-ready":
      return parse({ threads: protoThreads("brief"), activeThreadId: "brief", messages: briefTurn(false, briefBlocks.length) });
    case "ask": {
      const interactions: RuntimeSnapshot["interactions"] = [
        { id: "i1", toolCallId: "t3", threadId: "th1", runId: "run1", kind: "tool_approval", title: "Allow mastra_workspace_edit_file?", toolName: "mastra_workspace_edit_file", args: { path: "src/index.test.ts", old_string: "expect(total).toBe(41);", new_string: "expect(total).toBe(42);" }, argsSummary: "src/index.test.ts (1 line changed)", fingerprint: "fp-1", policyVersion: 1, options: [], status: "pending", createdAt: iso(1) },
        { id: "i2", toolCallId: "t4", threadId: "th1", runId: "run1", kind: "ask_user", title: "A question from Proteus", question: "Which environment should the tests run against?", options: [{ label: "Local", description: "Use the in-memory database" }, { label: "Staging", description: "Use the shared staging server" }], selectionMode: "single_select", status: "pending", createdAt: iso(1) },
      ];
      return parse({
        threads: [thread("th1", "Fix failing test", 1, { activity: "waiting", attention: 2 })], activeThreadId: "th1",
        messages: [user("m1", "Fix the failing test please.", 3), assistant("m2", "m1", [tool("t3", "mastra_workspace_edit_file", "Edit file", "waiting", "src/index.test.ts"), { type: "text", id: "m2:t", text: "I need your approval before I change the test." }], 2, "streaming")],
        status: "running", activeRun: { runId: "run1", threadId: "th1", status: "running" }, interactions,
        workbench: { ...base.workbench, status: "waiting", pendingInteractions: interactions },
      });
    }
    case "answer":
      return parse({
        threads: [thread("th1", "Your week", 2), thread("th2", "Weekly plan", 200)], activeThreadId: "th1",
        messages: [
          user("m1", "What needs my attention this week?", 6),
          assistant("m2", "m1", [tool("t1", "mastra_workspace_read_file", "Read file", "completed", "notes/week.md", "42 lines"), answerPart("a1", finishedAnswerBlocks, false)], 5),
          user("m3", "And what is left today?", 2),
          assistant("m4", "m3", [answerPart("a2", finishedAnswerBlocks.slice(0, 4).map((block, index) => (index === 3 ? { ...(block as object), rows: [(block as { rows: unknown[] }).rows[0]] } : block)), true)], 1, "streaming"),
        ],
        status: "running", activeRun: { runId: "run1", threadId: "th1", status: "running" },
      });
    case "long": {
      const longTitle = "Investigate the intermittent failure in the nightly synchronisation job that only appears when the network is slow";
      const titles = [longTitle, "Q3 planning", "Reading list", "Refactor the settings screen", "Holiday itinerary for Lisbon and Porto", "Budget spreadsheet cleanup", "Draft reply to landlord", "Explain the borrow checker", "Meal prep ideas", "Review pull request 482", "Quarterly goals", "Gift ideas", "Learning Spanish plan", "Home network audit"];
      const threads = titles.map((title, index) => thread(`th${index}`, title, index * 400 + 10, index === 2 || index === 5 ? { pinned: true, pinnedAt: iso(index) } : index === 3 ? { activity: "complete" as const } : index === 7 ? { activity: "error" as const, attention: 1 } : {}));
      const longText = "This is a deliberately long paragraph to check wrapping. ".repeat(40).trim();
      const unbroken = "https://example.com/" + "a-very-long-unbroken-path-segment".repeat(6);
      return parse({
        threads, activeThreadId: "th0",
        messages: [
          user("m1", `${longTitle}. ${longText}`, 30),
          assistant("m2", "m1", [
            tool("t1", "mastra_workspace_read_file", "Read file", "completed", "src/very/deeply/nested/directory/structure/with/a/long/file-name-that-keeps-going-and-going.ts", "2,400 lines"),
            { type: "text", id: "m2:t", text: `${longText}\n\n${unbroken}\n\n\`\`\`\n${"const reallyLongLine = " + "'x'.repeat(10) + ".repeat(12) + "'end';"}\n\`\`\`` },
          ], 29),
        ],
      });
    }
  }
}
