import Link from "next/link";

// Simplified sitewide nav per the approved front-door design: the story
// (this page), the citation index, and the source repo. /now still exists
// and is reachable (linked from the front door's status strip) — it's just
// no longer a top-level nav item.
const NAV: readonly { href: string; label: string; external?: true }[] = [
  { href: "/", label: "The story" },
  { href: "/data", label: "Data & sources" },
  { href: "https://github.com/kwheeler27/penny", label: "GitHub", external: true },
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
