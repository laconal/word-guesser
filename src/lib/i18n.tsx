import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type UiLang = "ru" | "en";

function ruPlural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const ru = {
  appName: "Объясни!",
  tagline: "Объясняй слова — не называя их",
  common: {
    back: "Назад",
    cancel: "Отмена",
    save: "Сохранить",
    create: "Создать",
    delete: "Удалить",
    loading: "Загрузка…",
    actions: "Действия",
  },
  /** Names of word languages. */
  langs: { ru: "Русский", en: "Английский" },
  difficulty: { 1: "Лёгкий", 2: "Средний", 3: "Сложный" } as Record<1 | 2 | 3, string>,
  words: (n: number) => `${n} ${ruPlural(n, "слово", "слова", "слов")}`,
  errors: {
    name_required: "Введите название",
    word_required: "Заполните хотя бы одно поле",
    invalid_ru: "Только русские буквы (между словами — пробел или дефис)",
    invalid_en: "Только английские буквы (между словами — пробел, дефис или апостроф)",
    duplicate_ru: "Это слово уже есть в списке",
    duplicate_en: "Это слово уже есть в списке",
    readonly: "Встроенные категории нельзя изменять",
    not_found: "Не найдено",
    export_empty: "Нечего экспортировать — сначала создайте список",
    import_empty: "В файле не найдено ни одного слова",
    import_format: "Не удалось прочитать файл. Поддерживаются Excel (.xlsx), JSON и SQL",
    import_sql: "Ошибка в SQL-файле",
    file_too_large: "Файл слишком большой (максимум 20 МБ)",
    read_failed: "Не удалось прочитать файл",
    write_failed: "Не удалось сохранить файл",
  } as Record<string, string>,
  home: {
    play: "Играть",
    myLists: "Мои списки слов",
    settings: "Настройки",
    howToPlay: "Как играть",
    rules: [
      "Ведущий видит слово и объясняет его остальным — синонимами, описанием, ассоциациями.",
      "Нельзя называть само слово и однокоренные слова, переводить его на другой язык.",
      "Угадали — жми «Засчитать». Не получается — «Пропустить».",
      "Если время на слово закончилось, оно пропускается автоматически.",
      "В конце раунда видно, сколько слов объяснено и пропущено. Ошибки можно исправить, нажав на слово.",
    ],
  },
  settings: {
    title: "Настройки",
    uiLang: "Язык интерфейса",
  },
  setup: {
    title: "Новая игра",
    wordsLang: "Язык слов",
    time: "Время, секунды",
    perWord: "На одно слово",
    perWordHint: "0 — без ограничения",
    round: "Раунд",
    roundHint: "от 10 до 900",
    penalty: "Штраф за пропуск (−1 очко)",
    difficulty: "Сложность",
    difficultyHint: "Можно выбрать несколько. Ничего не выбрано — слова всех уровней.",
    categories: "Категории",
    categoriesHint: "Можно выбрать несколько. Ничего не выбрано — случайные слова из всех стандартных категорий.",
    myLists: "Мои списки",
    reset: (n: number) => `Сбросить выбор (${n})`,
    available: (n: number) => `Доступно слов: ${n}`,
    noWords: "Нет слов для выбранных фильтров",
    start: "Начать игру",
  },
  game: {
    title: "Игра",
    cantStart: "Не удалось начать",
    noWords: "Нет слов для выбранных категорий и сложности.",
    toSetup: "К настройкам",
    passPhone: "Передайте телефон объясняющему",
    round: (n: number) => `Раунд ${n}`,
    roundBadge: (time: string) => `Раунд ${time} с`,
    wordBadge: (s: number) => `Слово ${s} с`,
    wordUnlimited: "Слово без лимита",
    penaltyBadge: "Штраф −1",
    startRound: "Начать раунд",
    colRound: "Раунд",
    guessed: "Объяснено",
    skipped: "Пропущено",
    score: "Очки",
    total: "Всего",
    roundOver: (n: number) => `Раунд ${n} окончен`,
    finish: "Завершить",
    nextRound: "Следующий раунд",
    tapToFix: "Нажмите на слово, чтобы исправить результат",
    reasonTimeout: "время на слово вышло",
    reasonRoundEnd: "раунд закончился",
    emptyRound: "В этом раунде не было слов",
    pause: "Пауза",
    resume: "Продолжить",
    endRound: "Закончить раунд",
    wordTime: "Время на слово",
    seconds: "с",
    skip: "Пропустить",
    accept: "Засчитать",
    endRoundTitle: "Закончить раунд?",
    endRoundText: "Текущий раунд завершится досрочно, и вы перейдёте к итогам.",
    endRoundConfirm: "Закончить",
  },
  transfer: {
    import: "Импорт",
    export: "Экспорт",
    exportAll: "Экспорт всех списков",
    importAll: "Импорт списков",
    exportList: "Экспорт списка",
    importToList: "Импорт в этот список",
    exportTitleAll: "Экспорт всех списков",
    exportTitleList: (name: string) => `Экспорт «${name}»`,
    importTitleAll: "Импорт списков",
    importTitleList: (name: string) => `Импорт в «${name}»`,
    format: "Формат",
    formatHints: {
      xlsx: "Таблица: список, иконка, русское и английское слово, сложность. Удобно редактировать.",
      json: "Структурированный файл — для резервных копий и обмена между устройствами.",
      sql: "SQL-скрипт для SQLite: таблицы lists и words.",
    } as Record<"xlsx" | "json" | "sql", string>,
    exportButton: "Сохранить файл",
    saved: (name: string) => `Файл «${name}» сохранён`,
    importHintAll:
      "Выберите файл Excel, JSON или SQL. Списки с такими же названиями будут дополнены, остальные — созданы.",
    importHintList: "Выберите файл Excel, JSON или SQL. Все слова из файла будут добавлены в этот список.",
    importRules: "Слова проверяются как при ручном вводе, дубликаты пропускаются.",
    pickFile: "Выбрать файл",
    done: "Импорт завершён",
    added: "Добавлено слов",
    created: "Создано списков",
    updated: "Дополнено списков",
    duplicates: "Пропущено дубликатов",
    invalid: "Некорректных слов",
    examples: (list: string) => `Например: ${list}`,
    close: "Закрыть",
  },
  lists: {
    title: "Мои списки",
    emptyTitle: "Пока нет своих списков",
    emptyText:
      "Создайте список со своими словами — например, для компании друзей или по теме урока. Он появится в категориях при выборе игры.",
    newList: "Новый список",
    newTitle: "Новый список",
    editTitle: "Изменить список",
    name: "Название",
    namePlaceholder: "Например: Наша компания",
    icon: "Иконка",
  },
  editor: {
    ru: "Русское слово",
    en: "Английское слово",
    ruPlaceholder: "например, кошка",
    enPlaceholder: "e.g. cat",
    oneIsEnough: "Можно заполнить только одно поле",
    add: "Добавить",
    added: "Слово добавлено",
    empty: "В списке пока нет слов",
    play: "Играть этим списком",
    rename: "Переименовать",
    deleteList: "Удалить список",
    deleteTitle: "Удалить список?",
    deleteText: (name: string, n: number) =>
      `«${name}» и все его слова (${n}) будут удалены без возможности восстановления.`,
    editWord: "Изменить слово",
    tapHint: "Нажмите на слово, чтобы изменить его, или на уровень — чтобы сменить сложность",
    changeDifficulty: "Сменить сложность",
  },
};

export type Dict = typeof ru;

const en: Dict = {
  appName: "Explain!",
  tagline: "Explain words without saying them",
  common: {
    back: "Back",
    cancel: "Cancel",
    save: "Save",
    create: "Create",
    delete: "Delete",
    loading: "Loading…",
    actions: "Actions",
  },
  langs: { ru: "Russian", en: "English" },
  difficulty: { 1: "Easy", 2: "Medium", 3: "Hard" },
  words: (n: number) => `${n} ${n === 1 ? "word" : "words"}`,
  errors: {
    name_required: "Enter a name",
    word_required: "Fill in at least one field",
    invalid_ru: "Russian letters only (space or hyphen between words)",
    invalid_en: "English letters only (space, hyphen or apostrophe between words)",
    duplicate_ru: "This word is already in the list",
    duplicate_en: "This word is already in the list",
    readonly: "Built-in categories can't be changed",
    not_found: "Not found",
    export_empty: "Nothing to export — create a list first",
    import_empty: "No words found in the file",
    import_format: "Couldn't read the file. Supported: Excel (.xlsx), JSON and SQL",
    import_sql: "Error in the SQL file",
    file_too_large: "The file is too large (20 MB max)",
    read_failed: "Couldn't read the file",
    write_failed: "Couldn't save the file",
  },
  home: {
    play: "Play",
    myLists: "My word lists",
    settings: "Settings",
    howToPlay: "How to play",
    rules: [
      "The explainer sees a word and describes it to the others — with synonyms, descriptions, associations.",
      "You can't say the word itself, words with the same root, or translate it.",
      "Guessed — tap “Correct”. Stuck — tap “Skip”.",
      "When the time for a word runs out, it is skipped automatically.",
      "After each round you see how many words were explained and skipped. Tap a word to fix a mistake.",
    ],
  },
  settings: {
    title: "Settings",
    uiLang: "Interface language",
  },
  setup: {
    title: "New game",
    wordsLang: "Word language",
    time: "Time, seconds",
    perWord: "Per word",
    perWordHint: "0 — unlimited",
    round: "Round",
    roundHint: "10 to 900",
    penalty: "Skip penalty (−1 point)",
    difficulty: "Difficulty",
    difficultyHint: "Pick any number. None selected — words of every level.",
    categories: "Categories",
    categoriesHint: "Pick any number. None selected — random words from all built-in categories.",
    myLists: "My lists",
    reset: (n: number) => `Clear selection (${n})`,
    available: (n: number) => `Words available: ${n}`,
    noWords: "No words match the selected filters",
    start: "Start game",
  },
  game: {
    title: "Game",
    cantStart: "Can't start",
    noWords: "No words for the selected categories and difficulty.",
    toSetup: "Back to setup",
    passPhone: "Hand the phone to the explainer",
    round: (n: number) => `Round ${n}`,
    roundBadge: (time: string) => `Round ${time} s`,
    wordBadge: (s: number) => `Word ${s} s`,
    wordUnlimited: "No word limit",
    penaltyBadge: "Penalty −1",
    startRound: "Start round",
    colRound: "Round",
    guessed: "Explained",
    skipped: "Skipped",
    score: "Score",
    total: "Total",
    roundOver: (n: number) => `Round ${n} is over`,
    finish: "Finish",
    nextRound: "Next round",
    tapToFix: "Tap a word to fix its result",
    reasonTimeout: "word time ran out",
    reasonRoundEnd: "round ended",
    emptyRound: "No words this round",
    pause: "Paused",
    resume: "Resume",
    endRound: "End round",
    wordTime: "Time for this word",
    seconds: "s",
    skip: "Skip",
    accept: "Correct",
    endRoundTitle: "End the round?",
    endRoundText: "The current round will end early and you'll see the results.",
    endRoundConfirm: "End round",
  },
  transfer: {
    import: "Import",
    export: "Export",
    exportAll: "Export all lists",
    importAll: "Import lists",
    exportList: "Export list",
    importToList: "Import into this list",
    exportTitleAll: "Export all lists",
    exportTitleList: (name: string) => `Export “${name}”`,
    importTitleAll: "Import lists",
    importTitleList: (name: string) => `Import into “${name}”`,
    format: "Format",
    formatHints: {
      xlsx: "Spreadsheet: list, icon, Russian and English word, difficulty. Easy to edit.",
      json: "Structured file — for backups and moving lists between devices.",
      sql: "SQLite script with lists and words tables.",
    },
    exportButton: "Save file",
    saved: (name: string) => `Saved “${name}”`,
    importHintAll: "Pick an Excel, JSON or SQL file. Lists with the same name are extended, others are created.",
    importHintList: "Pick an Excel, JSON or SQL file. All its words will be added to this list.",
    importRules: "Words are validated like manual input; duplicates are skipped.",
    pickFile: "Choose file",
    done: "Import finished",
    added: "Words added",
    created: "Lists created",
    updated: "Lists extended",
    duplicates: "Duplicates skipped",
    invalid: "Invalid words",
    examples: (list: string) => `For example: ${list}`,
    close: "Close",
  },
  lists: {
    title: "My lists",
    emptyTitle: "No lists yet",
    emptyText:
      "Create a list with your own words — for your group of friends or a class topic. It will show up among the categories when you set up a game.",
    newList: "New list",
    newTitle: "New list",
    editTitle: "Edit list",
    name: "Name",
    namePlaceholder: "e.g. Our crew",
    icon: "Icon",
  },
  editor: {
    ru: "Russian word",
    en: "English word",
    ruPlaceholder: "напр. кошка",
    enPlaceholder: "e.g. cat",
    oneIsEnough: "Filling in just one field is fine",
    add: "Add",
    added: "Word added",
    empty: "No words in this list yet",
    play: "Play this list",
    rename: "Rename",
    deleteList: "Delete list",
    deleteTitle: "Delete the list?",
    deleteText: (name: string, n: number) => `“${name}” and all its words (${n}) will be permanently deleted.`,
    editWord: "Edit word",
    tapHint: "Tap a word to edit it, or its level to change difficulty",
    changeDifficulty: "Change difficulty",
  },
};

const DICTS: Record<UiLang, Dict> = { ru, en };
const KEY = "ui-lang";

function loadUiLang(): UiLang {
  try {
    return localStorage.getItem(KEY) === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}

interface I18n {
  lang: UiLang;
  t: Dict;
  setLang: (l: UiLang) => void;
  /** Translates `err.*` codes from the backend; passes other messages through. */
  errorText: (e: unknown) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<UiLang>(loadUiLang);

  const setLang = useCallback((l: UiLang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = DICTS[lang].appName;
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const t = DICTS[lang];
    return {
      lang,
      t,
      setLang,
      errorText: (e) => {
        const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
        if (!msg.startsWith("err.")) return msg;
        // "err.code|technical detail" → translated message + detail.
        const [code, ...detail] = msg.slice(4).split("|");
        const text = t.errors[code] ?? code;
        return detail.length ? `${text}: ${detail.join("|")}` : text;
      },
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
