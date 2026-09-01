import type { Metadata } from "next";
import { Geist_Mono, Public_Sans, Source_Serif_4 } from "next/font/google";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
import "./globals.css";

// Public Sans + Source Serif 4 is the approved front-door design's type
// pairing (penny-front-door.html mockup) — adopted sitewide via the same
// next/font/google pipeline every other typeface here already uses, rather
// than a one-off loaded just for "/".
const publicSans = Public_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: {
    default: "Penny — the US dollar system, made legible",
    template: "%s · Penny",
  },
  description:
    "A public instrument that makes the US dollar system legible: where federal money comes from, where it goes, and how it transmits to markets — every number cited to the agency of record.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} ${geistMono.variable} ${sourceSerif.variable}`} suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
