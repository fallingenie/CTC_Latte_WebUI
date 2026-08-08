import { useEffect, useState } from "react";

const THEME_STORAGE_KEY = "ctc:theme-mode";
const THEME_MODES = ["system", "light", "dark"];

function storedThemeMode() {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return THEME_MODES.includes(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function resolveThemeMode(mode, media) {
  return mode === "system" ? media.matches ? "dark" : "light" : mode;
}

export function useThemeMode() {
  const [mode, setMode] = useState(storedThemeMode);
  const [resolvedMode, setResolvedMode] = useState(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    return resolveThemeMode(storedThemeMode(), media);
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = resolveThemeMode(mode, media);
      setResolvedMode(resolved);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themeMode = mode;
      document.documentElement.style.colorScheme = resolved;
    };
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
    }
    applyTheme();
    media.addEventListener?.("change", applyTheme);
    return () => media.removeEventListener?.("change", applyTheme);
  }, [mode]);

  return { mode, resolvedMode, setMode };
}
