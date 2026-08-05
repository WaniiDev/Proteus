/* ============================================================
   Proteus — Proof-of-concept prototype
   Plain HTML + CSS + JS. No dependencies.
   The "intelligence" here is a scripted local simulation:
   it demonstrates the interaction model (orb states, visible
   work, adaptive surfaces, approval gates, memory consent)
   without any backend. See Proteus-HANDOFF.md for how to
   replace the simulation with a real orchestrator.
   ============================================================ */
'use strict';

/* ---------------- Utilities ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const INTERRUPT = Symbol('interrupt');
let interruptFlag = false;

function wait(ms) {
  // interruptible sleep: polls the interrupt flag
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    (function poll() {
      if (interruptFlag) return reject(INTERRUPT);
      if (performance.now() - t0 >= ms) return resolve();
      setTimeout(poll, 60);
    })();
  });
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ICONS = {
  check: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
  checkBig: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>',
  spark: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 2.5"/></svg>',
  change: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  open: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  known: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V6a2 2 0 0 1 2-2h13v13H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 0 2 2h13"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".5" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M8 5.5v13l11-6.5-11-6.5z"/></svg>'
};

/* ============================================================
   THE ORB — state machine
   States: idle · listening · thinking · working · waiting
           speaking · done · interrupted · recovery
   ============================================================ */
const ORB_STATES = {
  idle:        { label: 'At rest',     desc: 'Speak or type below — English or Thai.',            palette: ['#a7e5d3', '#c8b8e0'] },
  listening:   { label: 'Listening',   desc: 'I\u2019m hearing you. Take your time.',             palette: ['#a8c8e8', '#a7e5d3'] },
  thinking:    { label: 'Thinking',    desc: 'Understanding what you need\u2026',                 palette: ['#c8b8e0', '#a8c8e8'] },
  working:     { label: 'Working',     desc: 'Gathering and organizing — watch the panel.',       palette: ['#f4c5a8', '#c8b8e0'] },
  waiting:     { label: 'Waiting',     desc: 'Your call. Nothing moves without you.',             palette: ['#e7e5e4', '#f0efed'] },
  speaking:    { label: 'Speaking',    desc: 'Here is what I found.',                             palette: ['#e8b8c4', '#f4c5a8'] },
  done:        { label: 'Done',        desc: 'Complete — and reviewed by you.',                   palette: ['#a7e5d3', '#d8f3e8'] },
  interrupted: { label: 'Interrupted', desc: 'Stopped. Nothing was sent or saved.',               palette: ['#d6d3d1', '#e7e5e4'] },
  recovery:    { label: 'Recovering',  desc: 'Picking things back up calmly\u2026',               palette: ['#c8b8e0', '#a7e5d3'] },
};

const orb = (() => {
  const floatEl = $('#orbFloat');
  const layers = [$('#orbLayer0'), $('#orbLayer1')];
  const label = $('#orbStateLabel');
  const desc = $('#orbStateDesc');
  const presenceLabel = $('#presenceLabel');
  const presenceDot = $('#presenceDot');
  let front = 0;
  let current = 'idle';

  function paint(palette) {
    const back = 1 - front;
    layers[back].style.background = `radial-gradient(circle at 34% 28%, ${palette[0]}, ${palette[1]} 78%)`;
    layers[back].style.opacity = '1';
    layers[front].style.opacity = '0';
    front = back;
    presenceDot.style.background = `radial-gradient(circle at 35% 30%, ${palette[0]}, ${palette[1]})`;
  }

  function set(state, customDesc) {
    const s = ORB_STATES[state] || ORB_STATES.idle;
    current = state;
    floatEl.dataset.state = state;
    paint(s.palette);
    label.textContent = s.label;
    desc.textContent = customDesc || s.desc;
    presenceLabel.textContent = s.label;
    if (window.orbFX) window.orbFX.setState(state);
  }

  async function doneThen(rest = 'idle', holdMs = 1600) {
    set('done');
    try { await wait(holdMs); } catch (e) { /* ignore */ }
    if (!interruptFlag) set(rest);
  }

  return { set, doneThen, get state() { return current; } };
})();

/* ============================================================
   ORB DOCKING — the generative-UI move.
   At rest the orb holds the center of the stage. When Proteus
   starts generating, content pops in from the center and the orb
   is pushed into a persistent bottom dock (FLIP-animated).
   ============================================================ */
let orbDocked = false;
function dockOrb() {
  if (orbDocked) return;
  orbDocked = true;
  const floatEl = $('#orbFloat');
  const meta = $('#orbMeta');
  const center = $('#stageCenter');
  const dock = $('#dockRow');

  const first = floatEl.getBoundingClientRect();
  dock.hidden = false;
  $('#slotBottom').appendChild(floatEl);
  $('#dockMeta').appendChild(meta);
  const last = floatEl.getBoundingClientRect();

  const dx = first.left - last.left;
  const dy = first.top - last.top;
  const s = first.width / last.width;
  floatEl.style.transformOrigin = 'top left';
  floatEl.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
    { transform: 'translate(0px, 0px) scale(1)' },
  ], { duration: 820, easing: 'cubic-bezier(.25, 1.3, .4, 1)' })
    .onfinish = () => { floatEl.style.transformOrigin = ''; };
  if (window.orbFX) window.orbFX.pulse();

  /* collapse the center hero as the generated UI takes over */
  const h = center.scrollHeight;
  center.style.overflow = 'hidden';
  center.animate([
    { height: h + 'px', opacity: 1 },
    { height: '0px', opacity: 0 },
  ], { duration: 640, easing: 'cubic-bezier(.5, 0, .8, .35)' })
    .onfinish = () => { center.hidden = true; center.style.overflow = ''; };
}

/* ============================================================
   VOICE — real STT when available, simulated otherwise;
   optional TTS for replies.
   ============================================================ */
const settings = {
  voice: true,
  mode: 'voice', // 'voice' | 'chat'
  lang: 'en', // 'en' | 'th'
};

const speech = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;

  function supported() { return !!SR; }

  function listen({ onResult, onEnd, onError }) {
    if (!settings.voice) return onError && onError('disabled');
    if (SR) {
      try {
        rec = new SR();
        rec.lang = settings.lang === 'th' ? 'th-TH' : 'en-US';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = (e) => onResult(e.results[0][0].transcript);
        rec.onerror = () => onError && onError('error');
        rec.onend = () => onEnd && onEnd();
        rec.start();
        return true;
      } catch (_) { /* fall through to simulation */ }
    }
    return false; // caller simulates
  }

  function stop() { try { rec && rec.stop(); } catch (_) {} }

  function speak(text) {
    // in voice mode, replies are spoken by default
    if (settings.mode !== 'voice' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = settings.lang === 'th' ? 'th-TH' : 'en-US';
      u.rate = 1.0;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  function cancelSpeak() { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {} }

  return { supported, listen, stop, speak, cancelSpeak };
})();

/* ============================================================
   CONVERSATION RENDERER
   ============================================================ */
const thread = $('#thread');

function scrollStage() {
  const stage = $('.stage');
  const last = thread.lastElementChild;
  if (last) last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ============================================================
   MODE MANAGER — Voice ⇄ Chat
   Voice is the natural front door; chat is a complete,
   dignified alternative. The toggle swaps the composer.
   ============================================================ */
const modeUI = (() => {
  const MODE_KEY = 'proteus.mode.v1';
  const HINTS = {
    voice: 'Voice is the natural front door — hold the mic and just talk.',
    chat: 'Prefer keys? Type anytime — the Orb stays with you.',
  };
  try { const m = localStorage.getItem(MODE_KEY); if (m === 'chat' || m === 'voice') settings.mode = m; } catch (_) {}

  function apply() {
    const voice = settings.mode === 'voice';
    $('#modeVoice').classList.toggle('active', voice);
    $('#modeChat').classList.toggle('active', !voice);
    $('#modeVoice').setAttribute('aria-selected', voice);
    $('#modeChat').setAttribute('aria-selected', !voice);
    $('#voiceBar').hidden = !voice;
    $('#composer').hidden = voice;
    $('#modeHint').textContent = HINTS[settings.mode];
  }
  function set(mode) {
    if (mode !== 'voice' && mode !== 'chat') return;
    settings.mode = mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch (_) {}
    apply();
  }
  $('#modeVoice').addEventListener('click', () => set('voice'));
  $('#modeChat').addEventListener('click', () => set('chat'));
  apply();
  return { set, apply };
})();

/* ============================================================
   GENERATIVE UI — important work materializes in the center.
   The right panel keeps the ledger (goal/plan/evidence);
   surfaces, decisions, approvals, and briefs pop in here.
   ============================================================ */
const genUI = (() => {
  function mount(node) {
    hideTyping();
    const wrap = el(`<div class="msg ai"><div class="msg-avatar"></div><div class="msg-body"></div></div>`);
    wrap.querySelector('.msg-body').appendChild(node);
    thread.appendChild(wrap);
    node.classList.add('reveal');
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('in')));
    scrollStage();
    return wrap;
  }

  function surface(kind, html) {
    const card = el(`<div class="surface-card">
      <div class="surface-card-head">
        <span class="caption-uppercase">Surface · ${kind}</span>
        <button class="surface-dismiss">${ICONS.check} Keep</button>
      </div>
      <div class="surface-body">${html}</div>
    </div>`);
    const btn = card.querySelector('.surface-dismiss');
    btn.addEventListener('click', () => { btn.classList.add('done'); btn.innerHTML = `${ICONS.check} Kept`; }, { once: true });
    mount(card);
    return card;
  }

  function voiceReply(text) {
    const card = el(`<div class="reply-card">
      <div class="reply-card-head">
        <button class="replay-btn" aria-label="Replay">${ICONS.play}</button>
        <span class="reply-card-label">Proteus · voice reply</span>
        <span class="voice-bars" hidden><i></i><i></i><i></i><i></i><i></i></span>
      </div>
      <p>${escapeHtml(text)}</p>
    </div>`);
    const btn = card.querySelector('.replay-btn');
    const bars = card.querySelector('.voice-bars');
    btn.addEventListener('click', () => {
      const playing = btn.classList.toggle('playing');
      bars.hidden = !playing;
      if (playing) {
        try {
          window.speechSynthesis && window.speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.lang = settings.lang === 'th' ? 'th-TH' : 'en-US';
          u.onend = u.onerror = () => { btn.classList.remove('playing'); bars.hidden = true; };
          window.speechSynthesis && window.speechSynthesis.speak(u);
        } catch (_) {}
      } else {
        speech.cancelSpeak();
      }
    });
    mount(card);
  }

  function brief({ title, rows, foot, onOpen }) {
    const card = el(`<div class="brief-card">
      <h3>${title}</h3>
      <div class="brief-rows">
        ${rows.map(r => `<div class="brief-row"><span class="brief-ico">${r.icon}</span><p><span class="brief-tag">${r.tag}</span>${r.text}</p></div>`).join('')}
      </div>
      <div class="brief-foot"><span>${foot}</span><button class="btn-primary">Open Project</button></div>
    </div>`);
    card.querySelector('.btn-primary').addEventListener('click', onOpen);
    mount(card);
  }

  return { mount, surface, voiceReply, brief };
})();

function addUserMsg(text) {
  const m = el(`<div class="msg user"><div class="bubble">${escapeHtml(text)}</div></div>`);
  thread.appendChild(m);
  scrollStage();
}

let typingEl = null;
function showTyping() {
  hideTyping();
  typingEl = el(`<div class="msg ai"><div class="msg-avatar"></div><div class="msg-body"><div class="typing-dots"><i></i><i></i><i></i></div></div></div>`);
  thread.appendChild(typingEl);
  scrollStage();
}
function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

/**
 * Add an assistant message built from "blocks".
 * blocks: array of strings (paragraphs, may contain <strong>)
 *         or { html } raw blocks (cards etc.)
 *         or { thai: '...' } Thai paragraph
 * Blocks reveal sequentially — calm, editorial pacing.
 */
async function addAiMsg(blocks, { stagger = 260 } = {}) {
  hideTyping();
  const body = el(`<div class="msg ai"><div class="msg-avatar"></div><div class="msg-body"></div></div>`).querySelector('.msg-body');
  const wrap = body.parentElement;
  thread.appendChild(wrap);
  let plainText = '';
  for (const b of blocks) {
    if (interruptFlag) throw INTERRUPT;
    let node;
    if (typeof b === 'string') {
      node = el(`<p class="msg-text reveal">${b}</p>`);
      plainText += b.replace(/<[^>]*>/g, '') + ' ';
    } else if (b.thai) {
      node = el(`<p class="msg-text thai reveal">${b.thai}</p>`);
      plainText += b.thai.replace(/<[^>]*>/g, '') + ' ';
    } else if (b.note) {
      node = el(`<p class="msg-text reveal" style="font-size:13px;color:var(--muted)">${b.note}</p>`);
    } else {
      node = el(`<div class="reveal">${b.html}</div>`);
      plainText += (b.speak || '') + ' ';
    }
    body.appendChild(node);
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('in')));
    scrollStage();
    await wait(stagger);
  }
  return plainText.trim();
}

/* ============================================================
   WORKBENCH — visible work + adaptive surface
   ============================================================ */
const wb = (() => {
  const empty = $('#workbenchEmpty');
  const live = $('#workbenchLive');
  const status = $('#wbStatus');
  const goal = $('#wbGoal');
  const grpPlan = $('#grpPlan');
  const grpEvidence = $('#grpEvidence');
  const grpSurface = $('#grpSurface');
  const grpAction = $('#grpAction');
  const planCount = $('#planCount');
  const evCount = $('#evCount');
  const surfaceKind = $('#surfaceKind');
  const stepsOl = $('#wbSteps');
  const evBox = $('#wbEvidence');
  const sfBox = $('#wbSurface');
  const actLabel = $('#wbActionLabel');
  const actBox = $('#wbAction');
  let steps = [];

  function start(goalText) {
    empty.hidden = true;
    live.hidden = false;
    status.textContent = 'Active';
    status.className = 'badge-pill wb-status';
    goal.textContent = goalText;
    steps = [];
    stepsOl.innerHTML = ''; planCount.textContent = '';
    evBox.innerHTML = ''; evCount.textContent = '';
    sfBox.innerHTML = ''; surfaceKind.textContent = '';
    actBox.innerHTML = ''; actLabel.textContent = 'Needs you';
    grpPlan.hidden = grpEvidence.hidden = grpSurface.hidden = grpAction.hidden = true;
    grpAction.classList.remove('needs-action');
  }

  function updatePlanCount() {
    const done = steps.filter(s => s.state === 'done').length;
    planCount.textContent = `${done}/${steps.length}`;
  }

  function setSteps(list) {
    steps = list.map(s => ({ ...s, state: 'pending' }));
    grpPlan.hidden = false;
    stepsOl.innerHTML = '';
    steps.forEach(s => {
      stepsOl.appendChild(el(
        `<li class="wb-step" data-step="${s.id}">
           <span class="step-ico">${ICONS.check}</span>
           <span class="step-name">${s.name}<span class="step-note"></span></span>
         </li>`));
    });
    updatePlanCount();
  }

  function stepState(id, state, note) {
    const li = stepsOl.querySelector(`[data-step="${id}"]`);
    if (!li) return;
    li.classList.remove('active', 'done');
    if (state) li.classList.add(state);
    const s = steps.find(x => x.id === id);
    if (s) s.state = state || 'pending';
    if (note !== undefined) li.querySelector('.step-note').textContent = note;
    updatePlanCount();
  }

  function addEvidence(items) {
    grpEvidence.hidden = false;
    items.forEach(it => {
      evBox.appendChild(el(
        `<div class="ev-row reveal">
           <span class="ev-dot ${it.level}"></span>
           <span>${it.text}<span class="ev-meta">${it.meta} · ${({ verified: 'Verified', inferred: 'Inferred', unverified: 'Unverified' })[it.level]}</span></span>
         </div>`));
    });
    evCount.textContent = evBox.children.length;
    requestAnimationFrame(() => $$('.reveal', evBox).forEach(n => n.classList.add('in')));
  }

  function setSurface(kind, html) {
    // the surface itself materializes in the center (genUI);
    // the panel keeps a quiet pointer to it
    grpSurface.hidden = false;
    surfaceKind.textContent = kind;
    sfBox.innerHTML = `<p class="wb-surface-hint">Generated in the conversation — ${kind.toLowerCase()} is on stage now.</p>`;
  }

  function setAction(label, node) {
    grpAction.hidden = false;
    grpAction.classList.add('needs-action');
    actLabel.textContent = label;
    actBox.innerHTML = '';
    if (node) actBox.appendChild(node);
  }

  function clearAction() {
    actBox.innerHTML = '';
    grpAction.classList.remove('needs-action');
    grpAction.hidden = true;
  }

  function finish() { status.textContent = 'Reviewed'; status.className = 'badge-pill wb-status done'; }
  function interrupted() { status.textContent = 'Interrupted'; status.className = 'badge-pill wb-status interrupted'; }

  return { start, setSteps, stepState, addEvidence, setSurface, setAction, clearAction, finish, interrupted };
})();

/* small builders shared by scenarios */
function confidenceHtml(level, dotsOn) {
  return `<span class="confidence"><span class="dots">${[1, 2, 3].map(i => `<i class="${i <= dotsOn ? 'on' : ''}"></i>`).join('')}</span>Confidence: ${level}</span>`;
}

/* ============================================================
   DATA — mock workspace. Kept memories persist in localStorage
   to demonstrate continuity ("make returning tomorrow easier").
   ============================================================ */
const TODAY = 'Aug 2';

const PROJECTS = [
  {
    id: 'meridian',
    name: 'Project Meridian',
    kind: 'Investigation',
    tint: 'lavender',
    summary: 'Evaluate and shortlist packaging suppliers for the Q4 product run.',
    lastTouched: 'Today',
    openCount: 1,
    known: [
      { text: 'Two suppliers in scope: ThaiPack Co. (incumbent) and SiamFlex (challenger).' },
      { text: 'Budget ceiling for the Q4 run approved at ฿1.8M.', meta: 'Finance note · Jul 21' },
      { text: 'Sustainability requirement: at least one recycled-material option on the shortlist.', meta: 'Your decision · Jul 24' },
    ],
    changed: [
      { text: 'ThaiPack raised unit price 4.2% in quote rev 7.', meta: 'Verified · your note · Jul 29' },
      { text: 'SiamFlex revised lead time from 5 weeks to 3.', meta: 'Verified · connected email · Jul 30' },
    ],
    open: [
      { text: 'Final supplier shortlist — due Fri, Aug 7.', meta: 'Decision · owner: you' },
      { text: 'SiamFlex MOQ for the recycled line — mentioned on a call, no written record.', meta: 'Unverified' },
    ],
    continueText: 'Decide the shortlist. Evidence points to SiamFlex — pending one written confirmation.',
    log: [
      { date: 'Jul 30', text: 'Reviewed SiamFlex revised timeline; flagged MOQ as unverified.' },
      { date: 'Jul 29', text: 'Logged ThaiPack quote rev 7 (+4.2%).' },
      { date: 'Jul 24', text: 'You set the sustainability requirement for the shortlist.' },
    ],
  },
  {
    id: 'phuket',
    name: 'Phuket Relocation',
    kind: 'Plan',
    tint: 'sky',
    summary: 'Move the household from Bangkok to Phuket by mid-September.',
    lastTouched: 'Yesterday',
    openCount: 2,
    known: [
      { text: 'Move window: Sep 12–20, anchored to the school term.' },
      { text: 'Housing budget: ≤ ฿45,000/month, west coast preferred.', meta: 'Your note · Jul 26' },
    ],
    changed: [
      { text: 'Agent sent 3 new condo listings in Bang Tao.', meta: 'Connected email · Aug 1' },
    ],
    open: [
      { text: 'Condo viewings not yet booked — waiting on your weekend availability.' },
      { text: 'School survey response due Aug 10 — needs your answers.' },
    ],
    continueText: 'Book two condo viewings for next weekend, then the school survey.',
    log: [
      { date: 'Aug 1', text: 'Shortlisted 3 Bang Tao listings from the agent\u2019s email.' },
      { date: 'Jul 26', text: 'You set the housing budget and area preference.' },
    ],
  },
  {
    id: 'budget',
    name: 'Q3 Budget Review',
    kind: 'Responsibility',
    tint: 'mint',
    summary: 'Reconcile Q3 spend against plan and brief the leads before Aug 14.',
    lastTouched: 'Jul 28',
    openCount: 1,
    known: [
      { text: 'Briefing with leads scheduled Aug 14, 10:00.' },
      { text: 'Two cost centers are >8% over plan: Events, Tooling.', meta: 'Finance export · Jul 27' },
    ],
    changed: [
      { text: 'Finance issued revised accrual numbers on Jul 27.', meta: 'Verified · finance export' },
    ],
    open: [
      { text: 'Variance commentary for Events — draft started, not reviewed.' },
    ],
    continueText: 'Finish the Events variance draft, then circulate the pre-read.',
    log: [
      { date: 'Jul 28', text: 'Started variance draft; flagged Events for commentary.' },
      { date: 'Jul 27', text: 'Imported revised accruals from finance.' },
    ],
  },
];

/* memory store: kept items persist; proposed items are per-session */
const MEM_KEY = 'proteus.keptMemories.v1';
let keptMemories = [];
try { keptMemories = JSON.parse(localStorage.getItem(MEM_KEY) || '[]'); } catch (_) { keptMemories = []; }
let proposedMemories = [];

function saveKept() { try { localStorage.setItem(MEM_KEY, JSON.stringify(keptMemories)); } catch (_) {} }

/* ============================================================
   SCENARIO ENGINE
   Each scenario is an async function. Shared helpers handle
   decisions, approvals, and memory consent — the three moments
   where the user must stay in control.
   ============================================================ */
const engine = { running: false };

function beginRun() {
  engine.running = true;
  interruptFlag = false;
  dockOrb(); // generative UI takes the center; orb moves to its dock
  if (settings.mode === 'voice') {
    $('#stopBtn').hidden = false;
    $('#voiceBar').classList.add('busy');
    $('#voiceStatus').textContent = 'Working — tap stop anytime, or press Esc.';
  } else {
    $('#stopBtnChat').hidden = false;
    $('#sendBtn').style.display = 'none';
    $('#composer').classList.add('busy');
  }
}

function endRun() {
  engine.running = false;
  interruptFlag = false;
  $('#stopBtn').hidden = true;
  $('#voiceBar').classList.remove('busy');
  if (!micActive) $('#voiceStatus').textContent = 'Tap the mic and talk — English or Thai.';
  $('#stopBtnChat').hidden = true;
  $('#sendBtn').style.display = '';
  $('#composer').classList.remove('busy');
}

/* ============================================================
   CONTROL MOMENTS — decision / approval / memory consent.
   All three materialize in the center (generative UI) and can
   be snoozed with "Not now" — Proteus waits without judgment.
   The right panel mirrors the request state.
   ============================================================ */
function presentAction({ label, waitDesc, card }) {
  wb.setAction(label, el(`<p class="wb-surface-hint">Requesting in the conversation — the decision is yours.</p>`));
  const actions = el(`<div class="approval-actions"></div>`);
  card.appendChild(actions);
  orb.set('waiting', waitDesc);

  return new Promise((resolve) => {
    let settled = false;
    function settle(value) {
      if (settled) return;
      settled = true;
      $$('button', card).forEach(x => x.disabled = true);
      setTimeout(() => { wb.clearAction(); resolve(value); }, value === 'snooze' ? 150 : 350);
    }
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) settle({ act: btn.dataset.act, btn });
    });
    const snooze = el(`<button class="btn-tertiary" data-act="snooze" style="font-size:13px;color:var(--muted-soft)">Not now</button>`);
    actions.appendChild(snooze);
    genUI.mount(card);
  });
}

/* Ask the user to pick one option. Resolves option index or 'snooze'. */
async function askDecision({ title, due, options }) {
  const card = el(`<div class="card approval-card">
    <div class="card-kicker"><span class="card-title">${title}</span><span class="badge-pill">${due}</span></div>
    <p>This is your call — I\u2019ve marked what the evidence supports.</p>
    <div class="opt-list"></div>
  </div>`);
  const list = card.querySelector('.opt-list');
  options.forEach((o, i) => {
    const b = el(`<button class="opt" data-act="pick" data-i="${i}"><span>${o.label}</span>${o.rec ? '<span class="opt-rec">Recommended</span>' : ''}</button>`);
    list.appendChild(b);
  });
  const r = await presentAction({ label: 'Needs your decision', waitDesc: 'A decision is yours to make.', card });
  if (r.act === 'snooze') return 'snooze';
  const i = +r.btn.dataset.i;
  r.btn.classList.add('picked');
  r.btn.insertAdjacentHTML('beforeend', `<span class="pick-check">${ICONS.checkBig}</span>`);
  return i;
}

/* Approval gate for a consequential action. Resolves 'approve' | 'edit' | 'decline' | 'snooze'. */
async function askApproval({ title, why, preview }) {
  const card = el(`<div class="card approval-card">
    <div class="card-kicker"><span class="card-title">Approval needed</span><span class="badge-pill badge-lock">Ask first</span></div>
    <p><strong style="font-weight:500;color:var(--ink)">${title}</strong></p>
    <p>${why}</p>
    <div class="approval-quote">${preview}</div>
  </div>`);
  const holder = el('<div></div>');
  holder.innerHTML = `<button class="btn-primary sm" data-act="approve">Approve</button>
    <button class="btn-outline sm" data-act="edit">Edit first</button>
    <button class="btn-danger-ghost" data-act="decline">Decline</button>`;
  card.appendChild(holder);
  const r = await presentAction({ label: 'Approval gate', waitDesc: 'I need your approval before this.', card });
  holder.querySelectorAll('button').forEach(b => card.querySelector('.approval-actions').insertBefore(b, card.querySelector('[data-act="snooze"]')));
  return r.act;
}

/* Memory consent. Resolves kept items array or 'snooze'. */
async function askMemoryConsent(items, projectName) {
  const card = el(`<div class="card approval-card">
    <div class="card-kicker"><span class="card-title">May I remember this?</span><span class="badge-pill">Your choice</span></div>
    <p>I\u2019d like to keep these in <strong style="font-weight:500;color:var(--ink)">${projectName}</strong>\u2019s story. Uncheck anything you don\u2019t want saved — or discard everything.</p>
    <div class="mem-review"></div>
  </div>`);
  const list = card.querySelector('.mem-review');
  items.forEach((it, i) => {
    list.appendChild(el(`<label><input type="checkbox" checked data-i="${i}"><span>${it.text}</span></label>`));
  });
  const holder = el('<div></div>');
  holder.innerHTML = `<button class="btn-primary sm" data-act="save">Save selected</button>
    <button class="btn-danger-ghost" data-act="discard">Discard all</button>`;
  card.appendChild(holder);
  const r = await presentAction({ label: 'Memory — your consent', waitDesc: 'Choose what I may remember.', card });
  if (r.act === 'snooze') {
    // leave the card usable: move real buttons beside "Not now"
    holder.querySelectorAll('button').forEach(b => card.querySelector('.approval-actions').insertBefore(b, card.querySelector('[data-act="snooze"]')));
    card.querySelector('[data-act="snooze"]').remove();
    return 'snooze';
  }
  if (r.act === 'discard') return [];
  return $$('input[type=checkbox]', list).filter(c => c.checked).map(c => items[+c.dataset.i]);
}

/* ============================================================
   SCENARIO 1 — "What matters now?" (Project Meridian)
   The flagship loop: understand → plan → visible work →
   honest evidence → user decision → approval gate →
   memory consent → continuity summary.
   ============================================================ */
async function scenarioMattersNow(lang) {
  const steps = [
    { id: 's1', name: 'Gather what changed since Tuesday' },
    { id: 's2', name: 'Compare the two suppliers' },
    { id: 's3', name: 'Check the open decision' },
    { id: 's4', name: 'Draft a recommendation' },
  ];

  orb.set('thinking');
  showTyping();
  await wait(1400);

  const intro = [];
  if (lang === 'th') {
    intro.push({ thai: 'เข้าใจแล้วครับ/ค่ะ — คุณอยากรู้ว่าวันนี้ <strong>Project Meridian</strong> มีอะไรที่ต้องให้ความสนใจ' });
    intro.push('Here\u2019s my understanding: you want to know what deserves your attention in <strong>Project Meridian</strong> today. I\u2019ll review what changed since Tuesday, compare the suppliers against it, check the open decision, and propose one safe next step.');
  } else {
    intro.push('Here\u2019s my understanding: you want to know what deserves your attention in <strong>Project Meridian</strong> today. I\u2019ll review what changed since Tuesday, compare the suppliers against it, check the open decision, and propose one safe next step. Watching the panel — everything I use will show up there.');
  }
  await addAiMsg(intro);

  wb.start('Decide what matters today in Project Meridian');
  wb.setSteps(steps);
  orb.set('working');

  /* step 1 — gather */
  wb.stepState('s1', 'active');
  await wait(1300);
  wb.addEvidence([
    { level: 'verified', text: 'ThaiPack raised unit price 4.2% (quote rev 7).', meta: 'Your note · Tue, Jul 29' },
    { level: 'verified', text: 'SiamFlex revised lead time: 5 weeks → 3 weeks.', meta: 'Connected email (read-only) · Wed, Jul 30' },
  ]);
  await wait(900);
  wb.addEvidence([
    { level: 'inferred', text: 'Your draft leans SiamFlex if lead time ≤ 3 weeks.', meta: 'Your unconfirmed draft · Mon' },
    { level: 'unverified', text: 'SiamFlex MOQ for the recycled line — call only, no written record.', meta: 'Could not verify' },
  ]);
  wb.stepState('s1', 'done');
  await wait(700);

  /* step 2 — compare (adaptive surface: comparison) */
  wb.stepState('s2', 'active');
  await wait(1200);
  genUI.surface('Comparison', `
    <table class="mini-table">
      <tr><th></th><th>ThaiPack</th><th>SiamFlex</th></tr>
      <tr><td class="lead">Unit price</td><td>+4.2% <span class="tag-worse">rising</span></td><td>Stable <span class="tag-better">steady</span></td></tr>
      <tr><td class="lead">Lead time</td><td>2 weeks</td><td>3 weeks <span class="tag-better">↓ from 5</span></td></tr>
      <tr><td class="lead">MOQ</td><td>5,000</td><td>8,000 <span class="tag-na">unverified</span><span class="row-note">no written record yet</span></td></tr>
      <tr><td class="lead">Recycled line</td><td><span class="tag-na">None</span></td><td>Yes <span class="tag-better">meets your rule</span></td></tr>
    </table>`);
  wb.setSurface('Comparison');
  await wait(1000);
  wb.stepState('s2', 'done');

  /* step 3 — decision check */
  wb.stepState('s3', 'active');
  await wait(1000);
  wb.stepState('s3', 'done');
  wb.stepState('s4', 'active');

  orb.set('speaking');
  const summaryText = await addAiMsg([
    'Two things changed while you were away, and they matter. ThaiPack got <strong>4.2% more expensive</strong>; SiamFlex cut its lead time to <strong>3 weeks</strong> — which is exactly the condition in your own draft.',
    'On evidence, <strong>SiamFlex now leads</strong>: steadier price, acceptable lead time, and the only recycled line — your stated requirement. One honest gap: their MOQ comes from a phone call. I could not verify it in writing, so I\u2019m treating it as open, not as fact.',
    { html: `<div class="card thread-card"><div class="card-kicker"><span class="card-title">Where I stand</span>${confidenceHtml('Moderate', 2)}</div><p>Confidence is moderate, not high — the recommendation hinges on one number (SiamFlex\u2019s MOQ) that needs written confirmation. Everything else is from your notes or read-only email.</p></div>`, speak: 'Confidence is moderate. One number still needs written confirmation.' },
  ], { stagger: 420 });
  speech.speak(summaryText);
  if (settings.mode === 'voice') genUI.voiceReply(summaryText);

  /* step 4 — user decision */
  const pick = await askDecision({
    title: 'Shortlist decision — due Fri, Aug 7',
    due: 'Due Aug 7',
    options: [
      { label: 'Shortlist SiamFlex; keep ThaiPack as backup', rec: true },
      { label: 'Ask ThaiPack for an updated quote first' },
      { label: 'Defer the decision to next week' },
    ],
  });
  wb.stepState('s4', 'done');
  wb.clearAction();

  let approvedAction = null;
  if (pick === 'snooze') {
    orb.set('speaking');
    await addAiMsg(['Parked. The shortlist stays open — ask me “what matters now in Meridian” whenever you\u2019re ready, and we\u2019ll pick up exactly here. Nothing was sent or saved.']);
    wb.finish();
    setChips(FOLLOWUP_CHIPS.meridian);
    await orb.doneThen('idle', 1400);
    return;
  }

  const chosen = ['Shortlist SiamFlex; keep ThaiPack as backup', 'Ask ThaiPack for an updated quote first', 'Defer to next week'][pick];
  addUserMsg(chosen);

  if (pick === 2) {
    orb.set('speaking');
    await addAiMsg(['Noted — I\u2019ve marked the decision as <strong>deferred to next week</strong>. I\u2019ll surface it again on Monday with anything new. Nothing was sent or saved without you.']);
  } else {
    /* approval gate — consequential draft */
    const target = pick === 0 ? 'SiamFlex' : 'ThaiPack';
    const preview = pick === 0
      ? `To: Khun Anan · SiamFlex\nSubject: Confirming lead time & MOQ — Q4 packaging run\n\n“Thank you for the revised timeline. To finalize our shortlist, could you confirm in writing: (1) the 3-week lead time for the Q4 run; (2) the MOQ for the recycled line.”`
      : `To: Khun Prayuth · ThaiPack\nSubject: Updated quote request — Q4 packaging run\n\n“Before we finalize the shortlist, could you share an updated quote? Rev 7 came in 4.2% above our last cycle, and we\u2019d like to understand the drivers.”`;
    const verdict = await askApproval({
      title: `Draft an email to ${target}?`,
      why: 'This prepares a message in your name. It will be saved as a draft in Project Meridian — <strong>nothing is sent without you</strong>.',
      preview,
    });
    wb.clearAction();

    if (verdict === 'approve') {
      approvedAction = target;
      orb.set('working', 'Preparing the draft for your review.');
      await wait(1200);
      orb.set('speaking');
      await addAiMsg([
        'Done. The draft is saved to <strong>Project Meridian · Outbox</strong>. Review it, change anything, and send it yourself when you\u2019re ready.',
        { html: `<div class="card thread-card draft-card">
            <div class="card-kicker"><span class="card-title">Draft — awaiting your review</span><span class="badge-pill">Not sent</span></div>
            <p class="draft-subject">${preview.split('\n')[0]} · ${preview.split('\n')[1]}</p>
            <div class="draft-body">${preview.split('\n\n')[1]}</div>
          </div>`, speak: 'The draft is saved to your outbox. Nothing was sent.' },
      ]);
    } else if (verdict === 'edit') {
      orb.set('speaking');
      await addAiMsg(['Of course. Tell me what to change — I\u2019ll revise the draft before anything is saved.']);
    } else if (verdict === 'snooze') {
      orb.set('speaking');
      await addAiMsg(['No problem — the draft idea is parked. Say the word and I\u2019ll prepare it again; nothing was written or sent.']);
    } else {
      orb.set('speaking');
      await addAiMsg(['Declined — no draft created, nothing saved. The decision stands on its own.']);
    }
  }

  /* memory consent */
  const memItems = [
    { text: `Decision (Aug 2): ${chosen.toLowerCase()}.`, project: 'Project Meridian', date: TODAY },
    { text: 'Fact: ThaiPack quote rev 7 raised unit price 4.2%; SiamFlex lead time now 3 weeks.', project: 'Project Meridian', date: TODAY },
    { text: 'Preference: you want written confirmation before finalizing any supplier.', project: 'Project Meridian', date: TODAY },
  ];
  const keptRaw = await askMemoryConsent(memItems, 'Project Meridian');
  wb.clearAction();
  const memSnoozed = keptRaw === 'snooze';
  const kept = memSnoozed ? [] : keptRaw;
  kept.forEach(k => keptMemories.push(k));
  if (kept.length) saveKept();

  /* continuity: update the project story */
  const meridian = PROJECTS.find(p => p.id === 'meridian');
  meridian.lastTouched = 'Today';
  meridian.log.unshift({
    date: TODAY,
    text: `Session: reviewed changes, compared suppliers, you chose “${chosen}.”${approvedAction ? ` Draft to ${approvedAction} saved to outbox.` : ''}${kept.length ? ` ${kept.length} item${kept.length > 1 ? 's' : ''} saved to memory.` : ' No memory saved.'}`,
  });
  meridian.continueText = approvedAction
    ? `Send the reviewed draft to ${approvedAction}. When the written confirmation lands, the shortlist is done.`
    : pick === 2
      ? 'Revisit the shortlist decision Monday — it\u2019s still due Friday.'
      : 'Confirm SiamFlex\u2019s MOQ in writing, then finalize the shortlist.';
  if (pick === 0) meridian.openCount = 1;

  wb.finish();

  orb.set('speaking');
  genUI.brief({
    title: 'Leaving Meridian clearer than we found it',
    rows: [
      { icon: ICONS.change, tag: 'What changed', text: `You decided: <strong style="font-weight:500">${chosen}</strong>.` },
      { icon: ICONS.open, tag: 'Still open', text: 'SiamFlex MOQ — unverified until it arrives in writing.' },
      { icon: ICONS.arrow, tag: 'Where to continue', text: meridian.continueText },
    ],
    foot: memSnoozed
      ? 'Memory consent is still waiting above — nothing saved yet.'
      : kept.length
        ? `${kept.length} item${kept.length > 1 ? 's' : ''} kept in Meridian\u2019s story — review anytime in Memory.`
        : 'Nothing saved to memory — your call, always.',
    onOpen: () => { showView('projects'); openProject('meridian'); },
  });
  await addAiMsg([
    memSnoozed
      ? 'The summary is above, and the memory question is still open whenever you want it. Tomorrow, I\u2019ll start from exactly here.'
      : kept.length
        ? `I kept <strong>${kept.length} item${kept.length > 1 ? 's' : ''}</strong> in Meridian\u2019s story — review or delete them anytime in Memory. Tomorrow, I\u2019ll start from exactly here.`
        : 'As you asked, I saved nothing to memory. Tomorrow we\u2019ll reconstruct from the project record alone — your call, always.',
  ], { stagger: 380 });
  setChips(FOLLOWUP_CHIPS.meridian);
  await orb.doneThen('idle', 1800);
}

/* ============================================================
   SCENARIO 2 — Compare suppliers (adaptive surface only)
   ============================================================ */
async function scenarioCompare() {
  orb.set('thinking');
  showTyping();
  await wait(1100);
  await addAiMsg(['Pulling the comparison back up. Everything below is sourced — check the confidence dots.']);

  wb.start('Compare ThaiPack vs. SiamFlex');
  wb.setSteps([
    { id: 'c1', name: 'Load verified facts' },
    { id: 'c2', name: 'Build comparison surface' },
  ]);
  orb.set('working');
  wb.stepState('c1', 'active');
  await wait(900);
  wb.addEvidence([
    { level: 'verified', text: 'ThaiPack unit price +4.2% (quote rev 7).', meta: 'Your note · Jul 29' },
    { level: 'verified', text: 'SiamFlex lead time 3 weeks (was 5).', meta: 'Connected email · Jul 30' },
    { level: 'unverified', text: 'SiamFlex recycled-line MOQ — call only.', meta: 'Could not verify' },
  ]);
  wb.stepState('c1', 'done');
  wb.stepState('c2', 'active');
  await wait(1000);
  genUI.surface('Comparison', `
    <table class="mini-table">
      <tr><th></th><th>ThaiPack</th><th>SiamFlex</th></tr>
      <tr><td class="lead">Unit price</td><td>+4.2% <span class="tag-worse">rising</span></td><td>Stable <span class="tag-better">steady</span></td></tr>
      <tr><td class="lead">Lead time</td><td>2 weeks <span class="tag-better">faster</span></td><td>3 weeks <span class="tag-better">↓ from 5</span></td></tr>
      <tr><td class="lead">MOQ</td><td>5,000</td><td>8,000 <span class="tag-na">unverified</span></td></tr>
      <tr><td class="lead">Recycled line</td><td><span class="tag-na">None</span></td><td>Yes <span class="tag-better">meets rule</span></td></tr>
      <tr><td class="lead">Relationship</td><td>Incumbent, 3 yrs</td><td>New — reference checks pending</td></tr>
    </table>`);
  wb.setSurface('Comparison');
  wb.stepState('c2', 'done');
  orb.set('speaking');
  const comparePlain = await addAiMsg([
    'The honest read: SiamFlex wins on trajectory and sustainability; ThaiPack still wins on speed and proven volume. The single biggest unknown is SiamFlex\u2019s MOQ — one written line settles it.',
    { html: `<div class="card thread-card"><div class="card-kicker"><span class="card-title">Read of the table</span>${confidenceHtml('Moderate', 2)}</div><p>Two of five rows rest on verified sources only; the MOQ row is unverified and flagged as such.</p></div>`, speak: 'Two rows are verified. The MOQ row is not.' },
    'Next safe step: get SiamFlex\u2019s MOQ in writing before the Friday decision.',
  ], { stagger: 380 });
  speech.speak(comparePlain);
  if (settings.mode === 'voice') genUI.voiceReply(comparePlain);
  wb.finish();
  setChips(FOLLOWUP_CHIPS.meridian);
  await orb.doneThen('idle', 1400);
}

/* ============================================================
   SCENARIO 3 — Plan surface (Phuket relocation milestones)
   ============================================================ */
async function scenarioPlan() {
  orb.set('thinking');
  showTyping();
  await wait(1100);
  await addAiMsg(['Here\u2019s the move as a living plan — milestones, one blocker, and the next safe step.']);

  wb.start('Phuket relocation — where the plan stands');
  wb.setSteps([
    { id: 'p1', name: 'Load the project story' },
    { id: 'p2', name: 'Render milestone surface' },
    { id: 'p3', name: 'Identify blockers' },
  ]);
  orb.set('working');
  wb.stepState('p1', 'active');
  await wait(900);
  wb.addEvidence([
    { level: 'verified', text: '3 new Bang Tao condo listings from your agent.', meta: 'Connected email · Aug 1' },
    { level: 'verified', text: 'School survey due Aug 10.', meta: 'School portal · your note' },
    { level: 'inferred', text: 'Weekend viewings assumed from your calendar gaps.', meta: 'Inferred from calendar' },
  ]);
  wb.stepState('p1', 'done');
  wb.stepState('p2', 'active');
  await wait(1000);
  genUI.surface('Milestones', `
    <div class="milestones">
      <div class="milestone"><span class="ms-dot done"></span><div><p class="ms-name">Work permit &amp; visa transfer</p><p class="ms-meta">Done · Jul 20</p></div></div>
      <div class="milestone"><span class="ms-dot done"></span><div><p class="ms-name">Housing shortlist — 3 Bang Tao listings</p><p class="ms-meta">Done · Aug 1</p></div></div>
      <div class="milestone"><span class="ms-dot active"></span><div><p class="ms-name">Book condo viewings</p><p class="ms-meta">Next · needs your weekend availability</p></div></div>
      <div class="milestone"><span class="ms-dot blocked"></span><div><p class="ms-name">School survey</p><p class="ms-meta">Blocked · your answers needed · due Aug 10</p></div></div>
      <div class="milestone"><span class="ms-dot"></span><div><p class="ms-name">Mover quotes</p><p class="ms-meta">Pending · starts after viewings</p></div></div>
    </div>`);
  wb.setSurface('Milestones');
  await wait(800);
  wb.stepState('p2', 'done');
  wb.stepState('p3', 'active');
  await wait(800);
  wb.stepState('p3', 'done');
  orb.set('speaking');
  const planPlain = await addAiMsg([
    'Two milestones are done, one is <strong>blocked by you</strong> (the school survey), and the critical path runs through the viewings. Booking viewings this weekend keeps the Sep 12–20 window comfortable.',
    'Tell me which weekend day works, and I\u2019ll draft the viewing request to your agent — with your approval before anything is sent.',
  ], { stagger: 380 });
  speech.speak(planPlain);
  if (settings.mode === 'voice') genUI.voiceReply(planPlain);
  wb.finish();
  setChips(FOLLOWUP_CHIPS.phuket);
  await orb.doneThen('idle', 1400);
}

/* ============================================================
   SCENARIO 4 — Open decisions (trade-off surface)
   ============================================================ */
async function scenarioDecisions() {
  orb.set('thinking');
  showTyping();
  await wait(1100);
  await addAiMsg(['You have decisions open across two projects. Here they are with trade-offs — and what I\u2019d do, marked as a recommendation, not a verdict.']);

  wb.start('Open decisions across your projects');
  wb.setSteps([
    { id: 'd1', name: 'Collect open decisions' },
    { id: 'd2', name: 'Rank by urgency' },
  ]);
  orb.set('working');
  wb.stepState('d1', 'active');
  await wait(1000);
  wb.addEvidence([
    { level: 'verified', text: 'Meridian shortlist due Fri, Aug 7.', meta: 'Project record' },
    { level: 'verified', text: 'School survey due Aug 10.', meta: 'School portal · your note' },
  ]);
  wb.stepState('d1', 'done');
  wb.stepState('d2', 'active');
  await wait(900);
  genUI.surface('Trade-offs', `
    <table class="mini-table">
      <tr><th>Decision</th><th>Due</th><th>Cost of waiting</th></tr>
      <tr><td class="lead">Meridian supplier shortlist</td><td>Fri, Aug 7</td><td>Loses SiamFlex pricing window <span class="tag-worse">high</span></td></tr>
      <tr><td class="lead">Condo viewing day</td><td>This week</td><td>Push move into school term <span class="tag-worse">medium</span></td></tr>
      <tr><td class="lead">Events variance sign-off</td><td>Aug 14</td><td>Pre-read goes out late <span class="tag-na">low</span></td></tr>
    </table>`);
  wb.setSurface('Trade-offs');
  wb.stepState('d2', 'done');
  orb.set('speaking');
  const decPlain = await addAiMsg([
    'Urgency order: <strong>Meridian first</strong> (a pricing window closes), then the viewing day, then the variance sign-off. Reorder it any way you like; you decide, I organize.',
    'Start with Meridian — ask me “what matters now in Meridian” and we\u2019ll close the shortlist together.',
  ], { stagger: 380 });
  speech.speak(decPlain);
  if (settings.mode === 'voice') genUI.voiceReply(decPlain);
  wb.finish();
  setChips(FOLLOWUP_CHIPS.decisions);
  await orb.doneThen('idle', 1400);
}

/* ============================================================
   FALLBACK — clarify together (conversation that leads somewhere)
   ============================================================ */
async function scenarioClarify(text) {
  orb.set('thinking');
  showTyping();
  await wait(1300);
  orb.set('speaking');
  const plain = await addAiMsg([
    `Here\u2019s what I heard: <strong>“${escapeHtml(text)}”</strong>. I want to make sure I help with the right thing before I start any work.`,
    'Which of these is closest to what you need?',
    { html: `<div class="card thread-card"><div class="opt-list">
        <button class="opt" data-clarify="matters"><span>Turn it into clear next steps in a project</span>${ICONS.arrow}</button>
        <button class="opt" data-clarify="decisions"><span>Show my open decisions and trade-offs</span>${ICONS.arrow}</button>
        <button class="opt" data-clarify="plan"><span>Look at a plan and its milestones</span>${ICONS.arrow}</button>
      </div></div>`, speak: 'Which of these is closest?' },
  ], { stagger: 320 });
  speech.speak(plain);
  $$('[data-clarify]', thread).forEach(b => b.addEventListener('click', () => {
    const intent = b.dataset.clarify;
    addUserMsg(b.querySelector('span').textContent);
    route(intent === 'matters' ? 'what matters now in meridian' : intent === 'decisions' ? 'show my open decisions' : 'plan the phuket move', 'en');
  }, { once: true }));
  await orb.doneThen('idle', 900);
}

/* ============================================================
   ROUTER — intent matching for the simulation
   ============================================================ */
const THAI_RE = /[\u0E00-\u0E7F]/;

function route(text, detectedLang) {
  const t = text.toLowerCase();
  const lang = detectedLang || (THAI_RE.test(text) ? 'th' : 'en');
  const run = async () => {
    beginRun();
    try {
      if (/matters|focus|meridian|today|priority|priorities|สรุป|เปลี่ยนแปลง|สำคัญ|วันนี้/.test(t)) await scenarioMattersNow(lang);
      else if (/compare|supplier|vendor|thaipack|siamflex|เปรียบเทียบ/.test(t)) await scenarioCompare();
      else if (/plan|phuket|move|relocat|milestone|ย้าย|ภูเก็ต/.test(t)) await scenarioPlan();
      else if (/decision|decide|open|trade-?off|choose|ตัดสินใจ/.test(t)) await scenarioDecisions();
      else await scenarioClarify(text);
    } catch (e) {
      if (e === INTERRUPT) {
        interruptFlag = false; // clear so the recovery message itself can render
        hideTyping();
        orb.set('interrupted');
        wb.interrupted();
        speech.cancelSpeak();
        await addAiMsg(['Stopped. <strong>Nothing was sent or saved</strong> — anything incomplete stays exactly as you see it in the panel. Tell me where to pick up, or start something new.']);
        await wait(1400);
        orb.set('recovery');
        await wait(1300);
        orb.set('idle');
      } else {
        console.error(e);
        orb.set('idle');
      }
    } finally {
      endRun();
    }
  };
  run();
}

/* ============================================================
   CHIPS / COMPOSER / VOICE wiring
   ============================================================ */
const INITIAL_CHIPS = [
  { label: 'What matters now in Project Meridian?', send: 'What matters now in Project Meridian today?' },
  { label: '🇹🇭 สรุปว่าวันนี้ Meridian มีอะไรสำคัญบ้าง', send: 'สรุปว่าวันนี้ Meridian มีอะไรสำคัญบ้าง' },
  { label: 'Compare the two suppliers', send: 'Compare the two suppliers' },
  { label: 'Plan the Phuket move', send: 'Plan the Phuket move' },
  { label: 'Show my open decisions', send: 'Show my open decisions' },
];
const FOLLOWUP_CHIPS = {
  meridian: [
    { label: 'Compare the suppliers again', send: 'Compare the two suppliers' },
    { label: 'Show my open decisions', send: 'Show my open decisions' },
    { label: 'Open Project Meridian →', goto: 'projects', project: 'meridian' },
  ],
  phuket: [
    { label: 'Saturday works for viewings', send: 'Saturday works for the condo viewings' },
    { label: 'Show my open decisions', send: 'Show my open decisions' },
    { label: 'Open Phuket Relocation →', goto: 'projects', project: 'phuket' },
  ],
  decisions: [
    { label: 'Start with Meridian', send: 'What matters now in Project Meridian today?' },
    { label: 'Plan the Phuket move', send: 'Plan the Phuket move' },
  ],
};

function setChips(chips) {
  const box = $('#chips');
  box.innerHTML = '';
  chips.forEach(c => {
    const b = el(`<button class="chip">${c.label}</button>`);
    b.addEventListener('click', () => {
      if (engine.running) return;
      if (c.goto) { showView(c.goto); if (c.project) openProject(c.project); return; }
      submitUserText(c.send);
    });
    box.appendChild(b);
  });
}

function submitUserText(text) {
  if (!text.trim() || engine.running) return;
  addUserMsg(text);
  $('#composerInput').value = '';
  route(text);
}

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  submitUserText($('#composerInput').value);
});

$('#stopBtn').addEventListener('click', () => { if (engine.running) interruptFlag = true; });
$('#stopBtnChat').addEventListener('click', () => { if (engine.running) interruptFlag = true; });
$('#composerInput').addEventListener('input', () => { if (window.orbFX) window.orbFX.nudge(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && engine.running) interruptFlag = true; });

/* mic: real speech recognition when available, simulated otherwise.
   One engine, two front doors: the chat-mode mic button and the
   voice-mode voice bar. */
const CANNED_VOICE = {
  en: 'What matters now in Project Meridian today?',
  th: 'สรุปว่าวันนี้ Meridian มีอะไรสำคัญบ้าง',
};
let micActive = false;

function wireMic(btn, { setStatus, echo }) {
  btn.addEventListener('click', () => {
    if (engine.running || micActive) { speech.stop(); return; }
    micActive = true;
    let simulating = false;
    btn.classList.add('listening');
    orb.set('listening');
    setStatus && setStatus('Listening…');

    const finish = (transcript) => {
      micActive = false;
      simulating = false;
      btn.classList.remove('listening');
      if (transcript) {
        orb.set('idle');
        setStatus && setStatus('Got it — thinking.');
        submitUserText(transcript);
      } else {
        orb.set('idle', 'I didn\u2019t catch that — try again, or type below.');
        setStatus && setStatus('I didn\u2019t catch that — tap to try again.');
      }
    };

    const started = speech.listen({
      onResult: (t) => { echo && echo(t); finish(t); },
      onEnd: () => { if (micActive && !simulating) finish(null); },
      onError: () => { if (micActive && !simulating) { simulating = true; simulateVoice(finish); } },
    });
    if (!started) { simulating = true; simulateVoice(finish); }

    function simulateVoice(done) {
      // simulated listening: canned transcript, typed out character by character
      const phrase = CANNED_VOICE[settings.lang] || CANNED_VOICE.en;
      echo && echo('');
      let i = 0;
      const iv = setInterval(() => {
        if (!micActive) { clearInterval(iv); return; }
        echo && echo(phrase.slice(0, ++i));
        if (i >= phrase.length) { clearInterval(iv); setTimeout(() => done(phrase), 500); }
      }, 34);
    }
  });
}

/* chat mode: mic inside the composer, transcript lands in the input */
wireMic($('#micBtn'), { echo: (t) => { $('#composerInput').value = t; } });

/* voice mode: the big mic, transcript lands in the voice bar */
wireMic($('#voiceMic'), {
  setStatus: (s) => { $('#voiceStatus').textContent = s; },
  echo: (t) => { $('#voiceTranscript').textContent = t ? `“${t}”` : ''; },
});

/* ============================================================
   VIEWS — navigation, projects, memory, settings
   ============================================================ */
function showView(name) {
  $$('.view').forEach(v => v.classList.remove('active'));
  $(`#view-${name}`).classList.add('active');
  $$('.sb-link').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (name === 'projects') renderProjects();
  if (name === 'memory') renderMemory();
}

$$('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

/* ---------- Sidebar collapse ---------- */
const SB_KEY = 'proteus.sidebar.v1';
const sidebar = $('#sidebar');
try { if (localStorage.getItem(SB_KEY) === 'collapsed') sidebar.classList.add('collapsed'); } catch (_) {}
$('#sbToggle').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  $('#sbToggle').setAttribute('aria-expanded', !sidebar.classList.contains('collapsed'));
  try { localStorage.setItem(SB_KEY, sidebar.classList.contains('collapsed') ? 'collapsed' : 'expanded'); } catch (_) {}
});

/* ---------- Projects ---------- */
function renderProjects() {
  $('#projectListPage').hidden = false;
  $('#projectDetailPage').hidden = true;
  const grid = $('#projectGrid');
  grid.innerHTML = '';
  PROJECTS.forEach(p => {
    const card = el(`<button class="project-card">
      <span class="project-ico tint-${p.tint}"></span>
      <span class="badge-pill" style="align-self:flex-start">${p.kind}</span>
      <span class="project-name">${p.name}</span>
      <span class="project-summary">${p.summary}</span>
      <span class="project-meta"><span>Touched ${p.lastTouched}</span><span class="project-open">${p.openCount} open</span></span>
    </button>`);
    card.addEventListener('click', () => openProject(p.id));
    grid.appendChild(card);
  });
}

function openProject(id) {
  const p = PROJECTS.find(x => x.id === id);
  if (!p) return;
  showView('projects');
  $('#projectListPage').hidden = true;
  $('#projectDetailPage').hidden = false;

  const li = (icon, item) => `<li>${icon}<span>${item.text}${item.meta ? `<span class="li-meta">${item.meta}</span>` : ''}</span></li>`;
  $('#projectDetail').innerHTML = `
    <div class="pd-head">
      <span class="project-ico tint-${p.tint}"></span>
      <div>
        <p class="caption-uppercase pd-kicker">${p.kind} · touched ${p.lastTouched}</p>
        <h1 class="pd-title">${p.name}</h1>
      </div>
    </div>
    <p class="pd-sub">${p.summary}</p>
    <div class="pd-grid">
      <section class="pd-section"><h3>What is known</h3><ul>${p.known.map(k => li(ICONS.known, k)).join('')}</ul></section>
      <section class="pd-section"><h3>What changed</h3><ul>${p.changed.map(c => li(ICONS.change, c)).join('')}</ul></section>
      <section class="pd-section"><h3>What remains open</h3><ul>${p.open.map(o => li(ICONS.open, o)).join('')}</ul></section>
      <section class="pd-section"><h3>Story you approved</h3><ul>
        ${keptMemories.filter(m => m.project === p.name).map(m => `<li>${ICONS.checkBig}<span>${m.text}<span class="li-meta">Kept by you · ${m.date}</span></span></li>`).join('') || '<li><span style="color:var(--muted-soft)">No reviewed memory yet — Proteus will propose items after work sessions.</span></li>'}
      </ul></section>
    </div>
    <div class="pd-continue">
      <div>
        <h3>Where to continue</h3>
        <p>${p.continueText}</p>
      </div>
      <button class="btn-primary" id="pdAsk">Ask Proteus about this</button>
    </div>
    <div class="pd-log">
      <p class="caption-uppercase" style="margin-bottom:8px">Session log</p>
      ${p.log.map(l => `<div class="pd-log-item"><span class="pd-log-date">${l.date}</span><span class="pd-log-text">${l.text}</span></div>`).join('')}
    </div>`;
  $('#pdAsk').addEventListener('click', () => {
    showView('companion');
    submitUserText(p.id === 'meridian' ? 'What matters now in Project Meridian today?'
      : p.id === 'phuket' ? 'Plan the Phuket move' : 'Show my open decisions');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#projectBack').addEventListener('click', renderProjects);

/* ---------- Memory ---------- */
function renderMemory() {
  const proposed = $('#proposedMemories');
  const kept = $('#keptMemories');

  proposed.innerHTML = proposedMemories.length ? '' : '<p class="memory-empty">Nothing waiting for review. After a work session, Proteus proposes what to keep — you decide.</p>';
  proposedMemories.forEach((m, i) => {
    const item = el(`<div class="memory-item">
      <p>${m.text}</p>
      <div class="memory-meta"><span class="src">${m.project} · proposed ${m.date}</span>
        <div class="memory-actions">
          <button class="btn-primary sm" data-keep>Keep</button>
          <button class="btn-danger-ghost" data-discard>Discard</button>
        </div></div>
    </div>`);
    item.querySelector('[data-keep]').addEventListener('click', () => {
      keptMemories.push(m); proposedMemories.splice(i, 1); saveKept(); renderMemory();
    });
    item.querySelector('[data-discard]').addEventListener('click', () => {
      proposedMemories.splice(i, 1); renderMemory();
    });
    proposed.appendChild(item);
  });

  kept.innerHTML = keptMemories.length ? '' : '<p class="memory-empty">Nothing kept yet. What you keep becomes part of each project\u2019s story — and tomorrow\u2019s starting point.</p>';
  keptMemories.forEach((m, i) => {
    const item = el(`<div class="memory-item">
      <p>${m.text}</p>
      <div class="memory-meta"><span class="src">${m.project} · kept ${m.date}</span>
        <div class="memory-actions"><button class="btn-danger-ghost" data-del>Delete</button></div></div>
    </div>`);
    item.querySelector('[data-del]').addEventListener('click', () => {
      keptMemories.splice(i, 1); saveKept(); renderMemory();
    });
    kept.appendChild(item);
  });
}

/* ---------- Settings ---------- */
$('#toggleVoice').addEventListener('click', function () {
  settings.voice = !settings.voice;
  this.classList.toggle('on', settings.voice);
  this.setAttribute('aria-checked', settings.voice);
});
$$('#langSeg .seg-btn').forEach(b => b.addEventListener('click', () => {
  $$('#langSeg .seg-btn').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  settings.lang = b.dataset.lang;
  orb.set('idle', settings.lang === 'th' ? 'พิมพ์หรือพูดได้เลย — ภาษาไทยหรืออังกฤษ' : 'Speak or type below — English or Thai.');
}));
$('#resetDemo').addEventListener('click', () => {
  keptMemories = []; proposedMemories = [];
  try { localStorage.removeItem(MEM_KEY); } catch (_) {}
  renderMemory();
  orb.set('idle', 'Local data erased. Clean slate.');
});

/* ============================================================
   BOOT — greet with continuity, the product's core promise
   ============================================================ */
(async function boot() {
  setChips(INITIAL_CHIPS);
  orb.set('idle');
  await wait(700);
  showTyping();
  await wait(1100);
  hideTyping();
  const greeting = keptMemories.length
    ? `Welcome back. I remember what you chose to keep — <strong>${keptMemories.length} item${keptMemories.length > 1 ? 's' : ''}</strong> across your projects. Project Meridian still has one decision due this week. What would you like to work on?`
    : 'Welcome back. Since Tuesday, <strong>two things changed in Project Meridian</strong> and one decision is due this week. Ask me what matters — or pick a starting point below. You steer; I show my work.';
  await addAiMsg([greeting], { stagger: 200 });
})();
