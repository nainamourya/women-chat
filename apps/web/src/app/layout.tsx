import type { Metadata } from "next";
import { Geist, Geist_Mono, Baloo_2 } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/SiteHeader";
import { BottomNav } from "@/components/BottomNav";
import { SiteFooter } from "@/components/SiteFooter";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// Runs before hydration (and before first paint) so the page never flashes
// the wrong theme. Intentionally plain, duplicated logic rather than an
// import from lib/theme.ts — it has to run as a raw synchronous script tag,
// not a module, and must stay trivially small. Keep in sync with
// resolveTheme()/getStoredPreference() in lib/theme.ts if this changes.
const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
    var theme = (stored === "light" || stored === "dark")
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    if (theme === "dark") document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Rounded and warm, for marketing headlines only — body text and app UI
// stay on Geist. Two typefaces with clearly distinct jobs: one carries the
// brand's personality, the other stays quiet and legible for everyday use.
const balooDisplay = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const siteUrl = "https://www.giigirl.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "GiiGirl — A women-only space for real conversation",
    template: "%s — GiiGirl",
  },
  description:
    "GiiGirl pairs adult women (18+) for private, judgment-free conversation. Every member is reviewed by a real person before they can chat — no bots, no swiping, no men.",
  keywords: [
    "women only chat app",
    "safe space for women",
    "talk to women online",
    "women's peer support",
    "anonymous chat for women",
  ],
  openGraph: {
    title: "GiiGirl — A women-only space for real conversation",
    description:
      "Private, judgment-free conversation with other adult women. Every member is reviewed by a real person before they can chat.",
    url: siteUrl,
    siteName: "GiiGirl",
    images: [{ url: "/giigirl-logo.png", width: 1200, height: 630 }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "GiiGirl — A women-only space for real conversation",
    description: "Private, judgment-free conversation with other adult women.",
    images: ["/giigirl-logo.png"],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${balooDisplay.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="relative min-h-full flex flex-col overflow-x-hidden">
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>
        <Providers>
          <SiteHeader />
          <div className="flex flex-1 flex-col bg-background pb-20 sm:pb-0">{children}</div>
          <SiteFooter />
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
