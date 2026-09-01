import Link from "next/link";

/**
 * The Act I month stepper pill (beat 1): "‹ Month YYYY ›". Stepping is
 * server-driven — ‹/› are real links to a new `?spendMonth=` URL, not
 * client-side state, so each month is its own shareable, prerender-friendly
 * page. Disabled at either edge of the data (no `href` at all — a real
 * `<button disabled>`, which browsers already skip in tab order and which
 * needs no separate aria-hidden trick), never a link to nowhere.
 */
export interface MonthStepperProps {
  currentLabel: string;
  prevHref: string | null;
  nextHref: string | null;
}

export default function MonthStepper({ currentLabel, prevHref, nextHref }: MonthStepperProps) {
  return (
    <div className="month-stepper" role="group" aria-label="Browse by month">
      {prevHref ? (
        <Link href={prevHref} className="month-stepper-btn" aria-label={`Previous month, before ${currentLabel}`}>
          ‹
        </Link>
      ) : (
        <button type="button" className="month-stepper-btn" disabled aria-label="No earlier month available">
          ‹
        </button>
      )}
      <span className="month-stepper-label">{currentLabel}</span>
      {nextHref ? (
        <Link href={nextHref} className="month-stepper-btn" aria-label={`Next month, after ${currentLabel}`}>
          ›
        </Link>
      ) : (
        <button type="button" className="month-stepper-btn" disabled aria-label="No later month available">
          ›
        </button>
      )}
    </div>
  );
}
