import { useCallback, useState } from "react";
import type { Difficulty, Lang } from "./api";

export interface GameSettings {
  lang: Lang;
  /** Seconds to explain one word; 0 = unlimited. */
  wordTime: number;
  /** Seconds per round. */
  roundTime: number;
  /** Empty = all built-in categories. */
  categoryIds: number[];
  /** Empty = all difficulties. */
  difficulties: Difficulty[];
  /** Subtract a point for every skipped word. */
  skipPenalty: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  lang: "ru",
  wordTime: 10,
  roundTime: 60,
  categoryIds: [],
  difficulties: [],
  skipPenalty: false,
};

const KEY = "game-settings-v1";

const int = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Repairs anything odd that may have ended up in storage. */
function sanitize(raw: Partial<GameSettings>): GameSettings {
  const d = DEFAULT_SETTINGS;
  return {
    lang: raw.lang === "en" ? "en" : "ru",
    wordTime: int(raw.wordTime, 0, 300, d.wordTime),
    roundTime: int(raw.roundTime, 10, 900, d.roundTime),
    categoryIds: Array.isArray(raw.categoryIds) ? raw.categoryIds.filter((x) => Number.isInteger(x)) : [],
    difficulties: Array.isArray(raw.difficulties)
      ? (raw.difficulties.filter((x) => x === 1 || x === 2 || x === 3) as Difficulty[])
      : [],
    skipPenalty: raw.skipPenalty === true,
  };
}

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt — fall back to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(loadSettings);
  const update = useCallback((patch: Partial<GameSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  return [settings, update] as const;
}
