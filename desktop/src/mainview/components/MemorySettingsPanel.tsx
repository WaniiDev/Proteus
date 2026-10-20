import { useEffect, useState } from "react";
import type { MemoryScope, MemorySettingsState } from "../../shared/contracts";
import { rpc } from "../lib/bridge";
import { MemorySettingsSurface } from "./MemorySettingsSurface";

export function MemorySettingsPanel({ focusScope }: { focusScope?: MemoryScope }) {
  const focusKey = focusScope?.kind === "project" ? `project:${focusScope.projectId}` : "global";
  const [state, setState] = useState<MemorySettingsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    void rpc.request["memory.get"](focusScope ? { scope: focusScope } : undefined)
      .then((next) => { if (active) setState(next); })
      .catch(() => { if (active) setError("Memory settings could not be loaded."); });
    return () => { active = false; };
  }, [focusKey]);

  const run = async (operation: () => Promise<MemorySettingsState>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      setState(await operation());
      return true;
    } catch {
      setError("The memory change could not be saved. Nothing was changed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    if (!error) {
      return <div className="list" aria-busy="true"><div className="list-row quiet">Opening your memory. Loading saved context and project spaces…</div></div>;
    }
    return <div className="list"><div className="list-row quiet" role="alert"><span className="row-copy"><span className="row-title">Memory is unavailable</span><span className="row-sub wrap">{error} No saved-memory status has been changed.</span></span></div></div>;
  }

  return <MemorySettingsSurface
    state={state}
    focusKey={focusKey}
    busy={busy}
    error={error}
    onSetEnabled={(enabled) => run(() => rpc.request["memory.set-enabled"]({ enabled }))}
    onCreate={(scope, category, content) => run(() => rpc.request["memory.create"]({ scope, category, content }))}
    onUpdate={(scope, id, category, content) => run(() => rpc.request["memory.update"]({ scope, id, category, content }))}
    onDelete={(scope, id) => run(() => rpc.request["memory.delete"]({ scope, id }))}
    onReset={(scope) => run(() => rpc.request["memory.reset"]({ scope }))}
  />;
}
