# TreasuryDirect upcoming auctions — raw fixture

`2026-09-01.json` — captured live 2026-09-01 via:

```
https://www.treasurydirect.gov/TA_WS/securities/upcoming
```

Keyless, no auth. 9 rows: the published calendar as of that moment, a mix of
already-announced auctions (Sep 2–3, `offeringAmount` populated) and
not-yet-announced ones (Sep 8–10, `offeringAmount` empty — TBA).

## Verified fact this fixture is the evidence for

`announcementDate` (and `issueDate`) are populated even on a not-yet-announced
row — TreasuryDirect projects them from the standing auction calendar before
the real announcement goes out. `offeringAmount`/`totalAccepted`/
`bidToCoverRatio`/etc. are empty on those rows; `announcementDate`/
`issueDate`/`auctionDate` are not. This is why `auction.announcement_date`
and `auction.issue_date` are `NOT NULL` while the result columns are
nullable — see `packages/db/src/schema.ts`.
