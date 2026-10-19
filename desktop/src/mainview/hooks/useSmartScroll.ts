import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";

export function useSmartScroll(itemKey: string): {
  threadRef: MutableRefObject<HTMLDivElement | null>;
  showLatest: boolean;
  jumpLatest: () => void;
} {
  const threadRef = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const element = threadRef.current;
    if (!element) return;
    const update = () => {
      nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
      setShowLatest(!nearBottomRef.current);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, []);
  useLayoutEffect(() => {
    const element = threadRef.current;
    if (!element || !nearBottomRef.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [itemKey]);
  return {
    threadRef,
    showLatest,
    jumpLatest: () => {
      threadRef.current?.scrollTo({
        top: threadRef.current.scrollHeight,
        behavior: "smooth",
      });
      setShowLatest(false);
      nearBottomRef.current = true;
    },
  };
}
