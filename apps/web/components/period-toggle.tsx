import type { ReactNode } from "react";

/**
 * A month / fiscal-year-to-date switch, built as a pure-CSS radio-tab
 * pattern rather than a client component: both panels are already
 * server-rendered React trees (RegistryFigure and the flow views need to
 * stay Server Components to do their own DB reads), and a plain
 * `:checked ~` toggle means no JS ships for something this simple — the
 * page still works with JS disabled, which matters more than usual for a
 * public trust-first instrument.
 */
export default function PeriodToggle({
  month,
  fiscalYtd,
  idPrefix,
}: {
  month: ReactNode;
  fiscalYtd: ReactNode;
  /** Unique per instance — two toggles on one page would otherwise collide on radio input ids/names. */
  idPrefix: string;
}) {
  const monthId = `${idPrefix}-month`;
  const fytdId = `${idPrefix}-fytd`;
  return (
    <div className="period-toggle">
      <input type="radio" name={`${idPrefix}-view`} id={monthId} className="period-toggle-input" defaultChecked />
      <input type="radio" name={`${idPrefix}-view`} id={fytdId} className="period-toggle-input" />
      <div className="period-toggle-tabs" role="tablist">
        <label htmlFor={monthId}>Latest month</label>
        <label htmlFor={fytdId}>Fiscal year to date</label>
      </div>
      <div className="period-toggle-panel period-toggle-panel--a">{month}</div>
      <div className="period-toggle-panel period-toggle-panel--b">{fiscalYtd}</div>
      <style>{`
        #${monthId}:checked ~ .period-toggle-panel--a { display: block; }
        #${fytdId}:checked ~ .period-toggle-panel--b { display: block; }
        #${monthId}:checked ~ .period-toggle-tabs label[for="${monthId}"],
        #${fytdId}:checked ~ .period-toggle-tabs label[for="${fytdId}"] { color: var(--text-primary); border-color: var(--text-primary); }
        #${monthId}:focus-visible ~ .period-toggle-tabs label[for="${monthId}"],
        #${fytdId}:focus-visible ~ .period-toggle-tabs label[for="${fytdId}"] { outline: 2px solid var(--link); outline-offset: 2px; }
      `}</style>
    </div>
  );
}
