import type { MemoryScope } from "../../shared/contracts";
import { MemorySettingsPanel } from "../components/MemorySettingsPanel";

/** Memory is a destination of its own (prototype): the page head says what it is, the panel is the whole screen. */
export function MemoryView({ scope }: { scope?: MemoryScope }) {
  return (
    <section className="memory-view">
      <div className="page memory-page">
        <div className="page-head window-drag-region electrobun-webkit-app-region-drag">
          <div>
            <h1 className="heading">Memory</h1>
            <p>What Proteus keeps between conversations. Nothing is learned silently: only what you save here or approve in a chat.</p>
          </div>
        </div>
        <MemorySettingsPanel focusScope={scope} />
      </div>
    </section>
  );
}
