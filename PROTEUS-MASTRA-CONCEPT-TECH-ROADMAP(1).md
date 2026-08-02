# PROTEUS — Product Concept, Locked Technology Stack, and Product Roadmap

**Document date:** 2 August 2026  
**Product type:** Personal AI companion for Windows  
**Core statement:** **One intelligence. Any form.**

---

## 1. Product Concept

PROTEUS is a personal AI companion that can be summoned at any time while the user is working on a Windows computer.

Its purpose is to help one person think, investigate, decide, organize, create, code, and complete meaningful work without repeatedly reconstructing context after interruptions or across different days.

PROTEUS is not only a conversational assistant. It is a persistent personal work environment where voice or text conversations can become visible plans, evidence, decisions, approvals, actions, artifacts, code changes, and reusable Project context.

The product should feel like one continuous intelligence even when different model providers, agents, workflows, tools, Skills, MCP servers, voice services, or specialist harnesses are operating behind the scenes.

### 1.1 Core experience

The primary interaction is natural voice conversation in realtime or near-realtime. Text remains a complete alternative and can be used interchangeably with voice within the same session.

The user can summon PROTEUS from anywhere on the computer, describe an outcome in ordinary language, interrupt or redirect the assistant, review what it is doing, approve consequential actions, and return to the same work later.

PROTEUS should support personal work patterns similar in spirit to Claude Cowork and ChatGPT Work:

- The user expresses the intended outcome rather than a sequence of technical commands.
- PROTEUS interprets the request and makes the work visible.
- Relevant context, files, models, tools, Skills, and Projects are brought together.
- Longer work remains observable, interruptible, and recoverable.
- Consequential actions stop for human approval.
- The final state records results, evidence, uncertainty, unresolved questions, and a clear continuation point.

### 1.2 Core capabilities

PROTEUS includes the following product capabilities:

- Realtime or near-realtime voice conversation
- Text conversation with streaming responses
- Multiple selectable model providers
- Model selection according to user preference or workload
- Generative UI that adapts to the current task
- Visible goals, plans, progress, evidence, uncertainty, and results
- Human-in-the-loop approval before consequential actions
- Interrupt, steer, pause, resume, correct, reject, retry, and stop controls
- Persistent Projects and conversations
- Continuity across interruptions, application restarts, and different days
- User-controlled personal and Project memory
- Reusable Skills
- MCP support for external tools, data, applications, and services
- Cowork-style multi-step work
- Coding Harness for software-development and repository work
- Local history, approvals, artifacts, and operational records

### 1.3 Generative UI

Generative UI allows the work surface to represent the task rather than forcing every interaction into a sequence of chat bubbles.

A conversation may produce structured surfaces such as:

- Plans and milestones
- Progress and activity views
- Evidence and source comparisons
- Decision and trade-off views
- Tables and charts
- Timelines
- Approval requests
- File and artifact previews
- Project status and continuation summaries
- Coding activity and change reviews

The UI is generated from controlled structures and approved application components. AI determines the appropriate information structure and content while the product retains authority over available interfaces and actions.

### 1.4 Human-in-the-loop approval

Human approval is a core operating principle of PROTEUS.

Approval may be required before actions such as:

- Sending, publishing, or sharing information
- Modifying external applications or services
- Creating, changing, moving, or deleting files
- Running commands or software-development actions
- Changing calendar, email, account, or organizational data
- Saving information as long-term personal memory
- Performing actions with financial, legal, privacy, security, or organizational impact

An approval request should identify the intended action, affected target, expected result, important risks, and whether the action can be reversed.

### 1.5 Projects and continuity

A Project represents an ongoing responsibility, investigation, goal, activity, or body of work.

A Project is more than a folder or chat thread. It is the reviewed story of what the user is trying to accomplish.

A Project may retain:

- Purpose and desired outcome
- Current state
- Important conversations
- Plans and tasks
- Decisions and corrections
- Evidence and sources
- Files and generated artifacts
- Open questions and blockers
- Pending approvals
- Recommended next action

Returning to a Project should reveal what is known, what changed, what remains unresolved, and where meaningful work can continue.

### 1.6 Memory

Memory remains under user control and is separated into clear categories:

- **Session context:** Temporary context for the current interaction
- **Project memory:** Reviewed context associated with one Project
- **Personal memory:** User-approved preferences or facts that may be used across Projects
- **Operational history:** Records of runs, tools, approvals, failures, and results

PROTEUS should not silently convert every conversation into permanent memory. Long-term memories must remain reviewable, correctable, removable, and traceable to their origin.

### 1.7 Skills and MCP

Skills provide reusable domain capabilities, operating knowledge, instructions, and task expertise.

MCP provides a standardized connection layer for external tools, applications, resources, and data sources.

Skills and MCP extend PROTEUS without placing every capability directly inside the core product.

### 1.8 Coding Harness

Coding is a specialist capability within PROTEUS rather than the identity of the entire product.

The Coding Harness supports:

- Persistent coding sessions
- Repository and workspace understanding
- File and code search
- Planning and implementation work
- Code editing
- Command and test activity
- Change review
- Context compaction and continuation
- Coding-specific model selection
- Coding Skills and extensions
- Streaming coding activity

Coding activity remains governed by PROTEUS permissions, workspace boundaries, approval policies, Project continuity, and memory controls.

### 1.9 Product principles

1. **Personal** — The user's context belongs to the user.
2. **Present** — PROTEUS can be summoned during real work.
3. **Conversational** — Voice and text are natural and interruptible interfaces.
4. **Visible** — Goals, progress, evidence, uncertainty, and pending decisions remain understandable.
5. **Controlled** — Consequential actions and long-term memory remain subject to user approval.
6. **Correctable** — The user can steer, revise, reject, undo, or delete.
7. **Continuous** — Projects can continue across interruptions and days.
8. **Extensible** — Models, Skills, MCP servers, tools, and specialist harnesses can evolve independently.
9. **Calm** — The product reduces cognitive load rather than creating more noise.
10. **Honest** — PROTEUS distinguishes facts, inferences, actions, failures, and uncertainty.

### 1.10 Product boundaries

PROTEUS is not initially intended to be:

- A multi-user collaboration platform
- A social network
- An always-listening surveillance system
- An invisible autonomous computer operator
- A system that stores every interaction permanently
- A fully autonomous replacement for user judgment
- A developer marketplace before the personal experience becomes trustworthy
- A coding agent with general-assistant features attached as an afterthought

---

## 2. Locked Technology Direction

The central technology decision is locked as follows:

> **Mastra is the AI Core, primary Agent Harness, workflow engine, memory layer, Skills layer, MCP layer, model orchestration layer, voice orchestration layer, and AI observability foundation of PROTEUS.**

Mastra Voice is the common voice integration layer attached to the same Mastra agents used by text, tools, memory, workflows, MCP, and approvals. It is not a standalone Voice Model; realtime or cascaded speech still depends on external voice and speech providers.

PROTEUS should not maintain a second competing AI Core or general-purpose agent framework alongside Mastra.

Specialist systems may operate beneath Mastra, but product-level control remains with PROTEUS and Mastra.

### 2.1 Selected technology stack

| Layer | Selected technology | Role in PROTEUS |
|---|---|---|
| Desktop application shell | **Electrobun** | Windows desktop runtime, application presence, native integration, packaging, and updates |
| Runtime and toolchain | **Bun** | TypeScript runtime, package management, scripts, bundling, and testing |
| Application language | **TypeScript** | Shared language across desktop, AI orchestration, tools, schemas, data, and UI |
| User interface | **React** | Main application interface and task-specific work surfaces |
| AI Core | **Mastra** | Primary AI application framework and orchestration foundation |
| Main Agent Harness | **Mastra AgentController** | Persistent interactive sessions, modes, model selection, tools, permissions, subagents, state, and event streams |
| Agent runtime | **Mastra Agents** | General conversational, reasoning, research, work, and specialist agents |
| Durable work | **Mastra Workflows** | Multi-step work, persistence, suspension, resumption, recovery, and human checkpoints |
| Human approval | **Mastra approval capabilities with PROTEUS policy controls** | Approval requests, suspended actions, decisions, and continuation |
| Tools | **Mastra Tools** | Structured capabilities and controlled action execution |
| Skills | **Mastra Skills and Workspace capabilities** | Reusable task knowledge, operating instructions, and specialist capabilities |
| MCP | **Mastra MCP** | Connections to MCP tools, resources, applications, and services |
| Memory | **Mastra Memory with PROTEUS memory governance** | Session, Project, and personal context under user-controlled retention rules |
| Model-provider orchestration | **Mastra model-provider layer** | Selection and use of multiple hosted, gateway, compatible, and local model providers |
| Generative UI data layer | **Mastra state, structured outputs, and event streams** | Structured information for adaptive work surfaces and live activity |
| Coding Harness | **Pi Coding Agent under Mastra supervision** | Specialist repository, coding, command, test, extension, and compaction capabilities |
| Voice orchestration | **Mastra Voice** | Common voice interface, provider connection, streaming audio events, speech input and output, and attachment of voice to existing Mastra agents |
| Realtime speech-to-speech | **OpenAI Realtime as the primary provider, with Gemini Live and Inworld Realtime as provider options** | Low-latency bidirectional speech, natural turn handling, interruption, barge-in, and voice-enabled tool use |
| Cascaded near-realtime voice | **Provider-independent STT, Mastra Agent, and TTS pipeline** | Flexible speech recognition, model reasoning, tool and workflow execution, and speech synthesis using independently selectable providers |
| Local persistence | **SQLite / LibSQL** | Projects, conversations, memory, workflows, approvals, evidence, artifacts, and history |
| Data access | **Drizzle ORM** | Typed local data model and persistence layer |
| Runtime validation | **Zod** | Validation of tools, model outputs, events, approvals, and UI structures |
| Interaction state | **XState** | Explicit application states for listening, thinking, working, interruption, approval, recovery, and completion |
| Application state | **Zustand** | Local interface and application state outside durable Mastra workflows |
| Secret protection | **Windows credential protection through the desktop runtime** | Protection of provider credentials and sensitive configuration |
| Observability | **Mastra observability and OpenTelemetry** | Visibility into agents, workflows, tools, models, latency, failures, and usage |
| Automated testing | **Bun Test and Playwright** | Product, integration, workflow, and desktop interaction validation |

### 2.2 Mastra responsibilities

Mastra is responsible for the principal AI operating capabilities of PROTEUS:

- Agent lifecycle
- Persistent interactive sessions
- Conversation threads
- Interaction modes
- Model-provider selection
- Tool calling
- Skills
- MCP connections
- Memory retrieval and retention services
- Multi-step workflows
- Human approval checkpoints
- Suspend and resume behavior
- Specialist agents and subagents
- Structured outputs
- Streaming state and events
- Voice attachment and provider orchestration through Mastra Voice
- Voice-enabled access to the same tools, context, and agent capabilities
- Tracing and observability

Mastra is the shared control plane across voice, text, Cowork-style tasks, Projects, Skills, MCP, and specialist harnesses.

### 2.3 PROTEUS responsibilities

PROTEUS remains responsible for product-level meaning and user control:

- Product identity and personal companion behavior
- Project continuity
- Memory review and consent rules
- Permission and approval policies
- Presentation of evidence and uncertainty
- Generative work surfaces
- Voice and desktop presence
- Artifact management
- User-visible activity and history
- Local privacy and deletion controls
- Boundaries applied to Skills, MCP, tools, and Coding Harnesses

Mastra supplies the AI operating foundation. PROTEUS defines the trusted personal product built on top of that foundation.

### 2.4 Voice architecture

Mastra Voice is the locked voice orchestration layer of PROTEUS.

It attaches speech capabilities to the same Mastra agents that already hold instructions, tools, memory access, workflows, Skills, MCP connections, and Project context. Voice does not create a second assistant, a separate AI Core, or an independent source of truth.

Mastra Voice remains distinct from the external provider that recognizes or generates speech:

- **Mastra AgentController and Mastra Agents** retain session continuity, reasoning context, tools, memory, workflows, and approval state.
- **Mastra Voice** manages the common voice interface, provider connection, audio streams, transcripts, speech events, and voice interaction lifecycle.
- **Voice and speech providers** perform speech recognition, speech synthesis, or direct speech-to-speech processing.
- **PROTEUS Desktop** manages microphone and speaker access, summon behavior, interruption controls, and user-visible voice state.

PROTEUS supports two complementary voice paths.

#### Realtime speech-to-speech

```text
Microphone
↔ Realtime Voice Provider
↔ Mastra Agent and Tools
↔ Speaker
```

This path prioritizes low latency, continuous conversation, natural turn handling, and interruption. OpenAI Realtime is the primary provider direction, while Gemini Live, Inworld Realtime, and future compatible providers may be selected through the voice-provider layer.

#### Cascaded near-realtime voice

```text
Microphone
→ Speech-to-Text Provider
→ Mastra AgentController and Selected Model
→ Tools, Workflows, Memory, MCP, and Approval
→ Text-to-Speech Provider
→ Speaker
```

This path preserves independent selection of speech recognition, reasoning model, and speech synthesis providers. It is suitable when provider flexibility, deeper work, explicit transcripts, durable workflows, or controlled approval transitions matter more than direct speech-to-speech latency.

Both paths remain part of the same PROTEUS session and Project. Voice interactions therefore retain the same model visibility, memory rules, permission boundaries, Human-in-the-loop approval, operational history, interruption, and continuation behavior as text interactions.

### 2.5 Coding Harness relationship

Pi Coding Agent is a delegated specialist beneath Mastra rather than a second general AI Core.

The relationship is defined as:

```text
PROTEUS
└── Mastra AgentController
    ├── General Agents
    ├── Workflows
    ├── Memory
    ├── Skills
    ├── MCP
    ├── Tools and Approvals
    └── Coding Mode
        └── Pi Coding Agent
```

Mastra coordinates the user session, Project, permissions, approvals, model context, and overall work state. Pi provides coding-specific capabilities within the boundaries established by PROTEUS and Mastra.

### 2.6 Model-provider strategy

PROTEUS is model-provider independent at the product level.

Mastra is the common orchestration layer across provider categories such as:

- OpenAI
- Anthropic
- Google
- xAI
- Mistral
- DeepSeek
- High-speed inference providers
- OpenAI-compatible APIs
- Model gateways
- Local models through compatible runtimes

Provider and model choice may differ by workload:

- Realtime voice
- General conversation
- Planning and reasoning
- Fast lightweight work
- Long-context investigation
- Structured extraction
- Coding
- Vision and document understanding

The selected provider and model remain visible to the user without changing the identity of PROTEUS or the continuity of a Project.

### 2.7 Logical product architecture

PROTEUS is organized into the following logical layers:

1. **Desktop Presence Layer**  
   Application lifecycle, summon behavior, microphone access, notifications, and Windows integration.

2. **Conversation and Voice Layer**  
   Mastra Voice orchestration, realtime speech-to-speech, cascaded near-realtime voice, text, streaming output, transcripts, interruption, and turn management.

3. **Generative Work Surface**  
   Conversations, plans, progress, evidence, approvals, artifacts, Project state, and task-specific interfaces.

4. **Mastra Agent Control Layer**  
   AgentController sessions, modes, agents, model selection, subagents, permissions, and live event streams.

5. **Mastra Workflow and Approval Layer**  
   Durable work, suspension, resumption, human decisions, retries, recovery, and operational history.

6. **Mastra Capability Layer**  
   Tools, Skills, MCP, memory services, and specialist agents.

7. **Coding Harness Layer**  
   Pi-based coding sessions governed by Mastra and PROTEUS permissions.

8. **Project and Memory Layer**  
   Projects, reviewed memory, evidence, decisions, artifacts, unresolved work, and continuation state.

9. **Provider Layer**  
   Model providers, realtime voice providers, speech-to-text services, text-to-speech services, local models, and provider routing.

10. **Local Trust Layer**  
    Credentials, permissions, approvals, audit history, recovery, privacy controls, and deletion controls.

---

## 3. Product Roadmap

The roadmap is organized by product capability and user outcome. Each phase expands the same personal companion rather than creating separate products.

### Phase 1 — Personal Companion Foundation

**Goal:** Establish PROTEUS as a summonable and persistent personal AI companion on Windows.

**Scope:**

- Windows desktop presence
- Voice and text conversation
- Mastra Voice orchestration
- Realtime speech-to-speech and cascaded near-realtime voice paths
- Realtime or near-realtime response streaming
- Voice transcripts, interruption, barge-in, and stop controls
- Mastra AgentController session foundation
- Multiple model-provider selection
- Persistent conversations
- Basic Project association
- Visible active model and session state
- Local conversation history

**Phase outcome:**

The user can summon PROTEUS, speak or type naturally, select a model provider, interrupt the assistant, and return to an existing conversation or Project.

---

### Phase 2 — Generative Work Surface

**Goal:** Move beyond chat into interfaces that represent the work itself.

**Scope:**

- Structured plans
- Progress and activity streams
- Evidence and source presentation
- Tables, comparisons, timelines, and summaries
- Task-specific generative UI surfaces
- Structured Mastra outputs and live events
- Artifact presentation
- Visible uncertainty and blocked states
- Consistent correction and interruption across generated surfaces

**Phase outcome:**

A conversation can become an understandable work surface that communicates the goal, current activity, evidence, uncertainty, outputs, and next decisions.

---

### Phase 3 — Cowork Mode and Human Approval

**Goal:** Enable bounded multi-step work while preserving user control.

**Scope:**

- Mastra-driven multi-step work sessions
- Durable workflows
- Pause and resume across application restarts
- Tool execution
- Human approval requests
- Approve, edit, reject, cancel, and retry decisions
- Action previews
- Operational history and audit records
- Failure recovery
- Work summaries and continuation state

**Phase outcome:**

PROTEUS can perform meaningful Cowork-style tasks, remain visible while working, stop before consequential actions, and resume after user input or interruption.

---

### Phase 4 — Projects, Memory, Skills, and MCP

**Goal:** Make PROTEUS increasingly useful across days without silently accumulating uncontrolled context.

**Scope:**

- Rich Project state
- Project summaries and continuation views
- Open questions, decisions, tasks, evidence, and artifacts
- Mastra Memory integration
- Memory proposals and user review
- Personal and Project memory separation
- Memory correction and deletion
- Mastra Skills
- Skill discovery and activation
- Mastra MCP connections
- Permission scopes for Skills and MCP tools
- Cross-session context retrieval

**Phase outcome:**

The user can return to important work without reconstructing the full story while retaining clear authority over memory and connected capabilities.

---

### Phase 5 — Coding Harness

**Goal:** Add a first-class software-development capability without turning PROTEUS into a coding-only product.

**Scope:**

- Coding Mode coordinated by Mastra AgentController
- Pi Coding Agent as the specialist Coding Harness
- Persistent repository sessions
- Coding-specific model selection
- Repository and workspace boundaries
- File, search, edit, command, and test activity
- Coding Skills and extensions
- Session compaction and continuation
- Streaming coding events
- Change summaries and review surfaces
- Approval gates for commands, changes, and consequential operations
- Coding results linked to Projects

**Phase outcome:**

PROTEUS can delegate software-development work to a specialist Coding Harness while retaining the same conversation, permissions, approvals, memory rules, and Project continuity.

---

### Phase 6 — Reliability and Daily Operating Layer

**Goal:** Mature PROTEUS from a capable personal system into a dependable daily work companion.

**Scope:**

- Recovery from crashes, provider failures, and interrupted runs
- Model and provider fallback policies
- Cost, latency, and usage visibility
- Voice quality, turn detection, interruption, and barge-in reliability
- Realtime and cascaded voice-provider fallback policies
- Long-running workflow stability
- Tool, Skill, and MCP trust controls
- Memory quality review
- Evaluation and regression tracking
- Local data backup and export
- Privacy and deletion controls
- Application updating and release management
- Performance optimization

**Phase outcome:**

PROTEUS becomes reliable enough for recurring real work with predictable recovery, understandable costs, controlled memory, trustworthy approvals, and stable Project continuity.

---

### Phase 7 — Expanded Personal Work Ecosystem

**Goal:** Extend the range of personal work while preserving the original product boundaries.

**Scope:**

- Additional productivity integrations
- Additional MCP ecosystems
- More specialized Skills and agents
- Additional specialist harnesses beneath Mastra
- Cross-Project search and synthesis
- User-approved background work
- Scheduled or condition-based personal workflows
- Expanded local-model and offline capabilities
- Optional encrypted synchronization across the user's own devices
- Broader artifact creation and review

**Phase outcome:**

PROTEUS becomes a flexible personal work environment across multiple responsibilities while remaining personal, visible, correctable, and controlled.

---

## 4. Locked Product Definition

PROTEUS is a Windows-first personal AI companion centered on realtime or near-realtime voice, text conversation, Generative UI, visible Cowork-style work, human approval, persistent Projects, user-controlled memory, Skills, MCP, multiple model providers, and a specialist Coding Harness.

Mastra is the single primary AI Core and Agent Harness of the product.

Mastra AgentController coordinates interactive sessions, modes, agents, model selection, tools, permissions, subagents, and live product state. Mastra Workflows govern durable multi-step work and human checkpoints. Mastra Memory, Skills, MCP, model integrations, and observability form the common AI capability layer.

Mastra Voice is the common voice orchestration layer attached to those same agents. It is not a Voice Model of its own. PROTEUS uses external realtime or speech providers beneath Mastra Voice and supports both direct realtime speech-to-speech and cascaded speech-to-text, agent, and text-to-speech interaction paths. Both paths remain governed by the same Project context, tools, memory rules, permissions, approvals, and operational history.

Pi Coding Agent operates as a specialist Coding Harness beneath Mastra. It does not replace Mastra and does not independently control Project continuity, permissions, approvals, or long-term memory.

PROTEUS is successful when the user can summon one personal intelligence from anywhere on the computer, speak naturally, see the work take shape, select the model and capabilities being used, approve meaningful actions, return to important Projects without reconstructing context, and perform coding work without leaving the continuity and control of the main companion.

The central daily loop remains:

1. Ask naturally.
2. Understand the intended outcome together.
3. Make the work visible.
4. Keep consequential decisions with the user.
5. Preserve a reviewed continuation point for the future.
