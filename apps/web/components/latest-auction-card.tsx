import type { AuctionDatasetCitation } from "@/lib/auctions-data";
import type { AuctionRecord } from "@/lib/auction-types";
import { securityLabel, HIGH_YIELD_SUBTITLE, type BuyerMix, type BuyerMixSegment, type LatestAuctionTiles } from "@/lib/auction-transform";
import { formatDateHuman } from "@/lib/format";

export interface LatestAuctionCardProps {
  readonly latest: AuctionRecord | null;
  readonly tiles: LatestAuctionTiles | null;
  readonly buyerMix: BuyerMix | null;
  readonly takeaway: string;
  readonly citation: AuctionDatasetCitation;
  readonly accessDate: string;
}

function segmentColor(key: BuyerMixSegment["key"]): string {
  switch (key) {
    case "primary":
      return "var(--series-outlays)";
    case "direct":
      return "var(--series-borrowing)";
    case "indirect":
      return "var(--series-receipts)";
    case "noncompetitive":
      return "var(--text-muted)";
    case "soma":
      return "var(--text-muted)";
  }
}

function BuyerMixBar({ mix }: { mix: BuyerMix }) {
  const competitive = mix.segments.filter((s) => s.key !== "soma");
  const soma = mix.segments.find((s) => s.key === "soma");
  return (
    <div className="auc-mix">
      <div className="auc-mix-k">Who bought — share of the {mix.subtotalDisplay} accepted competitively</div>
      <div className="auc-mixbar">
        {competitive.map((s) => (
          <div key={s.key} className="auc-mixbar-seg" style={{ width: `${s.widthPercent}%`, background: segmentColor(s.key) }}>
            {s.widthPercent > 6 && <span className="auc-mixbar-lab">{s.key === "indirect" ? `indirect · ${s.shareDisplay}` : s.shareDisplay}</span>}
          </div>
        ))}
        {soma && (
          <>
            {/* SOMA sits beyond a visible divider, hatched — it's an add-on
                riding on top of the announced offering, not a competing
                buyer class (CLAUDE.md/ORCHESTRATION_PROMPT.md doctrine). */}
            <div className="auc-mixbar-divider" aria-hidden="true" />
            <div className="auc-mixbar-seg auc-mixbar-hatch" style={{ width: `${soma.widthPercent}%` }}>
              {soma.widthPercent > 6 && (
                <span className="auc-mixbar-lab" style={{ color: "var(--text-primary)" }}>
                  SOMA
                </span>
              )}
            </div>
          </>
        )}
      </div>
      <div className="auc-mix-legend">
        {mix.segments.map((s) => (
          <span key={s.key}>
            <span className={`sw${s.hatch ? " sw--hatch" : ""}`} style={s.hatch ? undefined : { background: segmentColor(s.key) }} aria-hidden="true" />
            {s.label} {s.shareDisplay}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * "The latest coupon auction" card (beat 4): three stat tiles, the buyer-mix
 * bar, the takeaway sentence, the buyer-class definitions, and the citation
 * line. Every value comes from `tiles`/`buyerMix`/`takeaway`
 * (lib/auction-transform.ts's pure builders, called from lib/auctions-
 * data.ts) — this component only lays out markup. Renders the graceful gap
 * state whenever nothing has resulted yet.
 */
export default function LatestAuctionCard({ latest, tiles, buyerMix, takeaway, citation, accessDate }: LatestAuctionCardProps) {
  if (!latest || !tiles) {
    return (
      <div className="auc-card-empty">No coupon auction has resulted yet — this card fills in automatically once one has.</div>
    );
  }

  return (
    <>
      <div className="auc-card">
        <div className="auc-head">
          <div className="auc-title">{securityLabel(latest)}</div>
          <div className="auc-date">
            Auctioned {formatDateHuman(latest.auctionDate)} · settles {formatDateHuman(latest.issueDate)} ·{" "}
            {/* `latest.sourceUrl` is the batch TA_WS request this row's data
                came from, shared by every row that fetch returned — not a
                CUSIP-specific record (packages/db/src/schema.ts's own doc
                comment on `auction.sourceUrl`; no CUSIP-parameterized
                endpoint exists in packages/ingest). Labeled honestly as the
                dataset it actually is, matching how the citation line below
                names this same kind of URL. */}
            <a href={latest.sourceUrl} target="_blank" rel="noopener noreferrer">
              {citation.dataset} ↗
            </a>
          </div>
        </div>

        <div className="auc-tiles">
          <div className="auc-tile">
            <div className="auc-tile-k">Sold</div>
            <div className={tiles.soldDisplay ? "auc-tile-v" : "auc-tile-v auc-tile-v--gap"}>{tiles.soldDisplay ?? "—"}</div>
            <div className="auc-tile-s">{tiles.soldSubtitle}</div>
          </div>
          <div className="auc-tile">
            <div className="auc-tile-k">High yield</div>
            <div className={tiles.highYieldDisplay ? "auc-tile-v" : "auc-tile-v auc-tile-v--gap"}>{tiles.highYieldDisplay ?? "—"}</div>
            <div className="auc-tile-s">{HIGH_YIELD_SUBTITLE}</div>
          </div>
          <div className="auc-tile">
            <div className="auc-tile-k">Bid-to-cover</div>
            <div className={tiles.bidToCoverDisplay ? "auc-tile-v" : "auc-tile-v auc-tile-v--gap"}>{tiles.bidToCoverDisplay ?? "—"}</div>
            <div className="auc-tile-s">{tiles.bidToCoverSubtitle || "No prior auctions to compare yet."}</div>
          </div>
        </div>

        {buyerMix ? <BuyerMixBar mix={buyerMix} /> : <div className="auc-mix auc-empty">No buyer-class breakdown published yet for this auction.</div>}

        {takeaway ? (
          <p className="auc-takeaway">{takeaway}</p>
        ) : (
          <p className="auc-takeaway auc-takeaway--empty">Not enough of this auction has been published yet to summarize it.</p>
        )}

        <details className="auc-defs">
          <summary>What these buyer classes mean</summary>
          <dl>
            <dt>Primary dealers</dt>
            <dd>A primary dealer bidding for its own account — not for a customer. (A dealer&rsquo;s customer bids are counted under Indirect, below.) Primary dealers are the banks and broker-dealers that trade directly with the New York Fed and are expected to bid in every auction.</dd>
            <dt>Direct bidders</dt>
            <dd>A bidder that is not a primary dealer, bidding for its own account directly rather than through an intermediary.</dd>
            <dt>Indirect bidders</dt>
            <dd>A bid placed through a primary dealer or a direct bidder on a customer&rsquo;s behalf — including foreign and international monetary authorities bidding through the New York Fed. TreasuryDirect&rsquo;s own FAQ notes this category alone doesn&rsquo;t say whether the bidder is foreign or domestic.</dd>
            <dt>Noncompetitive</dt>
            <dd>Bidders who accept whatever yield the auction sets rather than naming one; guaranteed their full amount.</dd>
            <dt>SOMA add-on</dt>
            <dd>The Fed rolling over maturing holdings into the new security, added on top of the announced offering — it doesn&rsquo;t compete for it.</dd>
          </dl>
        </details>
      </div>
      <p className="src">
        Source: {citation.agency},{" "}
        <a href={citation.datasetUrl} target="_blank" rel="noopener noreferrer">
          {citation.dataset} ↗
        </a>{" "}
        (auction results, {formatDateHuman(latest.auctionDate)}). Buyer-class definitions:{" "}
        <a href="https://www.treasurydirect.gov/help-center/faqs/auction-faqs/" target="_blank" rel="noopener noreferrer">
          TreasuryDirect, Auction FAQs ↗
        </a>
        ;{" "}
        <a href="https://www.newyorkfed.org/markets/primarydealers.html" target="_blank" rel="noopener noreferrer">
          Federal Reserve Bank of New York, Primary Dealers ↗
        </a>{" "}
        and{" "}
        <a href="https://www.newyorkfed.org/markets/treasury-rollover-faq" target="_blank" rel="noopener noreferrer">
          Treasury Rollover FAQs ↗
        </a>
        . Accessed {formatDateHuman(accessDate)}.
      </p>
    </>
  );
}
