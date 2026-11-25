import { invoke } from "@tauri-apps/api/core";

export type Lang = "ru" | "en";
export type Difficulty = 1 | 2 | 3;

export interface Category {
  id: number;
  nameRu: string;
  nameEn: string;
  icon: string;
  isCustom: boolean;
  /** Word counts [easy, medium, hard] in the requested language. */
  counts: [number, number, number];
}

export interface Word {
  id: number;
  categoryId: number;
  text: string;
  difficulty: Difficulty;
}

export interface CustomList {
  id: number;
  name: string;
  icon: string;
  /** Number of entries (ru/en pairs). */
  entries: number;
  ruCount: number;
  enCount: number;
}

/** One custom-list word: Russian and/or English variant with a shared difficulty. */
export interface Entry {
  id: number;
  ru: string | null;
  en: string | null;
  difficulty: Difficulty;
}

export interface EntryInput {
  ru: string | null;
  en: string | null;
  difficulty: Difficulty;
}

export const api = {
  listCategories: (lang: Lang) => invoke<Category[]>("list_categories", { lang }),
  drawWords: (p: {
    lang: Lang;
    categoryIds: number[];
    difficulties: Difficulty[];
    exclude: number[];
    limit: number;
  }) => invoke<Word[]>("draw_words", p),

  listCustomLists: () => invoke<CustomList[]>("list_custom_lists"),
  getCustomList: (id: number) => invoke<CustomList>("get_custom_list", { id }),
  createCustomList: (name: string, icon: string) => invoke<CustomList>("create_custom_list", { name, icon }),
  updateCustomList: (id: number, name: string, icon: string) =>
    invoke<CustomList>("update_custom_list", { id, name, icon }),
  deleteCustomList: (id: number) => invoke<void>("delete_custom_list", { id }),

  listEntries: (listId: number) => invoke<Entry[]>("list_entries", { listId }),
  addEntry: (listId: number, e: EntryInput) => invoke<Entry>("add_entry", { listId, ...e }),
  updateEntry: (listId: number, id: number, e: EntryInput) => invoke<Entry>("update_entry", { listId, id, ...e }),
  deleteEntry: (listId: number, id: number) => invoke<void>("delete_entry", { listId, id }),
};

export type ExportFormat = "xlsx" | "json" | "sql";

export interface ImportReport {
  listsCreated: number;
  listsUpdated: number;
  added: number;
  duplicates: number;
  invalid: number;
  invalidSamples: string[];
}

export const transferApi = {
  /** Resolves to the suggested file name, or null if the save dialog was cancelled. */
  exportLists: (listId: number | null, format: ExportFormat, uiLang: string) =>
    invoke<string | null>("export_lists", { listId, format, uiLang }),
  /** Resolves to null if the file picker was cancelled. */
  importLists: (listId: number | null, uiLang: string) =>
    invoke<ImportReport | null>("import_lists", { listId, uiLang }),
};

export const DIFFICULTY_LEVELS: Difficulty[] = [1, 2, 3];
export const DIFFICULTY_COLOR: Record<Difficulty, string> = { 1: "teal", 2: "yellow", 3: "red" };
export const WORD_LANGS: Lang[] = ["ru", "en"];

// Client-side mirror of the backend word validation (src-tauri/src/db.rs).
const RU_CHARS = /^[А-Яа-яЁё \-]*$/;
const EN_CHARS = /^[A-Za-z '\-]*$/;
const RU_WORD = /^[А-Яа-яЁё]+(?:[ -][А-Яа-яЁё]+)*$/;
const EN_WORD = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;

export const normalizeWord = (s: string) => s.trim().replace(/\s+/g, " ");

/** While typing: only flags characters of the wrong alphabet. */
export const hasForeignChars = (s: string, lang: Lang) => !(lang === "ru" ? RU_CHARS : EN_CHARS).test(s);

/** On submit: full check (no stray separators). Empty is valid — the field is optional. */
export const isValidWord = (s: string, lang: Lang) => {
  const w = normalizeWord(s);
  return w === "" || ((lang === "ru" ? RU_WORD : EN_WORD).test(w) && w.length <= 60);
};
