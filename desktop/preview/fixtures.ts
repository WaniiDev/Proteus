import { runtimeSnapshotSchema, type RuntimeSnapshot } from "../src/shared/contracts";

export const scenarios = ["empty", "thread", "running", "ask", "settings", "projects", "long", "answer"] as const;
export type Scenario = (typeof scenarios)[number];

const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

type Input = Partial<RuntimeSnapshot>;
const parse = (input: Input): RuntimeSnapshot => runtimeSnapshotSchema.parse({ ...base, ...input });

const providers: RuntimeSnapshot["providers"] = [
  { id: "openrouter", name: "OpenRouter", configured: true, verified: true, availability: "ready" },
  { id: "codex", name: "Codex", configured: true, verified: true, availability: "ready" },
];

const models: RuntimeSnapshot["models"] = [
  { id: "openrouter/auto", providerId: "openrouter", rawId: "auto", name: "Auto Router", inputModalities: ["text"], outputModalities: ["text"], contextLength: 200_000 },
  { id: "openrouter/anthropic/claude-sonnet", providerId: "openrouter", rawId: "anthropic/claude-sonnet", name: "Claude Sonnet", reasoningOptions: ["none", "low", "medium", "high"], reasoningEffort: "medium", contextLength: 200_000, promptPrice: 0.000003, completionPrice: 0.000015, popularityRank: 1, useCount: 24, lastUsedAt: iso(30), inputModalities: ["text", "image"], outputModalities: ["text"], description: "Balanced model for everyday work." },
  { id: "openrouter/openai/gpt-mini", providerId: "openrouter", rawId: "openai/gpt-mini", name: "GPT Mini", reasoningOptions: ["minimal", "low", "medium", "high"], contextLength: 128_000, promptPrice: 0.0000004, completionPrice: 0.0000016, popularityRank: 2, inputModalities: ["text"], outputModalities: ["text"] },
  { id: "openrouter/google/gemini-flash", providerId: "openrouter", rawId: "google/gemini-flash", name: "Gemini Flash", contextLength: 1_000_000, popularityRank: 3, inputModalities: ["text", "image"], outputModalities: ["text"] },
  { id: "codex/gpt-codex", providerId: "codex", rawId: "gpt-codex", name: "GPT Codex", reasoningOptions: ["low", "medium", "high", "xhigh"], reasoningEffort: "high", contextLength: 400_000, inputModalities: ["text"], outputModalities: ["text"] },
];

const base = {
  revision: 1,
  status: "ready" as const,
  credential: { configured: true, verified: true },
  providerAuth: null,
  providers,
  models,
  selectedProviderId: "openrouter" as const,
  selectedModelId: "openrouter/anthropic/claude-sonnet" as const,
  selectedReasoningEffort: "medium" as const,
  projects: [],
  activeWorkspace: { binding: { kind: "app" as const }, label: "Proteus workspace", availability: "ready" as const },
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
  workspace: { binding: { kind: "app" as const }, label: "Proteus workspace", availability: "ready" as const }, ...extra,
});

const user = (id: string, text: string, minutesAgo: number): RuntimeSnapshot["messages"][number] => ({
  id, role: "user", text, status: "complete", createdAt: iso(minutesAgo), turnId: id, parts: [{ type: "text", id: `${id}:t`, text }],
});
const tool = (id: string, name: string, label: string, status: "running" | "completed" | "waiting", inputSummary: string, outputSummary?: string) => ({
  type: "tool" as const, id: `${id}:p`, toolCallId: id, name, label, status, inputSummary, ...(outputSummary ? { outputSummary } : {}),
});
const assistant = (id: string, turnId: string, parts: RuntimeSnapshot["messages"][number]["parts"], minutesAgo: number, status: "complete" | "streaming" = "complete"): RuntimeSnapshot["messages"][number] => ({
  id, role: "assistant", status, createdAt: iso(minutesAgo), turnId,
  text: parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n\n"), parts,
});

const markdownReply = `Here is a short plan for the week.

## Priorities

1. Finish the **design review** notes
2. Reply to the vendor about the *renewal*
3. Block two hours for deep work

| Day | Focus |
| --- | --- |
| Mon | Review |
| Wed | Deep work |

\`\`\`ts
const focus = days.filter((day) => day.free);
\`\`\`

> Keep Friday light.`;

const threadMessages = (): RuntimeSnapshot["messages"] => [
  user("m1", "Can you read my notes and draft a plan for the week?", 12),
  assistant("m2", "m1", [
    tool("t1", "workspace_read", "Read file", "completed", "notes/week.md", "42 lines"),
    tool("t2", "workspace_search", "Search workspace", "completed", "renewal", "3 results"),
    { type: "text", id: "m2:t", text: markdownReply },
  ], 11),
];

const answerPart = (id: string, blocks: unknown[], streaming: boolean): RuntimeSnapshot["messages"][number]["parts"][number] => ({
  type: "answer", id: `${id}:a`, toolCallId: id, answerId: id, title: "Your week", question: "What needs my attention this week?",
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

export function buildFixture(scenario: Scenario): RuntimeSnapshot {
  switch (scenario) {
    case "empty":
      return parse({});
    case "thread":
      return parse({ threads: [thread("th1", "Weekly plan", 11), thread("th2", "Trip ideas", 300)], activeThreadId: "th1", messages: threadMessages(), workbench: { ...base.workbench, tokenUsage: { promptTokens: 1200, completionTokens: 480, totalTokens: 1680 } } });
    case "running": {
      const messages = [
        user("m1", "Summarise the files in my project and fix the failing test.", 2),
        assistant("m2", "m1", [
          { type: "text", id: "m2:t0", text: "I will start by looking at the project layout." },
          tool("t1", "workspace_tree", "List files", "completed", "src", "18 entries"),
          tool("t2", "workspace_read", "Read file", "completed", "src/index.ts", "120 lines"),
          tool("t3", "workspace_write", "Edit file", "running", "src/index.test.ts"),
        ], 1, "streaming"),
      ];
      return parse({
        threads: [thread("th1", "Fix failing test", 1, { activity: "running" }), thread("th2", "Weekly plan", 200)], activeThreadId: "th1", messages,
        status: "running", activeRun: { runId: "run1", threadId: "th1", status: "running" },
        workbench: { ...base.workbench, status: "active", goal: "Fix the failing test", tasks: [
          { id: "k1", content: "Read the project", activeForm: "Reading the project", status: "completed" },
          { id: "k2", content: "Fix the test", activeForm: "Fixing the test", status: "in_progress" },
          { id: "k3", content: "Run the suite", activeForm: "Running the suite", status: "pending" },
        ], tokenUsage: { promptTokens: 4000, completionTokens: 900, totalTokens: 4900 } },
      });
    }
    case "ask": {
      const interactions: RuntimeSnapshot["interactions"] = [
        { id: "i1", toolCallId: "t3", threadId: "th1", runId: "run1", kind: "tool_approval", title: "Allow editing a file?", toolName: "workspace_write", argsSummary: "src/index.test.ts (12 lines changed)", fingerprint: "fp-1", policyVersion: 1, options: [], status: "pending", createdAt: iso(1) },
        { id: "i2", toolCallId: "t4", threadId: "th1", runId: "run1", kind: "ask_user", title: "A question from Proteus", question: "Which environment should the tests run against?", options: [{ label: "Local", description: "Use the in-memory database" }, { label: "Staging", description: "Use the shared staging server" }], selectionMode: "single_select", status: "pending", createdAt: iso(1) },
      ];
      return parse({
        threads: [thread("th1", "Fix failing test", 1, { activity: "waiting", attention: 2 })], activeThreadId: "th1",
        messages: [user("m1", "Fix the failing test please.", 3), assistant("m2", "m1", [tool("t3", "workspace_write", "Edit file", "waiting", "src/index.test.ts"), { type: "text", id: "m2:t", text: "I need your approval before I change the test." }], 2, "streaming")],
        status: "running", activeRun: { runId: "run1", threadId: "th1", status: "running" }, interactions,
        workbench: { ...base.workbench, status: "waiting", pendingInteractions: interactions },
      });
    }
    case "settings":
      return parse({
        providers: [providers[0]!, { id: "codex", name: "Codex", configured: false, verified: false, availability: "needs-configuration", detail: "Sign in with your ChatGPT account" }],
        threads: [thread("th1", "Weekly plan", 11)], activeThreadId: "th1", messages: threadMessages(),
      });
    case "projects": {
      const project = (id: string, name: string, availability: "ready" | "missing", minutesAgo: number) => ({ id, name, rootPath: `/home/user/${name.toLowerCase().replace(/ /g, "-")}`, availability, createdAt: iso(5000), updatedAt: iso(minutesAgo), lastOpenedAt: iso(minutesAgo) });
      const projectWorkspace = { binding: { kind: "project" as const, projectId: "p1" }, label: "Website redesign", availability: "ready" as const };
      return parse({
        projects: [project("p1", "Website redesign", "ready", 20), project("p2", "Tax documents", "ready", 4000), project("p3", "Old experiments", "missing", 20000)],
        threads: [thread("th1", "Homepage copy", 20, { workspace: projectWorkspace }), thread("th2", "Colour palette", 90, { workspace: projectWorkspace }), thread("th3", "Weekly plan", 300)],
        activeThreadId: "th3", messages: threadMessages(),
      });
    }
    case "answer":
      return parse({
        threads: [thread("th1", "Your week", 2), thread("th2", "Weekly plan", 200)], activeThreadId: "th1",
        messages: [
          user("m1", "What needs my attention this week?", 6),
          assistant("m2", "m1", [tool("t1", "workspace_read", "Read file", "completed", "notes/week.md", "42 lines"), answerPart("a1", finishedAnswerBlocks, false)], 5),
          user("m3", "And what is left today?", 2),
          assistant("m4", "m3", [answerPart("a2", finishedAnswerBlocks.slice(0, 4).map((block, index) => (index === 3 ? { ...(block as object), rows: [(block as { rows: unknown[] }).rows[0]] } : block)), true)], 1, "streaming"),
        ],
        status: "running", activeRun: { runId: "run1", threadId: "th1", status: "running" },
      });
    case "long": {
      const longTitle = "Investigate the intermittent failure in the nightly synchronisation job that only appears when the network is slow";
      const titles = [longTitle, "Q3 planning", "Pinned: reading list", "Refactor the settings screen", "Holiday itinerary for Lisbon and Porto", "Budget spreadsheet cleanup", "Draft reply to landlord", "Explain the borrow checker", "Meal prep ideas", "Review pull request 482", "Quarterly goals", "Gift ideas", "Learning Spanish plan", "Home network audit"];
      const threads = titles.map((title, index) => thread(`th${index}`, title, index * 400 + 10, index === 3 ? { activity: "complete" as const } : index === 7 ? { activity: "error" as const, attention: 1 } : {}));
      const longText = "This is a deliberately long paragraph to check wrapping. ".repeat(40).trim();
      const unbroken = "https://example.com/" + "a-very-long-unbroken-path-segment".repeat(6);
      return parse({
        threads, activeThreadId: "th0",
        messages: [
          user("m1", `${longTitle}. ${longText}`, 30),
          assistant("m2", "m1", [
            tool("t1", "workspace_read", "Read file", "completed", "src/very/deeply/nested/directory/structure/with/a/long/file-name-that-keeps-going-and-going.ts", "2,400 lines"),
            { type: "text", id: "m2:t", text: `${longText}\n\n${unbroken}\n\n\`\`\`\n${"const reallyLongLine = " + "'x'.repeat(10) + ".repeat(12) + "'end';"}\n\`\`\`` },
          ], 29),
        ],
      });
    }
  }
}
