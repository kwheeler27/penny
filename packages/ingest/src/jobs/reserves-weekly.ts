/**
 * Reserve balances at the Fed (H.4.1, FRED series WRBWFRBL — "Wednesday
 * Level," a genuine point-in-time balance, not WRESBAL's week-average; see
 * `../fred/wrbwfrbl.ts`'s header comment) — `monetary.fed.reserve_balances`.
 * Weekly, Wednesday-as-of. Needs `FRED_API_KEY` (Fed Board data must come
 * from FRED per CLAUDE.md — never the Board's own legacy Data Download
 * Program).
 *
 * The key doesn't exist yet (PLAN.md §5 / .env.example): rather than fail
 * `.github/workflows/ingest-weekly.yml`'s run, this job SKIPS with a clear
 * log line and exits 0 when `FRED_API_KEY` is unset — see the early return
 * in `runReservesWeeklyJob` below. Once the key exists, nothing else here
 * needs to change; the workflow already references the secret.
 */
import { fetchFredObservations } from "../lib/fred-client";
import { fredObservationsResponseSchema, rowsFromFredJson, parseWrbwfrblObservations, WRBWFRBL_SERIES_ID } from "../fred/wrbwfrbl";
import { upsertObservations, type UpsertManySummary } from "../lib/upsert";
import { getDb, type PennyDb } from "@penny/db";

export interface ReservesWeeklyJobResult {
  skipped: boolean;
  reason?: string;
  summary?: UpsertManySummary;
}

const SKIP_LOG_LINE = "FRED_API_KEY not set — skipping reserves ingest";

/**
 * Live job: pulls the last `lookbackWeeks` weeks every run (cheap, and
 * self-healing if a run was ever missed), relying on `lib/upsert.ts`'s
 * value-compare idempotency to make already-known weeks a no-op — same
 * shape as `tga-daily.ts`/`debt-daily.ts`. Default 12 weeks comfortably
 * covers a missed run or two plus H.4.1's own occasional same-week
 * correction (see the registry's `revision_policy.note`).
 */
export async function runReservesWeeklyJob(db: PennyDb, lookbackWeeks = 12): Promise<ReservesWeeklyJobResult> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.log(SKIP_LOG_LINE);
    return { skipped: true, reason: "FRED_API_KEY not set" };
  }

  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - lookbackWeeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const json = await fetchFredObservations(WRBWFRBL_SERIES_ID, apiKey, {
    observationStart: fromDate,
    observationEnd: toDate,
  });
  const parsed = fredObservationsResponseSchema.parse(json);
  const rows = rowsFromFredJson(parsed);
  const observations = parseWrbwfrblObservations(rows, now.toISOString());
  const summary = await upsertObservations(db, observations);
  return { skipped: false, summary };
}

async function main() {
  const db = getDb();
  const result = await runReservesWeeklyJob(db);
  if (result.skipped) {
    console.log(`Reserve balances (WRBWFRBL) ingest skipped: ${result.reason}`);
    return;
  }
  const s = result.summary!;
  console.log(`Reserve balances (WRBWFRBL) ingest complete: +${s.inserted} ~${s.revised} =${s.unchanged}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
