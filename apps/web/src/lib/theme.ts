export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "giigirl-theme";

const VALID_PREFERENCES: ThemePreference[] = ["light", "dark", "system"];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (VALID_PREFERENCES as string[]).includes(value);
}

/** Reads the stored preference, defaulting to "system" for anything missing or invalid. */
export function getStoredPreference(storage: Pick<Storage, "getItem">): ThemePreference {
  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    // Storage can throw in some locked-down browser contexts (e.g. private
    // mode with storage disabled) — fall back silently rather than crash.
    return "system";
  }
}

export function storePreference(storage: Pick<Storage, "setItem">, preference: ThemePreference): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore — persistence is a nice-to-have, not required for the current
    // page load to render the right theme.
  }
}

export function getSystemTheme(media: Pick<MediaQueryList, "matches">): ResolvedTheme {
  return media.matches ? "dark" : "light";
}

/** The single source of truth for "preference + system state -> actual theme". */
export function resolveTheme(preference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  return preference === "system" ? systemTheme : preference;
}

export function applyResolvedTheme(
  root: { classList: Pick<DOMTokenList, "toggle"> },
  resolvedTheme: ResolvedTheme,
): void {
  root.classList.toggle("dark", resolvedTheme === "dark");
}
