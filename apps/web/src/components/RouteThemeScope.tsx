"use client";

import { usePathname } from "next/navigation";

// The public landing page ("/") always uses the app's dark theme as its
// fixed brand identity — deep plum/near-black background, rose-pink accent
// — regardless of the visitor's actual light/dark preference. This reuses
// the existing `.dark` class (see globals.css) rather than a separate
// token set, since it's the same palette already defined there. Every
// other route keeps following the normal theme system untouched (see
// ThemeProvider).
export function RouteThemeScope({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const forceDark = pathname === "/";

  return <div className={`flex flex-1 flex-col ${forceDark ? "dark" : ""}`}>{children}</div>;
}
