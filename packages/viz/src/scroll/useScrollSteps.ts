import { useEffect, useRef, useState } from "react";
import { pickActiveStep, type StepIntersection } from "./pickActiveStep";

export interface UseScrollStepsOptions {
  /** Fraction of the viewport height, from the top, treated as the "active line" a step must cross to become active. Default 0.5 (viewport center) — pass e.g. 0.35 for a layout with a pinned graphic higher up the screen. */
  readonly activeLineFraction?: number;
  readonly onStepChange?: (index: number | null) => void;
}

export interface UseScrollStepsResult {
  /** Ref callback — attach to each step's wrapping element, passing its index: `ref={stepRef(i)}`. */
  readonly stepRef: (index: number) => (el: HTMLElement | null) => void;
  readonly activeIndex: number | null;
}

/**
 * Drives step activation for <ScrollStepContainer>'s children via
 * IntersectionObserver, delegating the actual "which step wins" decision
 * to the pure, unit-tested pickActiveStep(). Multiple thresholds are
 * registered so distanceFromActiveLine updates smoothly as the user
 * scrolls, not just at enter/exit.
 */
export function useScrollSteps(stepCount: number, opts: UseScrollStepsOptions = {}): UseScrollStepsResult {
  const { activeLineFraction = 0.5, onStepChange } = opts;
  const elementsRef = useRef<Array<HTMLElement | null>>(Array.from({ length: stepCount }, () => null));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = elementsRef.current;

    const computeAndSet = () => {
      const activeLineY = window.innerHeight * activeLineFraction;
      const entries: StepIntersection[] = els.map((el, index) => {
        if (!el) return { index, isIntersecting: false, intersectionRatio: 0, distanceFromActiveLine: Number.POSITIVE_INFINITY };
        const rect = el.getBoundingClientRect();
        const isIntersecting = rect.bottom > 0 && rect.top < window.innerHeight;
        const center = rect.top + rect.height / 2;
        const visiblePx = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        const intersectionRatio = rect.height > 0 ? visiblePx / rect.height : 0;
        return { index, isIntersecting, intersectionRatio, distanceFromActiveLine: center - activeLineY };
      });
      const next = pickActiveStep(entries, activeIndexRef.current);
      if (next !== activeIndexRef.current) {
        activeIndexRef.current = next;
        setActiveIndex(next);
        onStepChange?.(next);
      }
    };

    const observer = new IntersectionObserver(computeAndSet, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
    for (const el of els) if (el) observer.observe(el);
    computeAndSet();

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- elementsRef contents change via stepRef, not via a dependency this effect should re-run on.
  }, [stepCount, activeLineFraction, onStepChange]);

  const stepRef = (index: number) => (el: HTMLElement | null) => {
    elementsRef.current[index] = el;
  };

  return { stepRef, activeIndex };
}
