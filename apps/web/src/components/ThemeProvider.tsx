"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  applyResolvedTheme,
  getStoredPreference,
  getSystemTheme,
  resolveTheme,
  storePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

// The inline script in layout.tsx already set the correct class on <html>
// before this component ever mounts (avoiding a flash of the wrong theme),
// so the initial state here just needs to match what that script computed —
// it re-reads the same storage/media query rather than trusting a guess.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  useEffect(() => {
    const storedPreference = getStoredPreference(window.localStorage);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const systemTheme = getSystemTheme(media);
    setPreferenceState(storedPreference);
    setResolvedTheme(resolveTheme(storedPreference, systemTheme));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    function handleSystemChange() {
      // Only live-react to OS changes while "system" is selected — an
      // explicit light/dark choice must not be overridden by this listener.
      setPreferenceState((currentPreference) => {
        if (currentPreference === "system") {
          const systemTheme = getSystemTheme(media);
          setResolvedTheme(systemTheme);
          applyResolvedTheme(document.documentElement, systemTheme);
        }
        return currentPreference;
      });
    }

    media.addEventListener("change", handleSystemChange);
    return () => media.removeEventListener("change", handleSystemChange);
  }, []);

  useEffect(() => {
    applyResolvedTheme(document.documentElement, resolvedTheme);
  }, [resolvedTheme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    storePreference(window.localStorage, next);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const systemTheme = getSystemTheme(media);
    setResolvedTheme(resolveTheme(next, systemTheme));
  }, []);

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
