import type { ProjectSummary, ThreadSummary } from "../shared/contracts";

export function projectThreadsFor(threads: ThreadSummary[], projectId: string): ThreadSummary[] {
  return threads
    .filter((thread) => thread.workspace.binding.kind === "project" && thread.workspace.binding.projectId === projectId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function filterProjects(projects: ProjectSummary[], query: string): ProjectSummary[] {
  const needle = query.trim().toLowerCase();
  return needle ? projects.filter((project) => `${project.name} ${project.rootPath}`.toLowerCase().includes(needle)) : projects;
}
