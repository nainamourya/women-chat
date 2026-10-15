import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// A minimal, controllable mock of matchMedia — tests can flip `matches` and
// fire the registered "change" listener to simulate the OS theme changing,
// without touching the real (jsdom-unsupported) matchMedia implementation.
function installMatchMediaMock(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();

  const mql = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_event: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: () => void) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  window.matchMedia = vi.fn().mockReturnValue(mql);

  return {
    setMatches(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function Consumer() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setPreference("light")}>light</button>
      <button onClick={() => setPreference("dark")}>dark</button>
      <button onClick={() => setPreference("system")}>system</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults to following the system theme when nothing is stored", async () => {
    installMatchMediaMock(true); // system prefers dark
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );

    await act(async () => {});

    expect(screen.getByTestId("preference").textContent).toBe("system");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("selecting a theme updates the resolved theme, the DOM class, and persists it", async () => {
    installMatchMediaMock(false);
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    await act(async () => {});

    await act(async () => {
      screen.getByRole("button", { name: "dark" }).click();
    });

    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await act(async () => {
      screen.getByRole("button", { name: "light" }).click();
    });

    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("restores a previously persisted explicit preference on mount", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    installMatchMediaMock(false); // system says light — explicit choice must win
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    await act(async () => {});

    expect(screen.getByTestId("preference").textContent).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("live-updates when the system theme changes while preference is system", async () => {
    const mock = installMatchMediaMock(false);
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId("resolved").textContent).toBe("light");

    await act(async () => {
      mock.setMatches(true);
    });

    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("does not let a system theme change override an explicit choice", async () => {
    const mock = installMatchMediaMock(false);
    render(
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>,
    );
    await act(async () => {});

    await act(async () => {
      screen.getByRole("button", { name: "light" }).click();
    });
    expect(screen.getByTestId("resolved").textContent).toBe("light");

    // System flips to dark, but the user explicitly chose "light".
    await act(async () => {
      mock.setMatches(true);
    });

    expect(screen.getByTestId("preference").textContent).toBe("light");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
