import { describe, it, expect, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  getStoredPreference,
  getSystemTheme,
  isThemePreference,
  resolveTheme,
  storePreference,
} from "./theme";

describe("isThemePreference", () => {
  it("accepts the three valid preferences", () => {
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("system")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isThemePreference("blue")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
    expect(isThemePreference(42)).toBe(false);
  });
});

describe("getStoredPreference", () => {
  it("returns the stored value when valid", () => {
    const storage = { getItem: vi.fn().mockReturnValue("dark") };
    expect(getStoredPreference(storage)).toBe("dark");
  });

  it("defaults to system when nothing is stored", () => {
    const storage = { getItem: vi.fn().mockReturnValue(null) };
    expect(getStoredPreference(storage)).toBe("system");
  });

  it("defaults to system when the stored value is invalid (e.g. corrupted/old data)", () => {
    const storage = { getItem: vi.fn().mockReturnValue("solarized") };
    expect(getStoredPreference(storage)).toBe("system");
  });

  it("defaults to system rather than throwing when storage access itself throws", () => {
    const storage = {
      getItem: vi.fn().mockImplementation(() => {
        throw new Error("storage disabled");
      }),
    };
    expect(getStoredPreference(storage)).toBe("system");
  });
});

describe("storePreference", () => {
  it("writes the preference under the expected key", () => {
    const storage = { setItem: vi.fn() };
    storePreference(storage, "dark");
    expect(storage.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "dark");
  });

  it("does not throw when storage access itself throws", () => {
    const storage = {
      setItem: vi.fn().mockImplementation(() => {
        throw new Error("storage disabled");
      }),
    };
    expect(() => storePreference(storage, "light")).not.toThrow();
  });
});

describe("getSystemTheme", () => {
  it("maps a matching media query to dark", () => {
    expect(getSystemTheme({ matches: true })).toBe("dark");
  });

  it("maps a non-matching media query to light", () => {
    expect(getSystemTheme({ matches: false })).toBe("light");
  });
});

describe("resolveTheme", () => {
  it("passes through an explicit light/dark preference regardless of system theme", () => {
    expect(resolveTheme("light", "dark")).toBe("light");
    expect(resolveTheme("dark", "light")).toBe("dark");
  });

  it("follows the system theme when preference is system", () => {
    expect(resolveTheme("system", "dark")).toBe("dark");
    expect(resolveTheme("system", "light")).toBe("light");
  });
});

describe("applyResolvedTheme", () => {
  it("adds the dark class when resolved theme is dark", () => {
    const root = { classList: { toggle: vi.fn() } };
    applyResolvedTheme(root, "dark");
    expect(root.classList.toggle).toHaveBeenCalledWith("dark", true);
  });

  it("removes the dark class when resolved theme is light", () => {
    const root = { classList: { toggle: vi.fn() } };
    applyResolvedTheme(root, "light");
    expect(root.classList.toggle).toHaveBeenCalledWith("dark", false);
  });
});
