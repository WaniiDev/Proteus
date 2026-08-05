# Proteus — Implementation Handoff

**Audience:** the coding agent / engineering team building the real product.
**Source materials:** `Proteus-CONCEPT.md` (product concept), `DESIGN-elevenlabs.md` (design system), and the working proof-of-concept prototype this document ships with (`/app`).
**Version:** v4 (voice-first + generative center) · **Date:** 2026-08-02

> **Platform note (important):** Proteus is a **Windows desktop app (packaged `.exe`), not a web app.** The prototype uses HTML/CSS/JS purely as the UI layer — the same stack a Tauri or Electron shell renders. All layout decisions (collapsible sidebar, edge-to-edge workbench, window-level scrolling, local data copy) are made for a desktop window, not a browser page. Do not introduce browser chrome assumptions, URL routing, or web hosting into the implementation.

---

## 1. What the prototype proves

The prototype (`/app` — HTML + CSS + JS, one vendored library, no build step) demonstrates the full first-meaningful-outcome loop from the concept:

> A user returns to one important Project, asks what matters now, understands the answer, takes a safe next step, and leaves the Project clearer than they found it.

Proven interactions:

1. **Liquid Orb as the product's presence** — a WebGL (Three.js) simplex-noise shader sphere with 9 states (idle, listening, thinking, working, waiting, speaking, done, interrupted, recovery). States don't switch animations: amplitude, flow speed, frequency, scale, and palette *ease* toward per-state targets every frame, so transitions melt. Listening/speaking add voice-like surface modulation; the orb leans toward the pointer and nudges while the user types.
2. **Center → dock layout contract** — at rest the Orb holds the center of the stage. When Proteus starts generating, the center hero collapses, generated UI pops in from the center, and the orb FLIP-animates into a persistent bottom dock beside its state label. It never disappears during work.
3. **Desktop app shell** — collapsible left sidebar (240px ⇄ 68px icon rail, animated, persisted) with brand, icon menu, and an orb-presence chip; no top navigation bar. The window scrolls as one surface; the workbench goes edge-to-edge.
4. **Two interaction modes, one toggle** — a segmented Voice / Chat control (persisted per device) swaps the input surface: a mic-first **voice bar** (big mic, live transcript, contextual status line) or a classic text composer with an inline mic. Voice is the default and the natural front door; chat is a complete, equal path — every scenario works in both.
5. **Generative center (the big v4 change)** — everything that matters now materializes **in the center thread**, not the right panel: adaptive surfaces (comparison, milestones, trade-offs), the decision card, the approval gate, memory consent, and the end-of-session **Project brief**. The workbench demotes itself to a quiet ledger (§3).
6. **Voice replies as artifacts** — in voice mode, key spoken answers also land as transcript cards with a replay button, so voice leaves a scannable record. Spoken output is on by default in voice mode, always off in chat mode.
7. **Snooze everywhere ("Not now")** — every control card offers a low-key "Not now" alongside its primary actions. Snoozing parks the request without judgment: the scenario closes gracefully, nothing is sent or saved, and the cards stay readable in the thread.
8. **Visible work** — goal, plan steps with live status, evidence list with confidence levels (`verified` / `inferred` / `unverified`).
9. **User decision card** — options with a marked recommendation; the user decides, Proteus organizes.
10. **Approval gate** — consequential action (draft email in the user's name) requires explicit Approve / Edit / Decline. Nothing is sent — the draft artifact is clearly marked "Not sent".
11. **Memory consent** — proposed memory items require per-item opt-in; "discard all" is always offered. Kept items persist (localStorage in the prototype) and shape the next session's greeting.
12. **Interrupt & recovery** — Stop button / Esc at any point (the Stop control lives in whichever input surface is active); orb contracts, states "Nothing was sent or saved", recovers calmly.
13. **Project continuity, as a brief** — each completed run ends with an ink **brief card** in the center: what changed / still open / where to continue, plus an "Open Project" button that jumps straight to the project record the session just updated.

**Run it:** serve the folder over HTTP and open `index.html`:
```bash
cd app && python3 -m http.server 8123   # → http://127.0.0.1:8123
```
HTTP is required for the ES-module WebGL orb. Opening the file directly (`file://`) still works — the CSS fallback orb takes over silently. No build, no network calls.

### Prototype inventory

| File | Purpose |
|---|---|
| `app/index.html` | App shell: importmap, collapsible sidebar, Companion view (orb center slot + thread + dock row + **mode toggle + voice bar + composer** + workbench), Projects, Memory, Settings |
| `app/styles.css` | Full design system: tokens → sidebar/app-shell → components → orb/dock → **voice bar, surface cards, reply cards, ink brief card** → grouped workbench ledger → generative pop-ins → responsive |
| `app/app.js` | Orb state controller + `dockOrb()` FLIP animation, **mode manager (`modeUI`), generative mounters (`genUI`), center-mounted control cards with snooze (`presentAction`)**, sidebar collapse, speech wrapper, conversation renderer, workbench-ledger controller, scenario engine (simulation), mock data, view renderers |
| `app/orb3d.js` | Liquid Orb: Three.js shader sphere. `STATE_FX` per-state targets; eased uniforms; pseudo-voice modulation; pointer parallax; exposes `window.orbFX.setState / .pulse / .nudge`; adds `webgl-on` class when active |
| `app/lib/three.module.min.js` | Vendored Three.js r160 (import-mapped as `three`) — offline-friendly |

**Mode system notes (v4):** `settings.mode` (`'voice' | 'chat'`, persisted in `localStorage` under `proteus.mode.v1`) is read by three subsystems: the input surface (voice bar vs. composer, swapped by `modeUI`), the speech output gate (`speech.speak()` no-ops outside voice mode), and the generative layer (`genUI.voiceReply()` mounts transcript cards only in voice mode). The interrupt button exists in *both* input surfaces (`#stopBtn` in the voice bar, `#stopBtnChat` in the composer) — `beginRun()/endRun()` arm whichever matches the active mode. In production, treat mode as a per-device preference, never a per-conversation one.

**Desktop shell notes (v3):** the sidebar is the app's only navigation chrome — a 240px column collapsing to a 68px icon rail (CSS width transition + label fade; state persisted in localStorage; auto-collapses under 900px, becomes a top strip under 640px for narrow windows). The brand orb in the sidebar mirrors the Orb's identity. The presence chip at the sidebar bottom mirrors `orb.state` — keep these two in sync in production. A frameless-window port should reserve the top ~32px as a drag region (Tauri `data-tauri-drag-region` / Electron `-webkit-app-region: drag`) with min/close controls top-right; the current design needs no other chrome.

---

## 2. The Orb (signature subsystem)

The Orb *is* the status system — users never decode technical status. Three layers work together:

**Renderer (`orb3d.js`).** One sphere geometry (96×96), one `ShaderMaterial`:
- Vertex shader: two octaves of Ashima simplex noise displace vertices along normals (`uAmp`, `uFreq`, `uSpeed` uniforms) plus a voice wave term (`uVoice`).
- Fragment shader: vertical gradient between two pastel palette colors (`uColorA`/`uColorB`), diffuse lighting, fresnel rim, slight highlight on displaced peaks.
- Every frame, live values damp toward the current state's `STATE_FX` targets (frame-rate-independent easing). A transient `pulseAmp` decays exponentially — `orbFX.pulse()` (dock arrival) and `orbFX.nudge()` (typing) spike it.
- Pointer parallax tilts the mesh ±0.55 rad toward the cursor.

**State semantics (`ORB_STATES` in `app.js`, palettes mirrored in `STATE_FX`).** Each state has a label (12px uppercase), a one-line human description, a palette, and liquid behaviour:

| State | Palette | Liquid behaviour | Overlay |
|---|---|---|---|
| idle | mint→lavender | slow gentle flow, slow breathe | — |
| listening | sky→mint | faster flow + voice modulation | expanding ripple rings |
| thinking | lavender→sky | higher-frequency churn | swirl (CSS fallback) |
| working | peach→lavender | vigorous flow + modulation | orbiting pastel dots |
| waiting | neutral greys | near-still, slightly smaller | — |
| speaking | rose→peach | rhythmic flow + voice modulation | — |
| done | mint flash | brief scale pop | — |
| interrupted | grey | contracts, nearly still | — |
| recovery | lavender→mint | regrows, eases back | — |

**Layout contract.** `.stage` is a column flex: `.stage-center` (orb hero, `flex: 1 0 auto`, centered), `.thread` (scrollable generated UI), `.dock-row` (orb slot 76px + state meta), `.chips`, `.composer`. `dockOrb()` moves `#orbFloat` + `#orbMeta` into the dock via WAAPI FLIP (translate+scale from old rect, `cubic-bezier(.25,1.3,.4,1)`, ~820ms) and collapses the center hero. The orb stays in the dock for the rest of the session — it does not pop back per message.

**Production requirements (must keep, whatever the renderer):**
1. Center-at-rest → dock-on-generate layout and the FLIP move.
2. Per-state palettes + eased liquid transitions (no hard animation cuts).
3. Calm, human state descriptions — never technical status text.
4. Voice-reactive surface during listening/speaking; wire to real mic amplitude (replace `pseudo voice` in `orb3d.js` with an `AnalyserNode` RMS feed).
5. Graceful degradation to the CSS orb (or static gradient) without WebGL.
6. Respect `prefers-reduced-motion` (CSS overlays already do; freeze shader time when set).

---

## 3. The workbench (right panel) — a quiet ledger

Since v4, the right panel no longer *hosts* the important UI — it **records** it. Everything the user must read, decide, or approve materializes in the center thread (generative UI, §1); the workbench mirrors the run as a faithful, glanceable ledger. Its job is accountability, not interaction.

v4 structure (`.workbench-live`):

- **Header** — "CURRENT WORK" kicker, goal in display serif (23px/300), status pill (`Active` → `Interrupted` → `Reviewed`, the last as solid ink).
- **Groups** — bordered 16px cards stacked with 12px gaps, each with an uppercase micro-label header and a count badge:
  - **Plan** — steps with pending/active/done indicators; badge shows `done/total` (updates live).
  - **Evidence in use** — rows with confidence dots; badge shows item count.
  - **Surface** — no longer contains the surface. When `genUI.surface()` mounts a surface in the center, this group shows the surface **kind badge** plus a one-line pointer ("Generated in the conversation — comparison is on stage now.").
  - **Action group** — hidden until the user is needed; gains the `needs-action` highlight and shows the request **label** ("Needs your decision" / "Approval gate" / "Memory — your consent") with a pointer line. The actionable card itself lives in the center thread. Cleared the moment the request settles (including snooze).
- **Completion** — status pill becomes "Reviewed"; the *recommended next step* moved into the center-mounted **brief card** (§1, item 13), which is where the user actually reads it.
- The panel is `position: sticky` inside a two-column grid (`1fr × minmax(340px, 420px)`), `max-height: calc(100vh - 48px)` with its own scroll — the app window scrolls as one surface.

Production rules: groups render in fixed order; counters are truthful (no vanity numbers); the panel never demands input — it only ever *points* to where input is happening; there is never more than one pending request; the "Reviewed" state appears only after the run completes or is interrupted, never automatically mid-run.

---

## 4. Design system (must be preserved)

Derived from `DESIGN-elevenlabs.md`. The CSS custom properties in `styles.css :root` are the source of truth and map 1:1 to the design tokens.

**Core rules (non-negotiable):**

- Canvas `#f5f5f5`, ink `#0c0a09` / `#292524`. **No saturated action color anywhere.** The ink pill (`--primary`, radius 9999px) is the only primary CTA; outline pill is secondary.
- Display type: **Waldenburg Light 300** (licensed; prototype substitutes **EB Garamond 300** via Google Fonts — swap back when licensed). Never bold display copy. Negative letter-spacing at display sizes.
- Body: **Inter 400/500**, letter-spacing +0.15–0.18px.
- Pastel gradients (mint `#a7e5d3`, peach `#f4c5a8`, lavender `#c8b8e0`, sky `#a8c8e8`, rose `#e8b8c4`) appear **only** as ambient background orbs and Orb palettes — never button fills, text colors, or card backgrounds.
- Elevation = 1px hairline `#e7e5e4` + at most one soft shadow (`0 4px 16px rgba(0,0,0,.04)`).
- Semantic colors restricted to confirmation/error: success `#16a34a`, error `#dc2626` (evidence confidence dots, destructive actions).
- Section rhythm 96px; card radius 16px; orb cards 24px.

**Generative motion language:** generated blocks materialise with `.reveal` (translateY 22px + scale .9 + blur 5px → settle, `cubic-bezier(.22,1.25,.36,1)` — a gentle overshoot). Blocks stagger ~260–420ms. Motion should feel like printing, not popping.

---

## 5. Production architecture (recommended)

The concept targets a **Windows knowledge worker**. Recommended shape:

```
┌─────────────────────────────────────────────────────┐
│ Windows shell (Tauri or Electron → packaged .exe)   │
│  ├─ UI layer — this prototype, ported to components │
│  │   (React/Svelte/vanilla — keep the design system │
│  │   and the orb as a self-contained component)     │
│  ├─ collapsible sidebar shell + frameless drag bar  │
│  ├─ global hotkey summon (e.g. Win+Shift+P)         │
│  └─ system tray presence (summon / quit / status)   │
├─────────────────────────────────────────────────────┤
│ Local orchestrator (the "intelligence")             │
│  ├─ Conversation manager  → LLM (tool-calling loop) │
│  ├─ Work engine           → plan/steps/evidence     │
│  ├─ Approval gate service → user consent            │
│  ├─ Memory service        → proposed/kept store     │
│  └─ Project service       → project stories, logs   │
├─────────────────────────────────────────────────────┤
│ Local data layer (SQLite) — user-owned, on-device   │
│  projects · memories · sessions · evidence · drafts │
├─────────────────────────────────────────────────────┤
│ Connectors (read-first): notes/files · email (RO) · │
│ calendar · school/web portals — each permissioned   │
└─────────────────────────────────────────────────────┘
```

Tauri is preferred (smaller binary, Rust core, easy sidecar for the orchestrator); Electron works if the team is JS-only. Either way: single `.exe` installer (NSIS/MSI), auto-start optional and off by default, no browser dependency at runtime — the WebView is embedded.

Principles that shape the architecture: **Personal** (data on-device by default; cloud LLM calls explicit, redacted, logged), **Controlled** (the approval gate is a *service*, not a UI habit — no action executes without a recorded consent), **Honest** (every claim carries provenance: source + confidence).

---

## 6. Event contract — orchestrator ↔ UI

The prototype's scenario engine is scripted. In production, the orchestrator emits events; the UI renders them exactly as the prototype renders its script. **Keep the UI a dumb, faithful renderer** — all intelligence lives behind this contract.

```jsonc
// Orchestrator → UI
{ "type": "orb.state",        "state": "idle|summoned|away|listening|thinking|working|remembering|drafting|verifying|waiting|speaking|done|interrupted|error|recovery", "desc?": "string" }
{ "type": "orb.dock" }                                    // first generation of a run: orb center → bottom dock (fire once per session start)
{ "type": "orb.pulse" } | { "type": "orb.nudge" }         // transient liquid accents (arrival, typing)
{ "type": "message.append",   "blocks": [ { "text": "..." }, { "thai": "..." }, { "card": { ... } } ] }
{ "type": "work.start",       "goal": "string" }
{ "type": "work.plan",        "steps": [ { "id": "s1", "name": "..." } ] }
{ "type": "work.step",        "id": "s1", "state": "active|done|blocked", "note?": "string" }
{ "type": "evidence.add",     "items": [ { "level": "verified|inferred|unverified", "text": "...", "source": "...", "date": "..." } ] }
{ "type": "surface.render",   "kind": "comparison|milestones|tradeoffs|table|chart", "payload": { ... } }   // mounts CENTER stage (genUI); workbench shows kind + pointer
{ "type": "reply.voice",      "text": "..." }                         // voice mode only: transcript card with replay
{ "type": "decision.request", "id": "d1", "title": "...", "due?": "...", "options": [ { "label": "...", "recommended?": true } ] }
{ "type": "approval.request", "id": "a1", "action": "draft_email", "title": "...", "why": "...", "preview": "...", "consequence": "local|external|irreversible" }
{ "type": "memory.propose",   "id": "m1", "project": "...", "items": [ { "text": "...", "kind": "decision|fact|preference|note" } ] }
{ "type": "brief.render",     "title": "...", "rows": [ { "tag": "...", "text": "..." } ], "foot": "...", "projectId": "..." }   // center-mounted session brief (replaces session.summary in v3)

// UI → Orchestrator
{ "type": "user.message",     "text": "...", "lang": "en|th", "via": "voice|text" }
{ "type": "decision.answer",  "id": "d1", "choice": 0 | "snooze" }
{ "type": "approval.answer",  "id": "a1", "verdict": "approve|edit|decline|snooze", "edits?": "..." }
{ "type": "memory.answer",    "id": "m1", "kept": [0, 2] | "snooze" }   // indexes, [] = discard all
{ "type": "interrupt" }                                           // Stop button (voice bar or composer) / Esc
{ "type": "mode.change",      "mode": "voice|chat" }                    // per-device preference
{ "type": "project.open",     "id": "meridian" }
```

**Snooze semantics:** `"snooze"` means *park, don't act, don't record a decision* — the orchestrator leaves the request open, sends nothing, saves nothing, and may re-surface it later (the prototype simply closes the run gracefully; re-surfacing policy is an orchestrator decision). Snooze is never treated as decline.

Mapping to prototype code: `orb.set()` implements `orb.state`; `dockOrb()` implements `orb.dock` (triggered by `beginRun()`); `window.orbFX` implements `orb.pulse/nudge`; `genUI.surface/voiceReply/brief` implement `surface.render`/`reply.voice`/`brief.render`; `wb.*` implements `work.*`/`evidence.*` and the ledger pointers; `presentAction` + `askDecision`, `askApproval`, `askMemoryConsent` implement the three `*.request/answer` pairs (including snooze); `modeUI` implements `mode.change`; `route()` + `scenario*()` are the throwaway simulation the orchestrator replaces.

---

## 7. Data models (TypeScript)

```ts
type Confidence = "verified" | "inferred" | "unverified";
type Lang = "en" | "th";
type OrbState = "idle" | "summoned" | "away" | "listening" | "thinking" | "working"
              | "remembering" | "drafting" | "verifying" | "waiting" | "speaking"
              | "done" | "interrupted" | "error" | "recovery";

interface Project {
  id: string;
  name: string;
  kind: string;                       // Investigation | Plan | Responsibility | Goal | Activity
  summary: string;                    // the story, one paragraph
  known: StoryItem[];
  changed: StoryItem[];               // since last session
  open: StoryItem[];                  // unresolved, incl. unverified claims
  continueText: string;               // where to continue
  log: SessionLogEntry[];
  createdAt: string; lastTouchedAt: string;
}

interface StoryItem { text: string; source?: string; confidence: Confidence; date: string; }
interface SessionLogEntry { date: string; text: string; sessionId: string; }

interface MemoryItem {
  id: string;
  projectId: string;
  kind: "decision" | "fact" | "preference" | "note" | "correction";
  text: string;
  status: "proposed" | "kept" | "discarded";   // proposed NEVER influences behavior
  createdAt: string; reviewedAt?: string;
}

interface Evidence { level: Confidence; text: string; source: string; date: string; sessionId: string; }

interface Approval {
  id: string;
  action: string;                      // draft_email | send_message | delete | purchase ...
  title: string; why: string; preview: string;
  consequence: "local" | "external" | "irreversible";
  verdict?: "approve" | "edit" | "decline";
  decidedAt?: string;                  // immutable audit record
}

interface Draft { id: string; projectId: string; channel: "email" | "message"; to: string; subject?: string; body: string; state: "awaiting_review" | "edited" | "sent_by_user" | "discarded"; }
```

**Memory rules (hard requirements):** memories are written only as `proposed`; they become usable context only after the user keeps them; delete is immediate and total; nothing is remembered silently. The prototype demonstrates this flow — production must enforce it in the data layer, not just the UI.

---

## 8. Voice layer

Voice is the **default mode** (v4): the voice bar — one big mic, a status line, a live transcript — is the primary input surface, with chat one toggle away. Prototype uses `SpeechRecognition`/`speechSynthesis` with graceful simulation. Production swap points (isolated in the `speech` module):

- **STT:** Whisper (local, on-device preferred) or Azure Speech. Must support `th-TH` and `en-US` with automatic language detection — Thai is a first-class front door, not a fallback.
- **TTS:** any neural voice; **on by default in voice mode, always off in chat mode** (the mode toggle is the spoken-output switch — there is no separate TTS preference). Voice responses must be interruptible by simply starting to speak (barge-in), mirroring the prototype's Stop.
- **Voice leaves a record:** every spoken answer also renders as a transcript card with replay (`genUI.voiceReply`) — voice mode never becomes an ephemeral black box.
- **Orb–voice coupling:** feed mic RMS (Web Audio `AnalyserNode`) into `orbFX`-equivalent `uVoice` during listening, and TTS playback level during speaking — the prototype's pseudo-voice modulation is the placeholder for exactly this.
- **Summon:** explicit only (hotkey, tray, button). Proteus is **not** always-listening — a stated product boundary.

---

## 9. Replacement map — simulation → production

| Prototype piece | Replace with |
|---|---|
| `route()` regex intents | LLM intent understanding + tool dispatch |
| `scenario*()` scripted flows | Orchestrator emitting the event contract (§6) |
| `wait()` timing | Real async tool execution with progress events |
| Mock `PROJECTS` array | SQLite project store + project service API |
| `localStorage` kept memories | SQLite memory store with proposed/kept states |
| Canned evidence items | Connector reads (notes, email RO, calendar) with provenance |
| Canned surface payloads | Surface renderers driven by `surface.render` payloads |
| localStorage (memories, sidebar state, **mode preference**) | SQLite + app config store (Tauri/Electron store) |
| Canned draft email | Draft service; user sends from their own client — Proteus never sends |
| Web Speech API | Whisper + neural TTS (§8) |
| Pseudo-voice `uVoice` in `orb3d.js` | Real mic/TTS amplitude feed |
| Simulated mic transcript (voice bar + composer mic) | Real STT stream feeding the same transcript UI |

**Keep as-is (or port faithfully):** the design system, the orb renderer + dock contract, the mode toggle + voice bar, the generative center contract (surfaces, reply cards, brief, control cards all mount in the thread), the workbench-ledger layout, the three control cards with snooze (decision/approval/memory), evidence confidence visuals, generative pop-in motion, project detail structure.
**Do not port:** the regex router, the canned scenario texts, the mock dataset — they exist only to demonstrate interaction shape.

---

## 10. Build phases & acceptance criteria

**Phase 1 — the daily loop (the only thing that matters first).**
Event contract + orchestrator + one connector (notes/files) + project store + memory consent + approval gate for drafts + orb dock wired to real events.
*Acceptance:* the concept's first meaningful outcome works end-to-end with a real LLM on the user's real notes, in English and Thai, with all evidence carrying provenance and confidence, every consequential step gated, and the orb correctly centering/docking across a session.

**Phase 2 — voice parity.** Whisper STT + optional TTS + barge-in + hotkey summon + orb voice modulation from real amplitude.
*Acceptance:* a spoken session completes the same loop; interruption works mid-speech; the orb visibly listens and speaks.

**Phase 3 — second connector + richer surfaces.** Email (read-only) + chart/table surfaces.
*Acceptance:* email-sourced evidence appears with provenance; no send capability exists without a new, explicit permission.

**Explicit non-goals for these phases** (from the concept's scope discipline): team features, social, integrations marketplace, ambient automation, autonomous action. Do not build them.

---

## 11. Non-functional requirements

- **Privacy:** all stores on-device; any cloud call is logged, redacted, and listed in Settings → Permissions.
- **Honesty:** no answer without provenance; `unverified` items stay visually distinct and are never silently promoted to fact.
- **Calm:** no badges-with-numbers pressure (the only count is proposed memories awaiting review), no toast storms, motion respects `prefers-reduced-motion`.
- **Correctable:** every session action is undoable or explainable; approval decisions are an immutable audit log the user can inspect.
- **Performance:** orb renders at 60fps with ≤ 1 draw call for the sphere (already true); orb state changes reflected < 100ms from event; first token of understanding < 2s on typical hardware.
- **Offline:** vendor runtime dependencies (the prototype vendors Three.js and would vendor fonts in production).

## 12. Known prototype limitations (by design)

- Intelligence is scripted; free-form input falls back to a clarify flow.
- Voice input uses browser speech recognition when present, else simulation; TTS is browser-default (voice mode only); orb voice modulation is simulated, not mic-driven.
- Persistence is localStorage (kept memories, sidebar state, mode preference only); projects are in-memory mocks; the dock does not persist across reloads (orb recenters on fresh load).
- Snooze parks a request for the current run only — re-surfacing parked items later is an orchestrator feature, not demonstrated.
- The prototype runs in a browser for convenience; the WebGL orb needs HTTP for ES modules in that context (`file://` falls back to the CSS orb). Inside Tauri/Electron this is a non-issue — the shell serves the bundle natively.
- No authentication, multi-day date logic, real connectors, tray, or hotkey — those belong to the desktop shell phase.
- Below 640px width the sidebar becomes a top strip (development aid only; the desktop app enforces a sensible minimum window size).

---

*One intelligence. Any form. Build the smallest thing that makes the promise real — then stop, and earn trust.*
