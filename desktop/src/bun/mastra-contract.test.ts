import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toAISdkV5Messages } from "@mastra/ai-sdk/ui";
import { Agent } from "@mastra/core/agent";
import { AgentController, defaultDisplayState, type MastraDBMessage } from "@mastra/core/agent-controller";
import { TaskSignalProvider } from "@mastra/core/signals";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { LibSQLStore } from "@mastra/libsql";
import { Memory } from "@mastra/memory";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => {
      try {
        await rm(path, { recursive: true, force: true });
      } catch (error) {
        // The installed Windows libSQL driver can release its final file handle
        // after the test process exits even after storage.close().
        if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
      }
    }),
  );
});

describe("installed Mastra contracts", () => {
  it("converts persisted tool history with the official AI SDK adapter", () => {
    const stored: MastraDBMessage[] = [
      {
        id: "message-1",
        role: "assistant",
        createdAt: new Date("2026-08-04T00:00:00.000Z"),
        threadId: "thread-1",
        resourceId: "resource-1",
        content: {
          format: 2,
          parts: [
            { type: "text", text: "I checked the task." },
            {
              type: "tool-invocation",
              toolInvocation: {
                state: "result",
                toolCallId: "call-1",
                toolName: "task_check",
                args: {},
                result: { content: "All tasks completed", isError: false },
              },
            },
          ],
        },
      },
    ];

    const converted = toAISdkV5Messages(stored);

    expect(converted).toHaveLength(1);
    expect(converted[0]?.id).toBe("message-1");
    expect(converted[0]?.parts.some((part) => part.type === "text")).toBe(true);
    expect(converted[0]?.parts.some((part) => part.type === "tool-task_check")).toBe(true);
  });

  it("uses TaskSignalProvider as the complete native task bundle", () => {
    const provider = new TaskSignalProvider();

    expect(Object.keys(provider.getTools()).sort()).toEqual(["task_check", "task_complete", "task_update", "task_write"]);
    expect(provider.getInputProcessors().map((processor) => ("id" in processor ? processor.id : undefined))).toContain("task-state");
  });

  it("exposes the documented display snapshot defaults", () => {
    const display = defaultDisplayState();

    expect(display.isRunning).toBe(false);
    expect(display.currentMessage).toBeNull();
    expect(display.queuedFollowUps).toBe(0);
    expect(display.activeTools).toBeInstanceOf(Map);
    expect(display.pendingSuspensions).toBeInstanceOf(Map);
    expect(display.tasks).toEqual([]);
  });

  it("persists thread lifecycle through AgentController Session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proteus-mastra-contract-"));
    temporaryDirectories.push(directory);
    const storage = new LibSQLStore({ id: "contract-storage", url: `file:${join(directory, "contract.db")}` });
    const memory = new Memory({ storage });
    const agent = new Agent({
      id: "contract-agent",
      name: "Contract agent",
      instructions: "Do not run. This agent exists only for controller contract tests.",
      model: "openrouter/auto",
      memory,
    });
    const workspace = new Workspace({
      id: "contract-workspace",
      filesystem: new LocalFilesystem({ basePath: join(directory, "workspace"), contained: true }),
      tools: { enabled: false },
    });
    const controller = new AgentController({
      id: "contract-controller",
      resourceId: "contract-resource",
      storage,
      memory,
      agent,
      workspace,
      modes: [{ id: "chat", name: "Chat", metadata: { default: true } }],
    });

    try {
      await controller.init();
      const session = await controller.createSession({ id: "contract-session", resourceId: "contract-resource" });
      const firstThreadId = session.thread.requireId();
      const second = await session.thread.create({ title: "Second thread" });
      await session.thread.switch({ threadId: firstThreadId });

      expect(second.id).not.toBe(firstThreadId);
      expect(session.thread.getId()).toBe(firstThreadId);
      expect((await session.thread.list()).map((thread) => thread.id)).toEqual(expect.arrayContaining([firstThreadId, second.id]));
    } finally {
      await controller.destroy();
      await storage.close();
    }
  });
});
