//! SQLite storage: schema, built-in dictionary seeding and queries.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Built-in dictionary, compiled into the binary.
const SEED_JSON: &str = include_str!("../data/words.json");

const SCHEMA: &str = r#"
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Built-in categories have a `slug`; custom lists have `is_custom = 1` and no slug.
-- Both hold words in every language. `lang` is a legacy column (v1 lists were single-language).
CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY,
    slug       TEXT UNIQUE,
    name_ru    TEXT NOT NULL,
    name_en    TEXT NOT NULL,
    icon       TEXT NOT NULL DEFAULT '',
    is_custom  INTEGER NOT NULL DEFAULT 0,
    lang       TEXT CHECK (lang IN ('ru', 'en')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS words (
    id          INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    lang        TEXT NOT NULL CHECK (lang IN ('ru', 'en')),
    text        TEXT NOT NULL,
    difficulty  INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
    -- Custom lists: the ru and en variants of one entry share a pair_id. NULL for built-in words.
    pair_id     INTEGER,
    UNIQUE (category_id, lang, text)
);

CREATE INDEX IF NOT EXISTS idx_words_lookup ON words (lang, category_id, difficulty);
"#;

/// Errors are plain strings. User-facing ones are stable `err.*` codes the UI translates.
pub type DbResult<T> = Result<T, String>;

const SCHEMA_VERSION: i64 = 2;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

pub fn open(path: &Path) -> DbResult<Connection> {
    let conn = Connection::open(path).map_err(err)?;
    conn.execute_batch(SCHEMA).map_err(err)?;
    migrate(&conn)?;
    seed_builtin(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub(crate) fn open_in_memory_for_tests() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    migrate(&conn).unwrap();
    seed_builtin(&conn).unwrap();
    conn
}

fn migrate(conn: &Connection) -> DbResult<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(err)?;
    if version < 2 {
        // v1 → v2: custom lists become bilingual; each existing word becomes its own entry.
        let has_pair = conn
            .prepare("SELECT 1 FROM pragma_table_info('words') WHERE name = 'pair_id'")
            .and_then(|mut st| st.exists([]))
            .map_err(err)?;
        if !has_pair {
            conn.execute_batch("ALTER TABLE words ADD COLUMN pair_id INTEGER").map_err(err)?;
        }
        conn.execute_batch(
            "UPDATE words SET pair_id = id
               WHERE pair_id IS NULL AND category_id IN (SELECT id FROM categories WHERE is_custom = 1);
             UPDATE categories SET lang = NULL WHERE is_custom = 1;",
        )
        .map_err(err)?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_words_pair ON words (pair_id);")
        .map_err(err)?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION).map_err(err)
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SeedCategory {
    slug: String,
    ru: String,
    en: String,
    icon: String,
    /// lang -> [easy, medium, hard], each a comma-separated list.
    words: std::collections::BTreeMap<String, [String; 3]>,
}

/// FNV-1a: cheap content hash used to detect dictionary changes between app versions.
fn fnv1a(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

/// (Re)loads the built-in dictionary when it differs from what's in the DB.
/// Custom lists are never touched.
fn seed_builtin(conn: &Connection) -> DbResult<()> {
    let version = fnv1a(SEED_JSON);
    let current: Option<String> = conn
        .query_row("SELECT value FROM meta WHERE key = 'seed_version'", [], |r| r.get(0))
        .optional()
        .map_err(err)?;
    if current.as_deref() == Some(version.as_str()) {
        return Ok(());
    }

    let seed: Vec<SeedCategory> = serde_json::from_str(SEED_JSON).map_err(err)?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    {
        let mut upsert_cat = tx
            .prepare(
                "INSERT INTO categories (slug, name_ru, name_en, icon, is_custom, sort_order)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5)
                 ON CONFLICT (slug) DO UPDATE SET
                    name_ru = excluded.name_ru, name_en = excluded.name_en,
                    icon = excluded.icon, sort_order = excluded.sort_order
                 RETURNING id",
            )
            .map_err(err)?;
        let mut insert_word = tx
            .prepare(
                "INSERT OR IGNORE INTO words (category_id, lang, text, difficulty)
                 VALUES (?1, ?2, ?3, ?4)",
            )
            .map_err(err)?;

        tx.execute("DELETE FROM words WHERE category_id IN (SELECT id FROM categories WHERE is_custom = 0)", [])
            .map_err(err)?;

        let slugs: Vec<&str> = seed.iter().map(|c| c.slug.as_str()).collect();
        tx.execute(
            "DELETE FROM categories WHERE is_custom = 0 AND slug NOT IN (SELECT value FROM json_each(?1))",
            [serde_json::to_string(&slugs).map_err(err)?],
        )
        .map_err(err)?;

        for (order, cat) in seed.iter().enumerate() {
            let id: i64 = upsert_cat
                .query_row(params![cat.slug, cat.ru, cat.en, cat.icon, order as i64], |r| r.get(0))
                .map_err(err)?;
            for (lang, levels) in &cat.words {
                for (i, list) in levels.iter().enumerate() {
                    for word in list.split(',').map(str::trim).filter(|w| !w.is_empty()) {
                        insert_word
                            .execute(params![id, lang, word, (i + 1) as i64])
                            .map_err(err)?;
                    }
                }
            }
        }
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('seed_version', ?1)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            [&version],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: i64,
    pub name_ru: String,
    pub name_en: String,
    pub icon: String,
    pub is_custom: bool,
    /// Word counts for the requested language: [easy, medium, hard].
    pub counts: [i64; 3],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomList {
    pub id: i64,
    pub name: String,
    pub icon: String,
    /// Number of entries (ru/en pairs).
    pub entries: i64,
    pub ru_count: i64,
    pub en_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub id: i64,
    pub category_id: i64,
    pub text: String,
    pub difficulty: u8,
}

/// One custom-list entry: the same word in Russian and/or English.
#[derive(Serialize, Debug, PartialEq)]
pub struct Entry {
    pub id: i64,
    pub ru: Option<String>,
    pub en: Option<String>,
    pub difficulty: u8,
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn check_lang(lang: &str) -> DbResult<()> {
    match lang {
        "ru" | "en" => Ok(()),
        _ => Err(format!("unsupported language: {lang}")),
    }
}

fn check_difficulty(d: u8) -> DbResult<()> {
    if (1..=3).contains(&d) {
        Ok(())
    } else {
        Err(format!("difficulty must be 1..3, got {d}"))
    }
}

pub(crate) fn clean_name(name: &str) -> DbResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("err.name_required".into());
    }
    Ok(name.chars().take(60).collect())
}

const MAX_WORD_LEN: usize = 60;

fn is_ru_letter(c: char) -> bool {
    matches!(c, 'а'..='я' | 'А'..='Я' | 'ё' | 'Ё')
}

/// Letters of one alphabet, optionally split into parts by single separators
/// ("чёрная дыра", "фуа-гра", "rock'n'roll"). No leading/trailing/double separators.
fn is_valid_word(s: &str, is_letter: fn(char) -> bool, separators: &[char]) -> bool {
    let mut after_sep = true;
    for c in s.chars() {
        if is_letter(c) {
            after_sep = false;
        } else if separators.contains(&c) && !after_sep {
            after_sep = true;
        } else {
            return false;
        }
    }
    !after_sep
}

/// Trims and collapses whitespace; `None` for empty input. Errors with `err.invalid_<lang>`.
pub(crate) fn normalize_word(input: Option<&str>, lang: &str) -> DbResult<Option<String>> {
    let Some(raw) = input else { return Ok(None) };
    let text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Ok(None);
    }
    let ok = text.chars().count() <= MAX_WORD_LEN
        && match lang {
            "ru" => is_valid_word(&text, is_ru_letter, &[' ', '-']),
            _ => is_valid_word(&text, |c| c.is_ascii_alphabetic(), &[' ', '-', '\'']),
        };
    if ok {
        Ok(Some(text))
    } else {
        Err(format!("err.invalid_{lang}"))
    }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/// Built-in categories plus custom lists that have words in `lang`,
/// with per-difficulty word counts in `lang`.
pub fn list_categories(conn: &Connection, lang: &str) -> DbResult<Vec<Category>> {
    check_lang(lang)?;
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.name_ru, c.name_en, c.icon, c.is_custom,
                    COALESCE(SUM(w.difficulty = 1), 0),
                    COALESCE(SUM(w.difficulty = 2), 0),
                    COALESCE(SUM(w.difficulty = 3), 0)
             FROM categories c
             LEFT JOIN words w ON w.category_id = c.id AND w.lang = ?1
             GROUP BY c.id
             HAVING c.is_custom = 0 OR COUNT(w.id) > 0
             ORDER BY c.is_custom, c.sort_order, c.created_at, c.id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([lang], |r| {
            Ok(Category {
                id: r.get(0)?,
                name_ru: r.get(1)?,
                name_en: r.get(2)?,
                icon: r.get(3)?,
                is_custom: r.get(4)?,
                counts: [r.get(5)?, r.get(6)?, r.get(7)?],
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

const CUSTOM_LIST_SELECT: &str = "
    SELECT c.id, c.name_ru, c.icon,
           COUNT(DISTINCT w.pair_id),
           COALESCE(SUM(w.lang = 'ru'), 0),
           COALESCE(SUM(w.lang = 'en'), 0)
    FROM categories c
    LEFT JOIN words w ON w.category_id = c.id
    WHERE c.is_custom = 1";

fn custom_list_row(r: &rusqlite::Row) -> rusqlite::Result<CustomList> {
    Ok(CustomList {
        id: r.get(0)?,
        name: r.get(1)?,
        icon: r.get(2)?,
        entries: r.get(3)?,
        ru_count: r.get(4)?,
        en_count: r.get(5)?,
    })
}

pub fn list_custom_lists(conn: &Connection) -> DbResult<Vec<CustomList>> {
    let sql = format!("{CUSTOM_LIST_SELECT} GROUP BY c.id ORDER BY c.created_at DESC, c.id DESC");
    let mut stmt = conn.prepare(&sql).map_err(err)?;
    let rows = stmt.query_map([], custom_list_row).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

pub fn get_custom_list(conn: &Connection, id: i64) -> DbResult<CustomList> {
    let sql = format!("{CUSTOM_LIST_SELECT} AND c.id = ?1 GROUP BY c.id");
    conn.query_row(&sql, [id], custom_list_row)
        .optional()
        .map_err(err)?
        .ok_or_else(|| "err.not_found".to_string())
}

/// Random words for a game.
/// Empty `category_ids` = all built-in categories; empty `difficulties` = all levels.
/// `exclude` holds ids already shown in this game.
pub fn draw_words(
    conn: &Connection,
    lang: &str,
    category_ids: &[i64],
    difficulties: &[u8],
    exclude: &[i64],
    limit: u32,
) -> DbResult<Vec<Word>> {
    check_lang(lang)?;
    let json = |v: serde_json::Result<String>| v.unwrap_or_else(|_| "[]".into());
    let mut stmt = conn
        .prepare(
            "SELECT w.id, w.category_id, w.text, w.difficulty
             FROM words w JOIN categories c ON c.id = w.category_id
             WHERE w.lang = ?1
               AND (CASE WHEN json_array_length(?2) = 0
                         THEN c.is_custom = 0
                         ELSE w.category_id IN (SELECT value FROM json_each(?2)) END)
               AND (json_array_length(?3) = 0 OR w.difficulty IN (SELECT value FROM json_each(?3)))
               AND w.id NOT IN (SELECT value FROM json_each(?4))
             ORDER BY random()
             LIMIT ?5",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(
            params![
                lang,
                json(serde_json::to_string(category_ids)),
                json(serde_json::to_string(difficulties)),
                json(serde_json::to_string(exclude)),
                limit
            ],
            |r| {
                Ok(Word {
                    id: r.get(0)?,
                    category_id: r.get(1)?,
                    text: r.get(2)?,
                    difficulty: r.get(3)?,
                })
            },
        )
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Fails unless `id` is an existing custom list (built-in categories are read-only).
pub(crate) fn ensure_custom(conn: &Connection, id: i64) -> DbResult<()> {
    let is_custom: Option<bool> = conn
        .query_row("SELECT is_custom FROM categories WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(err)?;
    match is_custom {
        Some(true) => Ok(()),
        Some(false) => Err("err.readonly".into()),
        None => Err("err.not_found".into()),
    }
}

pub fn create_custom_list(conn: &Connection, name: &str, icon: &str) -> DbResult<CustomList> {
    let name = clean_name(name)?;
    conn.execute(
        "INSERT INTO categories (name_ru, name_en, icon, is_custom) VALUES (?1, ?1, ?2, 1)",
        params![name, icon.trim()],
    )
    .map_err(err)?;
    get_custom_list(conn, conn.last_insert_rowid())
}

pub fn update_custom_list(conn: &Connection, id: i64, name: &str, icon: &str) -> DbResult<CustomList> {
    ensure_custom(conn, id)?;
    let name = clean_name(name)?;
    conn.execute(
        "UPDATE categories SET name_ru = ?2, name_en = ?2, icon = ?3 WHERE id = ?1",
        params![id, name, icon.trim()],
    )
    .map_err(err)?;
    get_custom_list(conn, id)
}

pub fn delete_custom_list(conn: &Connection, id: i64) -> DbResult<()> {
    ensure_custom(conn, id)?;
    conn.execute("DELETE FROM categories WHERE id = ?1", [id]).map_err(err)?;
    Ok(())
}

pub fn list_entries(conn: &Connection, category_id: i64) -> DbResult<Vec<Entry>> {
    ensure_custom(conn, category_id)?;
    let mut stmt = conn
        .prepare(
            "SELECT pair_id, lang, text, difficulty FROM words
             WHERE category_id = ?1 ORDER BY pair_id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([category_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, u8>(3)?))
        })
        .map_err(err)?;
    let mut entries: Vec<Entry> = Vec::new();
    for row in rows {
        let (pair_id, lang, text, difficulty) = row.map_err(err)?;
        if entries.last().map(|e| e.id) != Some(pair_id) {
            entries.push(Entry { id: pair_id, ru: None, en: None, difficulty });
        }
        let e = entries.last_mut().expect("just pushed");
        if lang == "ru" {
            e.ru = Some(text);
        } else {
            e.en = Some(text);
        }
    }
    let key = |e: &Entry| e.ru.as_deref().or(e.en.as_deref()).unwrap_or("").to_lowercase();
    entries.sort_by(|a, b| a.difficulty.cmp(&b.difficulty).then_with(|| key(a).cmp(&key(b))));
    Ok(entries)
}

/// Validates an entry and checks both variants against the rest of the list.
fn prepare_entry(
    conn: &Connection,
    category_id: i64,
    except_pair: Option<i64>,
    ru: Option<&str>,
    en: Option<&str>,
    difficulty: u8,
) -> DbResult<(Option<String>, Option<String>)> {
    ensure_custom(conn, category_id)?;
    check_difficulty(difficulty)?;
    let ru = normalize_word(ru, "ru")?;
    let en = normalize_word(en, "en")?;
    if ru.is_none() && en.is_none() {
        return Err("err.word_required".into());
    }
    // Case-insensitive duplicate check in Rust: SQLite's lower() only folds ASCII.
    let mut stmt = conn
        .prepare("SELECT text FROM words WHERE category_id = ?1 AND lang = ?2 AND pair_id IS NOT ?3")
        .map_err(err)?;
    for (lang, text) in [("ru", &ru), ("en", &en)] {
        let Some(text) = text else { continue };
        let needle = text.to_lowercase();
        let mut rows = stmt.query(params![category_id, lang, except_pair]).map_err(err)?;
        while let Some(row) = rows.next().map_err(err)? {
            if row.get::<_, String>(0).map_err(err)?.to_lowercase() == needle {
                return Err(format!("err.duplicate_{lang}"));
            }
        }
    }
    Ok((ru, en))
}

pub(crate) fn insert_entry(
    conn: &Connection,
    category_id: i64,
    pair_id: i64,
    ru: &Option<String>,
    en: &Option<String>,
    difficulty: u8,
) -> DbResult<()> {
    let mut stmt = conn
        .prepare("INSERT INTO words (category_id, lang, text, difficulty, pair_id) VALUES (?1, ?2, ?3, ?4, ?5)")
        .map_err(err)?;
    for (lang, text) in [("ru", ru), ("en", en)] {
        if let Some(text) = text {
            stmt.execute(params![category_id, lang, text, difficulty, pair_id]).map_err(err)?;
        }
    }
    Ok(())
}

pub fn add_entry(
    conn: &Connection,
    category_id: i64,
    ru: Option<&str>,
    en: Option<&str>,
    difficulty: u8,
) -> DbResult<Entry> {
    let (ru, en) = prepare_entry(conn, category_id, None, ru, en, difficulty)?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    // MAX+1 never collides: a pair id is only reused once all of its rows are gone.
    let pair_id: i64 = tx
        .query_row("SELECT COALESCE(MAX(pair_id), 0) + 1 FROM words", [], |r| r.get(0))
        .map_err(err)?;
    insert_entry(&tx, category_id, pair_id, &ru, &en, difficulty)?;
    tx.commit().map_err(err)?;
    Ok(Entry { id: pair_id, ru, en, difficulty })
}

fn ensure_entry_in_list(conn: &Connection, category_id: i64, pair_id: i64) -> DbResult<()> {
    let found = conn
        .prepare("SELECT 1 FROM words WHERE category_id = ?1 AND pair_id = ?2")
        .and_then(|mut st| st.exists(params![category_id, pair_id]))
        .map_err(err)?;
    if found {
        Ok(())
    } else {
        Err("err.not_found".into())
    }
}

pub fn update_entry(
    conn: &Connection,
    category_id: i64,
    pair_id: i64,
    ru: Option<&str>,
    en: Option<&str>,
    difficulty: u8,
) -> DbResult<Entry> {
    ensure_custom(conn, category_id)?;
    ensure_entry_in_list(conn, category_id, pair_id)?;
    let (ru, en) = prepare_entry(conn, category_id, Some(pair_id), ru, en, difficulty)?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    tx.execute("DELETE FROM words WHERE pair_id = ?1", [pair_id]).map_err(err)?;
    insert_entry(&tx, category_id, pair_id, &ru, &en, difficulty)?;
    tx.commit().map_err(err)?;
    Ok(Entry { id: pair_id, ru, en, difficulty })
}

pub fn delete_entry(conn: &Connection, category_id: i64, pair_id: i64) -> DbResult<()> {
    ensure_custom(conn, category_id)?;
    ensure_entry_in_list(conn, category_id, pair_id)?;
    conn.execute("DELETE FROM words WHERE category_id = ?1 AND pair_id = ?2", params![category_id, pair_id])
        .map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        open_in_memory_for_tests()
    }

    #[test]
    fn seed_is_idempotent_and_complete() {
        let conn = mem();
        seed_builtin(&conn).unwrap();
        let cats = list_categories(&conn, "ru").unwrap();
        assert!(cats.len() >= 10);
        for c in &cats {
            assert!(c.counts.iter().all(|&n| n >= 10), "{} has too few ru words: {:?}", c.name_ru, c.counts);
        }
        for c in list_categories(&conn, "en").unwrap() {
            assert!(c.counts.iter().all(|&n| n >= 10), "{} has too few en words: {:?}", c.name_en, c.counts);
        }
    }

    #[test]
    fn draw_filters() {
        let conn = mem();
        let cats = list_categories(&conn, "ru").unwrap();
        let space = cats.iter().find(|c| c.name_en == "Space").unwrap();
        let words = draw_words(&conn, "ru", &[space.id], &[1], &[], 1000).unwrap();
        assert_eq!(words.len() as i64, space.counts[0]);
        assert!(words.iter().all(|w| w.category_id == space.id && w.difficulty == 1));

        let excluded: Vec<i64> = words.iter().take(3).map(|w| w.id).collect();
        let rest = draw_words(&conn, "ru", &[space.id], &[1], &excluded, 1000).unwrap();
        assert_eq!(rest.len(), words.len() - 3);

        let all = draw_words(&conn, "en", &[], &[], &[], 100_000).unwrap();
        let total: i64 = list_categories(&conn, "en").unwrap().iter().map(|c| c.counts.iter().sum::<i64>()).sum();
        assert_eq!(all.len() as i64, total);
    }

    #[test]
    fn word_validation() {
        let ok = |s: &str, l: &str| normalize_word(Some(s), l).unwrap();
        assert_eq!(ok("  чёрная   дыра ", "ru").as_deref(), Some("чёрная дыра"));
        assert_eq!(ok("фуа-гра", "ru").as_deref(), Some("фуа-гра"));
        assert_eq!(ok("rock'n'roll", "en").as_deref(), Some("rock'n'roll"));
        assert_eq!(ok("   ", "ru"), None);
        for bad in ["cat", "кот1", "кот-", "-кот", "кот--пёс", "кот!"] {
            assert_eq!(normalize_word(Some(bad), "ru"), Err("err.invalid_ru".into()), "{bad}");
        }
        for bad in ["кот", "cat2", "café", "cat'", "a  -b"] {
            assert_eq!(normalize_word(Some(bad), "en"), Err("err.invalid_en".into()), "{bad}");
        }
    }

    #[test]
    fn custom_lists() {
        let conn = mem();
        let list = create_custom_list(&conn, "  Друзья ", "🎉").unwrap();
        assert_eq!(list.name, "Друзья");

        let both = add_entry(&conn, list.id, Some("Шашлыки"), Some("Barbecue"), 1).unwrap();
        let ru_only = add_entry(&conn, list.id, Some("дача"), None, 3).unwrap();
        assert_eq!(add_entry(&conn, list.id, Some("шашлыки"), None, 2), Err("err.duplicate_ru".into()));
        assert_eq!(add_entry(&conn, list.id, None, Some("BARBECUE"), 2), Err("err.duplicate_en".into()));
        assert_eq!(add_entry(&conn, list.id, Some(" "), Some(""), 2), Err("err.word_required".into()));
        assert_eq!(add_entry(&conn, list.id, Some("dacha"), None, 2), Err("err.invalid_ru".into()));

        let l = get_custom_list(&conn, list.id).unwrap();
        assert_eq!((l.entries, l.ru_count, l.en_count), (2, 2, 1));
        assert_eq!(list_entries(&conn, list.id).unwrap(), vec![
            Entry { id: both.id, ru: Some("Шашлыки".into()), en: Some("Barbecue".into()), difficulty: 1 },
            Entry { id: ru_only.id, ru: Some("дача".into()), en: None, difficulty: 3 },
        ]);

        // Shows up per language only when it has words in that language; never in the "all" pool.
        assert!(list_categories(&conn, "ru").unwrap().iter().any(|c| c.id == list.id && c.counts == [1, 0, 1]));
        assert!(list_categories(&conn, "en").unwrap().iter().any(|c| c.id == list.id && c.counts == [1, 0, 0]));
        let all = draw_words(&conn, "ru", &[], &[], &[], 100_000).unwrap();
        assert!(all.iter().all(|w| w.category_id != list.id));
        assert_eq!(draw_words(&conn, "en", &[list.id], &[], &[], 10).unwrap().len(), 1);

        // Update: add a translation, change difficulty; keeping its own text is not a duplicate.
        let upd = update_entry(&conn, list.id, ru_only.id, Some("Дача"), Some("country house"), 2).unwrap();
        assert_eq!(upd.en.as_deref(), Some("country house"));
        assert_eq!(update_entry(&conn, list.id, ru_only.id, Some("шашлыки"), None, 2), Err("err.duplicate_ru".into()));
        assert_eq!(get_custom_list(&conn, list.id).unwrap().en_count, 2);
        // Removing one variant keeps the other.
        update_entry(&conn, list.id, both.id, None, Some("Barbecue"), 1).unwrap();
        assert_eq!(get_custom_list(&conn, list.id).unwrap().ru_count, 1);

        delete_entry(&conn, list.id, both.id).unwrap();
        assert_eq!(get_custom_list(&conn, list.id).unwrap().entries, 1);
        // New ids never collide with a surviving entry.
        let next = add_entry(&conn, list.id, Some("баня"), None, 1).unwrap();
        assert_ne!(next.id, ru_only.id);

        // Built-in categories are read-only.
        let builtin = list_categories(&conn, "ru").unwrap()[0].id;
        assert_eq!(add_entry(&conn, builtin, Some("кот"), None, 1), Err("err.readonly".into()));
        assert!(delete_custom_list(&conn, builtin).is_err());

        delete_custom_list(&conn, list.id).unwrap();
        assert_eq!(get_custom_list(&conn, list.id).err(), Some("err.not_found".into()));
    }

    #[test]
    fn migrates_v1_lists() {
        let conn = Connection::open_in_memory().unwrap();
        // v1 schema: no pair_id, single-language custom lists.
        conn.execute_batch(
            "CREATE TABLE categories (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name_ru TEXT NOT NULL,
                name_en TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '', is_custom INTEGER NOT NULL DEFAULT 0,
                lang TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE words (id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES categories(id)
                ON DELETE CASCADE, lang TEXT NOT NULL, text TEXT NOT NULL, difficulty INTEGER NOT NULL,
                UNIQUE (category_id, lang, text));
             INSERT INTO categories (id, name_ru, name_en, is_custom, lang) VALUES (1, 'Old', 'Old', 1, 'en');
             INSERT INTO words (category_id, lang, text, difficulty) VALUES (1, 'en', 'cat', 1), (1, 'en', 'dog', 2);",
        )
        .unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        migrate(&conn).unwrap();
        seed_builtin(&conn).unwrap();
        let entries = list_entries(&conn, 1).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|e| e.ru.is_none() && e.en.is_some()));
        add_entry(&conn, 1, Some("кот"), None, 1).unwrap();
        assert_eq!(get_custom_list(&conn, 1).unwrap().entries, 3);
    }
}
