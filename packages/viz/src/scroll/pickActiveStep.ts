/**
 * Pure step-activation logic for the scrollytelling container. Kept free
 * of IntersectionObserver/DOM types so it's directly unit-testable; the
 * React hook (useScrollSteps.ts) is the only thing that talks to the DOM.
 */
export interface StepIntersection {
  readonly index: number;
  readonly isIntersecting: boolean;
  /** 0 (not visible) .. 1 (fully visible), as IntersectionObserverEntry.intersectionRatio reports. */
  readonly intersectionRatio: number;
  /**
   * Signed distance (px) from this step's center to the container's
   * "active line" (e.g. viewport center, or a fixed offset from the top
   * for a pinned-graphic layout) — 0 means perfectly on the line. Only
   * its magnitude is used to rank candidates.
   */
  readonly distanceFromActiveLine: number;
}

/**
 * Picks which step should be considered "active" given the current
 * intersection state of every step. Among steps currently intersecting the
 * viewport, the one closest to the active line wins; ties break toward
 * higher visibility, then toward the lower index for determinism. When
 * nothing is intersecting (e.g. mid-fling between steps), the previous
 * active step is kept rather than flickering to null.
 */
export function pickActiveStep(entries: readonly StepIntersection[], previousActiveIndex: number | null): number | null {
  const intersecting = entries.filter((e) => e.isIntersecting);
  if (intersecting.length === 0) return previousActiveIndex;

  let best = intersecting[0];
  for (const e of intersecting.slice(1)) {
    if (!best) {
      best = e;
      continue;
    }
    const bestDist = Math.abs(best.distanceFromActiveLine);
    const dist = Math.abs(e.distanceFromActiveLine);
    if (
      dist < bestDist ||
      (dist === bestDist && e.intersectionRatio > best.intersectionRatio) ||
      (dist === bestDist && e.intersectionRatio === best.intersectionRatio && e.index < best.index)
    ) {
      best = e;
    }
  }
  return best?.index ?? previousActiveIndex;
}
