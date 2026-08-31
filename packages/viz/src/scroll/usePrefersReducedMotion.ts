import { useEffect, useState } from "react";

function readPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Tracks the user's OS-level reduce-motion preference, live. Every transition/animation in this package must check this before animating (CLAUDE.md-adjacent standard: motion is subtle, purposeful, and skippable). */
export function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(readPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => setPrefers(event.matches);

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handleChange);
      return () => mql.removeEventListener("change", handleChange);
    }
    // Safari <14 fallback.
    type LegacyMql = { addListener(cb: (e: MediaQueryListEvent) => void): void; removeListener(cb: (e: MediaQueryListEvent) => void): void };
    const legacy = mql as unknown as LegacyMql;
    legacy.addListener(handleChange);
    return () => legacy.removeListener(handleChange);
  }, []);

  return prefers;
}
