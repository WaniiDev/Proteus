import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { ArrowUp, Square } from "lucide-react";
import { MAX_INPUT_LENGTH } from "../../../shared/constants";
import type { OrbState } from "../../../shared/contracts";
import { reducedMotion, lensRipple } from "../../ds-app/lens";
import { wave } from "../../ds-app/wave";
import { shouldSubmitComposerKey, type IslandMode, type IslandEnd, type IslandStatus } from "../../lib/composer-ui";

/** How long the stop confirmation stays in the status slot before the input comes back. */
export const STOPPED_MS = 3_200;
/** The sheen and the lens ripple run for dur-ripple (700ms); the class stays a beat longer. */
export const MORPH_MS = 720;
export const STOPPED_STATUS: IslandStatus = { label: "Stopped.", line: "Nothing was sent or saved." };

export type IslandHandle = {
  /** One ring across the glass: call on approve (send does it itself). */
  wave: () => void;
};

export type IslandProps = {
  orbState: OrbState;
  /** The conversation has started: the orb slot opens and the orb docks at 44px. */
  docked: boolean;
  orbAnchorRef: (element: HTMLDivElement | null) => void;
  mode: IslandMode;
  end: IslandEnd;
  status: IslandStatus;
  askKind: string;
  input: string;
  placeholder: string;
  inputDisabled: boolean;
  sendLabel: string;
  sendDisabled: boolean;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
  /** A typing keystroke, for the orb to lean in. */
  onNudge?: () => void;
  /** The Island grows upward when open (an ask or an answer). */
  open?: boolean;
  /** Content of `.island-body` (ask bodies, answer body); always mounted, inert while closed. */
  body?: ReactNode;
  /** Adds `gen-scroll` to the body so long answers scroll inside the capsule. */
  bodyScroll?: boolean;
  /** Under the capsule: the context chips row. */
  meta?: ReactNode;
  /** How long the stop confirmation shows. */
  stoppedMs?: number;
  ref?: Ref<IslandHandle>;
};

type Slots = { on: "a" | "b"; key: string; a: IslandStatus; b: IslandStatus };

const emptyStatus: IslandStatus = { label: "", line: "" };

/**
 * The Island: one smoked-glass capsule for the composer, the live status and Stop. Every variant of the middle slot (input, two
 * alternating status lines, the ask kicker) and of the end slot (send, Stop) stays mounted and is switched with `data-on`;
 * hidden ones are inert. It is also the app's one live region.
 */
export function Island({ orbState, docked, orbAnchorRef, mode, end, status, askKind, input, placeholder, inputDisabled, sendLabel, sendDisabled, onInput, onSubmit, onStop, onNudge, open = false, body, bodyScroll = false, meta, stoppedMs = STOPPED_MS, ref }: IslandProps) {
  const waveRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stopRequestedRef = useRef(false);
  const [stopped, setStopped] = useState(false);
  const [morphing, setMorphing] = useState(false);
  const [slots, setSlots] = useState<Slots>({ on: "a", key: "", a: emptyStatus, b: emptyStatus });

  useImperativeHandle(ref, () => ({ wave: () => wave(waveRef.current) }), []);

  // Stop confirmation: when a run that was stopped from here ends, say so for a moment instead of going quiet.
  const running = end === "stop";
  const wasRunningRef = useRef(running);
  useEffect(() => {
    const wasRunning = wasRunningRef.current;
    wasRunningRef.current = running;
    if (running) {
      setStopped(false);
      return undefined;
    }
    if (!wasRunning || !stopRequestedRef.current) return undefined;
    stopRequestedRef.current = false;
    setStopped(true);
    const timer = window.setTimeout(() => setStopped(false), stoppedMs);
    return () => window.clearTimeout(timer);
  }, [running, stoppedMs]);

  const visibleMode: IslandMode = mode === "ask" ? "ask" : stopped ? "status" : mode;
  const shownStatus = stopped && mode !== "ask" ? STOPPED_STATUS : status;
  const statusOn = visibleMode === "status";

  // Two status slots alternate, so the old words fade while the new ones arrive. Only update while the status is the visible variant.
  const statusKey = `${shownStatus.label}|${shownStatus.line}`;
  if (statusOn && statusKey !== slots.key) {
    const next = slots.on === "a" ? "b" : "a";
    setSlots({ ...slots, on: next, key: statusKey, [next]: shownStatus });
  }

  // Tide: the glass ripples and a sheen crosses it once whenever the capsule changes shape.
  const previousOpenRef = useRef(open);
  useEffect(() => {
    if (previousOpenRef.current === open) return undefined;
    previousOpenRef.current = open;
    if (reducedMotion()) return undefined;
    lensRipple();
    setMorphing(true);
    const timer = window.setTimeout(() => setMorphing(false), MORPH_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // The input comes back after a status or ask: give it focus again if nothing else holds it.
  const previousModeRef = useRef(visibleMode);
  useLayoutEffect(() => {
    const previous = previousModeRef.current;
    previousModeRef.current = visibleMode;
    if (visibleMode !== "input" || previous === "input") return;
    const active = document.activeElement;
    if (!active || active === document.body) inputRef.current?.focus({ preventScroll: true });
  }, [visibleMode]);

  const inputOn = visibleMode === "input";
  const askOn = visibleMode === "ask";
  // An ask answers from its body (Decline / Approve), so neither end button shows while it is open.
  const sendOn = end === "send" && !askOn;
  const stopOn = end === "stop" && !askOn;
  const flag = (on: boolean) => (on ? "true" : "false");
  const slotProps = (on: boolean) => ({ "data-on": flag(on), "aria-hidden": !on, inert: !on });

  return (
    <div className="island-dock">
      <div className={`island lens${open ? " is-open" : ""}${morphing ? " is-morphing" : ""}`} data-orb={orbState} aria-live="polite" aria-atomic="false">
        <span className="island-wave" ref={waveRef} aria-hidden="true" />
        <form
          className="island-row"
          autoComplete="off"
          onSubmit={(event) => {
            if (!sendOn || sendDisabled) {
              event.preventDefault();
              return;
            }
            wave(waveRef.current);
            onSubmit(event);
          }}
        >
          <div className={`island-orb-slot${docked ? " is-docked" : ""}`} ref={orbAnchorRef} aria-hidden="true" />
          <div className="island-slot">
            <textarea
              ref={inputRef}
              className="island-input"
              data-on={flag(inputOn)}
              rows={1}
              value={input}
              placeholder={placeholder}
              aria-label="Message Proteus"
              maxLength={MAX_INPUT_LENGTH}
              disabled={!inputOn || inputDisabled}
              tabIndex={inputOn ? undefined : -1}
              onChange={(event) => {
                onInput(event.target.value);
                onNudge?.();
              }}
              onKeyDown={(event) => {
                if (!shouldSubmitComposerKey({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
            />
            <div className="island-status" {...slotProps(statusOn && slots.on === "a")}><strong>{slots.a.label}</strong>{" "}<span>{slots.a.line}</span></div>
            <div className="island-status" {...slotProps(statusOn && slots.on === "b")}><strong>{slots.b.label}</strong>{" "}<span>{slots.b.line}</span></div>
            <div className="island-status" {...slotProps(askOn)}><span className="island-kicker">Needs you{askKind ? ` · ${askKind}` : ""}</span><span>Your call. Nothing moves without you.</span></div>
          </div>
          <div className="island-end">
            <button type="submit" className="island-send" data-on={flag(sendOn)} aria-label={sendLabel} title={sendLabel} disabled={!sendOn || sendDisabled} tabIndex={sendOn ? undefined : -1}>
              <ArrowUp className="i" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn btn-island-quiet"
              data-on={flag(stopOn)}
              disabled={!stopOn}
              tabIndex={stopOn ? undefined : -1}
              onClick={() => {
                stopRequestedRef.current = true;
                onStop();
              }}
            >
              <Square className="i sm" aria-hidden="true" />Stop
            </button>
          </div>
        </form>
        <div className="island-body" aria-hidden={!open} inert={!open}>
          <div>
            <div className={`island-body-inner${bodyScroll ? " gen-scroll" : ""}`}>{body}</div>
          </div>
        </div>
      </div>
      {meta}
    </div>
  );
}
