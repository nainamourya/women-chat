import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/SiteHeader";
import { BottomNav } from "@/components/BottomNav";
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

export const metadata: Metadata = {
  title: "GiiGirl (prototype)",
  description: "Women-only peer chat platform for adults 18+ — MVP prototype.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
          <div className="pb-20 sm:pb-0">{children}</div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
