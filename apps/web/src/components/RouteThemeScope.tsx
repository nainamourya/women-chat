"use client";

import { usePathname } from "next/navigation";

// The public landing page ("/") always uses its own light, pastel theme,
// regardless of the visitor's dark/light preference — it's a marketing
// surface with a fixed brand identity, not an app screen. Every other route
// keeps following the normal theme system untouched (see ThemeProvider).
export function RouteThemeScope({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const forceLight = pathname === "/";

  return <div className={`flex flex-1 flex-col ${forceLight ? "theme-light-landing" : ""}`}>{children}</div>;
}
