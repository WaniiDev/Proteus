import { ArrowDown, ArrowRight, Check, ChevronDown, Copy, KeyRound, PanelRight, Pencil, Play, Plus, RefreshCw, RotateCcw, Search, Send, Square, Trash2, X } from "lucide-react";


export type IconName = "send" | "stop" | "down" | "plus" | "trash" | "refresh" | "key" | "edit" | "copy" | "retry" | "play" | "close" | "latest" | "steer" | "search" | "check" | "panel";

const ICONS = {
  send: Send,
  stop: Square,
  down: ChevronDown,
  plus: Plus,
  trash: Trash2,
  refresh: RefreshCw,
  key: KeyRound,
  edit: Pencil,
  copy: Copy,
  retry: RotateCcw,
  play: Play,
  close: X,
  latest: ArrowDown,
  steer: ArrowRight,
  search: Search,
  check: Check,
  panel: PanelRight,
} satisfies Record<IconName, typeof Send>;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph className={className} size={size} strokeWidth={1.75} aria-hidden="true" />;
}
