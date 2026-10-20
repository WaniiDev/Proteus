import { useState } from "react";
import { FileSearch, Files, Gauge, MoreHorizontal } from "lucide-react";
import type { RuntimeSnapshot } from "../../shared/contracts";
import { Menu, MenuItem } from "./ds/Menu";
import { DetailsDialog } from "./conversation/DetailsDialog";
import { FilesDialog } from "./conversation/FilesDialog";
import { SearchDialog } from "./conversation/SearchDialog";

type Dialog = { kind: "files"; path?: string } | { kind: "search" } | { kind: "details" } | null;

// The conversation header's actions: everything the old context pane held, one menu click and one dialog away.
export function ConversationMenu({ snapshot }: { snapshot: RuntimeSnapshot }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const hasThread = !!snapshot.activeThreadId;
  const needsFolder = snapshot.activeWorkspace.availability !== "ready";
  return <>
    <button type="button" className="icon-btn electrobun-webkit-app-region-no-drag" aria-label="Conversation actions" title="Conversation actions" aria-haspopup="menu" aria-expanded={anchor !== null} disabled={!hasThread} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}><MoreHorizontal className="i" aria-hidden="true" /></button>
    {anchor && <Menu className="session-menu conversation-menu" label="Conversation actions" anchor={anchor} placement="below" onClose={() => setAnchor(null)}>
      <MenuItem icon={<Files className="i sm" aria-hidden="true" />} disabled={needsFolder} reason="Reconnect the folder" onSelect={() => setDialog({ kind: "files" })}>Files in this conversation</MenuItem>
      <MenuItem icon={<FileSearch className="i sm" aria-hidden="true" />} disabled={needsFolder} reason="Reconnect the folder" onSelect={() => setDialog({ kind: "search" })}>Search this conversation</MenuItem>
      <MenuItem icon={<Gauge className="i sm" aria-hidden="true" />} onSelect={() => setDialog({ kind: "details" })}>Details</MenuItem>
    </Menu>}
    {dialog?.kind === "files" && <FilesDialog snapshot={snapshot} initialPath={dialog.path} onClose={() => setDialog(null)} />}
    {dialog?.kind === "search" && <SearchDialog snapshot={snapshot} onOpenFile={(path) => setDialog({ kind: "files", path })} onClose={() => setDialog(null)} />}
    {dialog?.kind === "details" && <DetailsDialog snapshot={snapshot} onClose={() => setDialog(null)} />}
  </>;
}
