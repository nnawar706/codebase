"use client";

import { useSyncExternalStore } from "react";

// Two visible options. With no stored choice the root stays on "system", and the
// control highlights whichever of the two the OS currently resolves to.
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

// Runs inline in <head> before first paint so a forced theme never flashes the
// system one. It's a string because it executes before any bundle loads.
export const themeInitScript = `try{var t=localStorage.getItem("${STORAGE_KEY}");document.documentElement.dataset.theme=t==="light"||t==="dark"?t:"system"}catch(e){document.documentElement.dataset.theme="system"}`;

function readTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  if (value === "light" || value === "dark") return value;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

// The root element and the OS setting are the source of truth; the control
// just observes them, so an OS switch while following the system shows up too.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", onChange);
  };
}

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the choice still applies for this page view.
  }
}

export function ThemeControl() {
  const theme = useSyncExternalStore<Theme | null>(subscribe, readTheme, () => null);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex h-6 items-center rounded border border-border p-px"
    >
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
          onClick={() => setTheme(option)}
          className={`h-full rounded-sm px-1.5 text-[11px] ${
            theme === option
              ? "bg-surface text-foreground"
              : "text-muted hover:text-foreground"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
