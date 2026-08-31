import { useEffect, useRef, useState } from "react";

export interface ContainerSize {
  readonly width: number;
  readonly height: number;
}

/** Tracks an element's content-box size via ResizeObserver, for responsive layout decisions (orientation, geometry extent) that can't be done in CSS alone. */
export function useContainerSize<T extends HTMLElement>(fallback: ContainerSize): [React.RefObject<T | null>, ContainerSize] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ContainerSize>(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
