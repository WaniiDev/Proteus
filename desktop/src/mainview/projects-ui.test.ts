import { describe, expect, test } from "bun:test";
import type { ProjectSummary, ThreadSummary } from "../shared/contracts";
import { filterProjects, projectThreadsFor } from "./projects-ui";

const projects: ProjectSummary[] = [
  { id: "p1", name: "Proteus", rootPath: "C:\\Code\\Proteus", availability: "ready", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", lastOpenedAt: "2026-08-03T00:00:00.000Z" },
  { id: "p2", name: "Atlas", rootPath: "D:\\Work\\Atlas", availability: "missing", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", lastOpenedAt: "2026-08-03T00:00:00.000Z" },
];

const thread = (id: string, projectId: string, updatedAt: string): ThreadSummary => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  activity: "idle",
  attention: 0,
  workspace: { binding: { kind: "project", projectId }, label: projectId, availability: "ready" },
});

describe("projects library and detail", () => {
  test("searches project names and paths", () => {
    expect(filterProjects(projects, "proteus").map((project) => project.id)).toEqual(["p1"]);
    expect(filterProjects(projects, "work\\atlas").map((project) => project.id)).toEqual(["p2"]);
  });

  test("shows only the selected project's chats with newest first", () => {
    const threads = [thread("old", "p1", "2026-08-01T00:00:00.000Z"), thread("other", "p2", "2026-08-10T00:00:00.000Z"), thread("new", "p1", "2026-08-09T00:00:00.000Z")];
    expect(projectThreadsFor(threads, "p1").map((item) => item.id)).toEqual(["new", "old"]);
  });

  test("links project detail to scoped memory and project-bound chat creation", async () => {
    const projectsView = await Bun.file(new URL("./ProjectsView.tsx", import.meta.url)).text();
    const app = await Bun.file(new URL("./App.tsx", import.meta.url)).text();
    expect(projectsView).toContain('rpc.request["memory.get"]({ scope: { kind: "project", projectId: selected.id } })');
    expect(projectsView).toContain("onOpenMemory(selected.id)");
    expect(app).toContain('workspaceBinding: { kind: "project", projectId }');
    expect(app).toContain('setSettingsSection("memory")');
  });
});
