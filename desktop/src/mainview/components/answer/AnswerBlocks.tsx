import { Check, FileWarning, TrendingUp } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import type { AnswerRow } from "../../../shared/answer-catalog";
import type { AnswerPartBlock } from "../../../shared/contracts";
import { useDraftPick, useIntentState } from "./intent-state";
import type { AnswerContext } from "./types";

type Of<T extends AnswerPartBlock["type"]> = Extract<AnswerPartBlock, { type: T }>;
interface BlockProps<T extends AnswerPartBlock["type"]> { block: Of<T>; ctx: AnswerContext }

/** Tenths are clamped and rendered as classes (`h-4`, `s-7`, `w-10`); a value never reaches a `style`. */
const tenths = (value: number) => Math.max(0, Math.min(10, Math.round(value)));
const join = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(" ");

function Head({ label, count }: { label: string; count?: string }) {
  return <div className="gen-head"><span>{label}</span>{count !== undefined && <span>{count}</span>}</div>;
}

function Pending({ label }: { label: string }) {
  return <><span className="gen-act-spin" aria-hidden="true" />{label}</>;
}

function Note({ children }: { children: string | undefined }) {
  return children ? <span className="field-error" role="alert">{children}</span> : null;
}

function Done({ children }: { children: ReactNode }) {
  return <span className="gen-done"><Check className="i" aria-hidden="true" />{children}</span>;
}

function Headline({ block }: BlockProps<"headline">) {
  return <h2 className="gen-headline">{block.text}</h2>;
}

function Text({ block }: BlockProps<"text">) {
  return <p className="gen-text">{block.text}</p>;
}

function Stats({ block }: BlockProps<"stats">) {
  return (
    <div className="gen-stats">
      {block.items.map((item, index) => (
        <div className="gen-stat" key={index}>
          <span className="gen-stat-value">{item.value}</span>
          <span className="gen-stat-label">{item.label}</span>
          {(item.delta || item.spark) && (
            <span className="gen-stat-foot">
              {item.delta && <span className={`gen-delta is-${item.dir ?? "up"}`}><TrendingUp className="i" aria-hidden="true" />{item.delta}</span>}
              {item.spark && item.delta && <span className="gen-spark" aria-hidden="true">{item.spark.map((n, i) => <i key={i} className={`s-${tenths(n)}`} />)}</span>}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** A row or timeline action: a button naming its row, or the outcome once acted. */
function RowAction({ row, ctx }: { row: AnswerRow; ctx: AnswerContext }) {
  const { pending, note } = useIntentState(ctx.answerId, row.id);
  const outcome = ctx.outcomes[row.id];
  if (outcome) return <Done>{outcome}</Done>;
  if (!row.act) return null;
  const { act } = row;
  return (
    <>
      <Note>{note}</Note>
      <button type="button" className={join("gen-act", act.primary && "primary")} aria-label={`${act.label}: ${row.title}`} aria-busy={pending || undefined} disabled={pending}
        onClick={() => ctx.onIntent?.({ answerId: ctx.answerId, rowId: row.id, intent: act.intent })}>{pending ? <Pending label={act.label} /> : act.label}</button>
    </>
  );
}

function List({ block, ctx }: BlockProps<"list">) {
  return (
    <div className="gen-block">
      <Head label={block.label} count={block.count} />
      <div className="gen-list">
        {block.rows.map((row) => (
          <div className={join("gen-row", !!ctx.outcomes[row.id] && "is-done")} key={row.id}>
            {row.tick ? <span className="gen-tick"><Check className="i" aria-hidden="true" /></span> : <span className={join("dot", row.dot === "warn" && "warn")} />}
            <span className="gen-row-title">{row.title}</span>
            <span className="gen-row-sub">{row.sub ?? ""}</span>
            <span className="gen-row-end">{row.time}<RowAction row={row} ctx={ctx} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Timeline({ block, ctx }: BlockProps<"timeline">) {
  return (
    <div className="gen-block">
      <Head label={block.label} count={block.count} />
      <div className="gen-timeline" role="list" aria-label={block.label}>
        {block.rows.map((row) => (
          <div className={join("gen-tl-row", row.past && "is-past", row.now && "is-now")} role="listitem" key={row.id}>
            <span className="gen-tl-time">{row.time}</span>
            <span className="gen-tl-rail" aria-hidden="true" />
            <span className="gen-tl-copy">
              <span className="gen-tl-title">{row.title}{row.now && <span className="gen-now">Now</span>}</span>
              <span className="gen-tl-sub">{row.sub ?? ""}</span>
            </span>
            <span className="gen-tl-end"><RowAction row={row} ctx={ctx} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Progress({ block }: BlockProps<"progress">) {
  return (
    <div className="gen-block">
      <Head label={block.label} count={block.count} />
      <div className="gen-progress">
        {block.items.map((item, index) => (
          <div className={join("gen-meter", item.warn && "is-warn")} key={index}>
            <span className="gen-meter-label">{item.label}</span>
            <span className="gen-meter-value">{item.value}</span>
            <span className={`gen-meter-track w-${tenths((item.now / item.max) * 10)}`} role="meter" aria-label={item.label}
              aria-valuemin={0} aria-valuemax={item.max} aria-valuenow={item.now} aria-valuetext={item.value}><i /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Table({ block }: BlockProps<"table">) {
  return (
    <div className="gen-block">
      <Head label={block.label} />
      <div className="gen-table-wrap">
        <div className={`gen-table cols-${block.cols.length}`} role="table" aria-label={block.label}>
          <div role="row">{block.cols.map((col, i) => <span role="columnheader" key={i}>{col}</span>)}</div>
          {block.rows.map((row, r) => (
            <div role="row" className={row.pick ? "is-pick" : undefined} key={r}>
              {row.cells.map((cell, c) => <span role="cell" key={c}>{cell}</span>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bars({ block }: BlockProps<"bars">) {
  return (
    <div className="gen-block">
      <Head label={block.label} count={block.note} />
      <div className="gen-bars" role="img" aria-label={`${block.aria}: ${block.bars.map((bar) => `${bar[0]} ${bar[1]}`).join(", ")}`}>
        {block.bars.map((bar, index) => <div className={join("gen-bar", `h-${tenths(bar[1])}`, bar[2] === true && "is-hi")} key={index}><i /><span>{bar[0]}</span></div>)}
      </div>
    </div>
  );
}

const CHOICE_KEYS = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];

/** Roving tabindex radio group: arrows move and pick, Home/End jump, Confirm is the next tab stop. */
function Choice({ block, ctx }: BlockProps<"choice">) {
  const outcome = ctx.outcomes[block.id];
  const done = outcome !== undefined;
  const { pending, note } = useIntentState(ctx.answerId, block.id);
  const [picked, setPicked] = useDraftPick(ctx.answerId, block.id);
  const group = useRef<HTMLDivElement>(null);
  const focusIndex = useRef<number | null>(null);
  // After a locked choice the checked option is the one the outcome names.
  const checked = picked ?? (done ? block.options.find((option) => outcome.endsWith(option.title))?.id : undefined);
  const chosen = block.options.find((option) => option.id === checked);

  // Focus follows the selection once the group has re-rendered.
  useEffect(() => {
    if (focusIndex.current === null) return;
    const target = group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[focusIndex.current];
    focusIndex.current = null;
    target?.focus();
  }, [picked]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!CHOICE_KEYS.includes(event.key) || done) return;
    event.preventDefault();
    const last = block.options.length - 1;
    const current = block.options.findIndex((option) => option.id === checked);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? last
      : event.key === "ArrowDown" || event.key === "ArrowRight" ? (current + 1) % block.options.length
      : current <= 0 ? last : current - 1;
    focusIndex.current = next;
    setPicked(block.options[next]!.id);
  };

  return (
    <div className={join("gen-choice", done && "is-done")}>
      <Head label={block.label} />
      <div className="gen-options" role="radiogroup" aria-label={block.label} ref={group} onKeyDown={onKeyDown}>
        {block.options.map((option, index) => (
          <button type="button" className="gen-option" role="radio" key={option.id} aria-checked={checked === option.id}
            tabIndex={(checked ? checked === option.id : index === 0) ? 0 : -1} disabled={done || pending} onClick={() => setPicked(option.id)}>
            <span className="gen-radio" aria-hidden="true" />
            <span className="gen-option-title">{option.title}</span>
            <span className="gen-option-sub">{option.sub ?? ""}</span>
            {option.tag && <span className="gen-option-tag">{option.tag}</span>}
          </button>
        ))}
      </div>
      <div className="gen-choice-foot">
        {done ? <Done>{outcome}</Done> : (
          <>
            <Note>{note}</Note>
            <button type="button" className="gen-act primary" disabled={!chosen || pending} aria-busy={pending || undefined} aria-label={chosen ? `${block.confirm.label}: ${chosen.title}` : block.confirm.label}
              onClick={() => chosen && ctx.onIntent?.({ answerId: ctx.answerId, blockId: block.id, intent: "choose", value: chosen.id })}>{pending ? <Pending label={block.confirm.label} /> : block.confirm.label}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** The whole path, with a break opportunity after each slash so a long one wraps instead of being cut off. */
function WrappedPath({ file }: { file: string }) {
  return <>{file.split("/").map((part, index, all) => <Fragment key={index}>{part}{index < all.length - 1 && <>/<wbr /></>}</Fragment>)}</>;
}

function Diff({ block, ctx }: BlockProps<"diff">) {
  const outcome = ctx.outcomes[block.id];
  const { pending, note } = useIntentState(ctx.answerId, block.id);
  const [asked, setAsked] = useState<"approve" | "skip">("approve");
  const fire = (intent: "approve" | "skip") => { setAsked(intent); ctx.onIntent?.({ answerId: ctx.answerId, blockId: block.id, intent }); };
  return (
    <div className="gen-block">
      <Head label={block.label} />
      <div className={join("gen-diff", outcome !== undefined && "is-done")} role="group" aria-label={`Proposed edit to ${block.file}${block.where ? `, ${block.where}` : ""}`}>
        {/* The whole path is the thing being approved: it wraps (a <strong> would be ellipsized by the design system) instead of being cut off, and the full text is also the title and label. */}
        <div className="gen-diff-head"><span className="gen-diff-file" title={block.file} aria-label={block.file}><WrappedPath file={block.file} /></span><span>{block.where ?? ""}</span></div>
        {block.lines.map((line, index) => (
          <div className={join("gen-diff-line", line.del ? "del" : line.ins ? "ins" : undefined)} key={index}>
            <span className="n" aria-hidden="true">{line.n ?? ""}</span>
            <span className="sign" aria-hidden="true">{line.del ? "−" : line.ins ? "+" : ""}</span>
            <span>{line.del && <span className="sr-only">Removed: </span>}{line.ins && <span className="sr-only">Added: </span>}{line.text}</span>
          </div>
        ))}
        <div className="gen-diff-foot">
          {outcome !== undefined ? <Done>{outcome}</Done> : (
            <>
              <Note>{note}</Note>
              <button type="button" className="gen-act" aria-label={`Not now: leave ${block.file} unchanged`} disabled={pending} aria-busy={(pending && asked === "skip") || undefined}
                onClick={() => fire("skip")}>{pending && asked === "skip" ? <Pending label="Not now" /> : "Not now"}</button>
              <button type="button" className="gen-act primary" aria-label={`${block.act.label} the edit to ${block.file}`} disabled={pending} aria-busy={(pending && asked === "approve") || undefined}
                onClick={() => fire("approve")}>{pending && asked === "approve" ? <Pending label={block.act.label} /> : block.act.label}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Quote({ block }: BlockProps<"quote">) {
  return <figure className="gen-quote"><p>{block.text}</p><cite>{block.cite}</cite></figure>;
}

function Sources({ block }: BlockProps<"sources">) {
  return <div className="gen-sources"><span>From</span>{block.items.map((item, i) => <span className="gen-source" key={i}>{item}</span>)}</div>;
}

function Suggest({ block, ctx }: BlockProps<"suggest">) {
  return <div className="gen-suggest">{block.items.map((item, i) => <button type="button" className="gen-chip" key={i} onClick={() => ctx.onFollowUp?.(item)}>{item}</button>)}</div>;
}

function Fallback() {
  return <p className="gen-fallback" role="note"><FileWarning className="i" aria-hidden="true" />One part of this answer couldn’t be shown.</p>;
}

type Registry = { [K in AnswerPartBlock["type"]]: ComponentType<BlockProps<K>> };

/** One component per catalog block, plus the fallback. */
export const blockRegistry: Registry = {
  headline: Headline, text: Text, stats: Stats, list: List, timeline: Timeline, progress: Progress, table: Table,
  bars: Bars, choice: Choice, diff: Diff, quote: Quote, sources: Sources, suggest: Suggest, fallback: Fallback,
};

export function AnswerBlockView({ block, ctx }: { block: AnswerPartBlock; ctx: AnswerContext }) {
  const Component = blockRegistry[block.type] as ComponentType<{ block: AnswerPartBlock; ctx: AnswerContext }> | undefined;
  return Component ? <Component block={block} ctx={ctx} /> : <Fallback />;
}

