import { useState } from "react";
import { Copy, FileSearch, Files, Gauge, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { RuntimeSnapshot, ThreadSummary } from "../../shared/contracts";
import { Menu, MenuItem, MenuRule } from "./ds/Menu";
import { useToast } from "./ds/Toast";
import { transcriptText } from "./Sidebar";
import { RenameDialog } from "./conversation/RenameDialog";
import { DetailsDialog } from "./conversation/DetailsDialog";
import { FilesDialog } from "./conversation/FilesDialog";
import { SearchDialog } from "./conversation/SearchDialog";

type Dialog = { kind: "files"; path?: string } | { kind: "search" } | { kind: "details" } | { kind: "rename" } | null;

// The conversation header's actions: everything the old context pane held, one menu click and one dialog away.
export function ConversationMenu({ snapshot, onRename, onPin, onDeleteRequest }: { snapshot: RuntimeSnapshot; onRename?: (threadId: string, title: string) => void; onPin?: (threadId: string, pinned: boolean) => void; onDeleteRequest?: (thread: ThreadSummary) => void }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const hasThread = !!snapshot.activeThreadId;
  const thread = snapshot.threads?.find((item) => item.id === snapshot.activeThreadId);
  const toast = useToast();
  const copyTranscript = () => { void navigator.clipboard?.writeText(transcriptText(snapshot.messages ?? [])).then(() => toast("Transcript copied")).catch(() => undefined); };
  const needsFolder = snapshot.activeWorkspace.availability !== "ready";
  return <>
    <button type="button" className="icon-btn electrobun-webkit-app-region-no-drag" aria-label="Conversation actions" title="Conversation actions" aria-haspopup="menu" aria-expanded={anchor !== null} disabled={!hasThread} onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}><MoreHorizontal className="i" aria-hidden="true" /></button>
    {anchor && <Menu className="session-menu conversation-menu" label="Conversation actions" anchor={anchor} placement="below" onClose={() => setAnchor(null)}>
      <MenuItem icon={<Files className="i sm" aria-hidden="true" />} disabled={needsFolder} reason="Reconnect the folder" onSelect={() => setDialog({ kind: "files" })}>Files in this conversation</MenuItem>
      <MenuItem icon={<FileSearch className="i sm" aria-hidden="true" />} disabled={needsFolder} reason="Reconnect the folder" onSelect={() => setDialog({ kind: "search" })}>Search this conversation</MenuItem>
      <MenuItem icon={<Gauge className="i sm" aria-hidden="true" />} onSelect={() => setDialog({ kind: "details" })}>Details</MenuItem>
      {thread && <>
        <MenuRule />
        <MenuItem icon={<Pencil className="i sm" aria-hidden="true" />} onSelect={() => setDialog({ kind: "rename" })}>Rename</MenuItem>
        <MenuItem icon={thread.pinned ? <PinOff className="i sm" aria-hidden="true" /> : <Pin className="i sm" aria-hidden="true" />} onSelect={() => onPin?.(thread.id, !thread.pinned)}>{thread.pinned ? "Unpin" : "Pin to top"}</MenuItem>
        <MenuItem icon={<Copy className="i sm" aria-hidden="true" />} onSelect={copyTranscript}>Copy transcript</MenuItem>
        <MenuRule />
        <MenuItem danger icon={<Trash2 className="i sm" aria-hidden="true" />} onSelect={() => onDeleteRequest?.(thread)}>Delete…</MenuItem>
      </>}
    </Menu>}
    {dialog?.kind === "rename" && thread && <RenameDialog title={thread.title} onSave={(next) => onRename?.(thread.id, next)} onClose={() => setDialog(null)} />}
    {dialog?.kind === "files" && <FilesDialog snapshot={snapshot} initialPath={dialog.path} onClose={() => setDialog(null)} />}
    {dialog?.kind === "search" && <SearchDialog snapshot={snapshot} onOpenFile={(path) => setDialog({ kind: "files", path })} onClose={() => setDialog(null)} />}
    {dialog?.kind === "details" && <DetailsDialog snapshot={snapshot} onClose={() => setDialog(null)} />}
  </>;
}
