import { useEffect, useRef, type ChangeEvent, type KeyboardEvent, type ReactElement } from "react";
import type { ReasoningEffort } from "../../shared/contracts";
import { NO_ADJUSTABLE_THINKING, effortHint, effortName, effortValueText, isTopLevel, levelIndex, orderedLevels } from "../lib/effort";

export type EffortSliderProps = {
  /** Display name of the selected model, used for the accessible label. */
  model: string;
  /** The model's reasoningOptions. Empty or missing means no slider. */
  levels: readonly ReasoningEffort[] | undefined;
  value: ReasoningEffort | null;
  onChange: (level: ReasoningEffort) => void;
  /** Fired once each time the slider arrives at the model's top level (not on every render). */
  onTopLevel?: () => void;
  /** Hide the description line; the consumer places it elsewhere. */
  compact?: boolean;
  /** Locked (for example during a run): the range cannot move and the keys do nothing. */
  disabled?: boolean;
};

export function EffortSlider({ model, levels, value, onChange, onTopLevel, compact, disabled }: EffortSliderProps): ReactElement {
  const offered = orderedLevels(levels);
  const count = offered.length;
  const index = levelIndex(offered, value);
  const top = isTopLevel(count, index);
  const wasTop = useRef(top);

  useEffect(() => {
    if (top && !wasTop.current) onTopLevel?.();
    wasTop.current = top;
  }, [top, onTopLevel]);

  if (!count) return <p className="picker-hint">{NO_ADJUSTABLE_THINKING}</p>;

  const current = offered[index];
  const name = effortName(current);
  const handle = (event: ChangeEvent<HTMLInputElement>) => {
    const next = offered[Math.round(Number(event.target.value))];
    if (next && next !== current) onChange(next);
  };

  // Mirrors a native range's keys so the behaviour does not depend on the webview.
  const keyTarget = (key: string): number | null => {
    if (key === "ArrowLeft" || key === "ArrowDown") return Math.max(0, index - 1);
    if (key === "ArrowRight" || key === "ArrowUp") return Math.min(count - 1, index + 1);
    if (key === "Home") return 0;
    if (key === "End") return count - 1;
    return null;
  };
  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const target = keyTarget(event.key);
    if (disabled || target === null || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = offered[target];
    if (next && next !== current) onChange(next);
  };

  return (
    <>
      <div className="effort-field">
        <div className={`effort eff-n-${count} eff-at-${index}${top ? " is-max" : ""}`}>
          <input
            type="range"
            min={0}
            max={count - 1}
            step={1}
            value={index}
            aria-label={`Thinking for ${model}`}
            aria-valuetext={effortValueText(current, top)}
            disabled={disabled}
            onChange={handle}
            onKeyDown={handleKey}
          />
          <span className="effort-fill" />
          {offered.map((level, i) => (
            <span key={level} className={`effort-tick t-${i}${i <= index ? " on" : ""}`} aria-hidden="true" />
          ))}
          <span className="effort-thumb" />
          <span className="effort-burst" />
        </div>
        <span className="effort-value" aria-hidden="true">
          <span key={current}>{name}</span>
        </span>
      </div>
      {compact ? null : <p className="picker-hint">{effortHint(current)}</p>}
    </>
  );
}
