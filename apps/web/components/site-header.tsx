import Link from "next/link";

// Sitewide nav per the approved auction-page mockup: the story, the running
// auction record, and the citation index. GitHub moved out of the nav and
// lives only in the footer now, matching that mockup (it never listed
// GitHub in its header). /now still exists and is reachable (linked from
// the front door's status strip) — it's just not a top-level nav item.
const NAV: readonly { href: string; label: string; external?: true }[] = [
  { href: "/", label: "The story" },
  { href: "/auctions", label: "Auctions" },
  { href: "/data", label: "Data & sources" },
];

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="site-wordmark">
          Penny
        </Link>
        <nav className="site-nav" aria-label="Primary">
          {NAV.map((item) =>
            item.external ? (
              <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer">
                {item.label}
              </a>
            ) : (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </header>
  );
}
