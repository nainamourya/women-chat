"use client";

import { useTheme } from "@/components/ThemeProvider";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function AppearanceSettings() {
  const { preference, setPreference } = useTheme();

  return (
    <div className="flex flex-col gap-2.5 border-t border-border pt-4">
      <span className="text-sm font-medium text-foreground">Appearance</span>
      <div role="radiogroup" aria-label="Appearance" className="flex gap-2">
        {OPTIONS.map((option) => {
          const selected = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(option.value)}
              className={`rounded-md border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                selected
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-surface text-foreground hover:bg-surface-hover"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        &quot;System&quot; follows your device&apos;s light/dark setting automatically.
      </p>
    </div>
  );
}
