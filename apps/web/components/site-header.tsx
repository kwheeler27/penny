import Link from "next/link";

const NAV = [
  { href: "/now", label: "Now" },
  { href: "/report/where-the-money-goes", label: "Where the money goes" },
  { href: "/data", label: "Data" },
] as const;

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="site-wordmark">
          Penny
        </Link>
        <nav className="site-nav" aria-label="Primary">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
