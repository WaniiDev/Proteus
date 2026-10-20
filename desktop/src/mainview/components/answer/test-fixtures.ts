import type { ChatAnswerPart } from "../../../shared/contracts";

export const ANSWER_BLOCK_TYPES = ["headline", "text", "stats", "list", "timeline", "progress", "table", "bars", "choice", "diff", "quote", "sources", "suggest"];

export const fullBlocks: ChatAnswerPart["blocks"] = [
  { type: "headline", text: "Three things need you" },
  { type: "text", text: "Context only." },
  { type: "stats", items: [{ value: "3", label: "Open", delta: "+1", dir: "up", spark: [2, 10] }, { value: "4%", label: "Rate", delta: "−0.3 pts", dir: "down" }] },
  { type: "list", label: "To do", count: "2", rows: [
    { id: "r1", title: "Reply to the vendor", sub: "Due Thursday", dot: "warn", act: { label: "Draft reply", intent: "reply", primary: true, done: "Drafted" } },
    { id: "r2", title: "Merged the FAQ", tick: true, time: "07:02" },
  ] },
  { type: "timeline", label: "Today", rows: [
    { id: "t1", title: "Stand-up", time: "9:30", past: true },
    { id: "t2", title: "Review", time: "11:00", now: true, act: { label: "Notes", intent: "open", done: "Opened" } },
  ] },
  { type: "progress", label: "Goals", items: [{ label: "Launch", now: 7, max: 10, value: "7 of 10" }, { label: "Budget", now: 9, max: 10, value: "90%", warn: true }] },
  { type: "table", label: "Options", cols: ["Plan", "Cost"], rows: [{ cells: ["Annual", "$480"], pick: true }, { cells: ["Monthly", "$55"] }] },
  { type: "bars", label: "Focus", aria: "Focus hours", bars: [["Mon", 4], ["Wed", 9, true]] },
  { type: "choice", id: "c1", label: "Which plan?", options: [{ id: "o1", title: "Annual", sub: "Saves $180", tag: "Best value" }, { id: "o2", title: "Monthly" }, { id: "o3", title: "Trial" }], confirm: { label: "Choose", done: "Chosen" } },
  { type: "diff", id: "d1", label: "Proposed edit", file: "docs/plan.md", where: "line 14", lines: [{ n: "13", text: "## Beta" }, { n: "14", text: "old", del: true }, { n: "14", text: "new", ins: true }], act: { label: "Approve", done: "Approved · edited", skipDone: "Not now · unchanged" } },
  { type: "quote", text: "Keep Friday light.", cite: "notes.md" },
  { type: "sources", items: ["notes.md"] },
  { type: "suggest", items: ["Show next week"] },
];

export function makeAnswer(blocks: ChatAnswerPart["blocks"], over: Partial<ChatAnswerPart> = {}): ChatAnswerPart {
  return { type: "answer", id: "a1:a", toolCallId: "a1", answerId: "a1", title: "Your week", question: "What needs me?", blocks, streaming: false, outcomes: {}, ...over };
}
