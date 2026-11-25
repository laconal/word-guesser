//! Import/export of custom word lists: Excel (.xlsx), JSON and SQL.
//!
//! All three formats carry the same data: lists (name, icon) with words (ru, en, difficulty).
//! Import never trusts the file: every word goes through the same validation as manual input,
//! duplicates are skipped, and SQL is executed only inside a locked-down in-memory database.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::time::{Duration, Instant};

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::types::Value;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::db::{self, DbResult};

/// Refuse anything bigger: word lists are tiny, and this bounds memory and parse time.
pub const MAX_IMPORT_BYTES: usize = 20 * 1024 * 1024;
const DEFAULT_ICON: &str = "📝";
const FORMAT_ID: &str = "word-lists";
const APP_ID: &str = "obyasni";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileFormat {
    Xlsx,
    Json,
    Sql,
}

impl FileFormat {
    pub fn parse(s: &str) -> DbResult<Self> {
        match s {
            "xlsx" => Ok(Self::Xlsx),
            "json" => Ok(Self::Json),
            "sql" => Ok(Self::Sql),
            _ => Err(format!("unsupported format: {s}")),
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Xlsx => "xlsx",
            Self::Json => "json",
            Self::Sql => "sql",
        }
    }

    /// MIME type for Android's "create document" dialog. SQL has no registered type there,
    /// and octet-stream keeps the provider from appending its own extension.
    #[cfg_attr(not(target_os = "android"), allow(dead_code))]
    pub fn mime(self) -> &'static str {
        match self {
            Self::Xlsx => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            Self::Json => "application/json",
            Self::Sql => "application/octet-stream",
        }
    }
}

// ---------------------------------------------------------------------------
// Data model shared by all formats
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ListData {
    pub name: String,
    pub icon: String,
    pub words: Vec<WordData>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct WordData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ru: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub en: Option<String>,
    pub difficulty: u8,
}

/// A word as read from a file, before validation.
#[derive(Debug, Clone, PartialEq)]
pub struct RawWord {
    pub ru: Option<String>,
    pub en: Option<String>,
    /// `None` when the file had an unrecognizable difficulty.
    pub difficulty: Option<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawList {
    pub name: String,
    pub icon: String,
    pub words: Vec<RawWord>,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub lists_created: usize,
    pub lists_updated: usize,
    pub added: usize,
    pub duplicates: usize,
    pub invalid: usize,
    /// A few of the rejected words, to show the user what went wrong.
    pub invalid_samples: Vec<String>,
}

fn difficulty_labels(ui_lang: &str) -> [&'static str; 3] {
    if ui_lang == "en" {
        ["Easy", "Medium", "Hard"]
    } else {
        ["Лёгкий", "Средний", "Сложный"]
    }
}

/// Accepts 1–3 (also "2.0" from spreadsheets) and level names in either language.
/// Empty means "not specified" → medium.
fn parse_difficulty(raw: &str) -> Option<u8> {
    let s = raw.trim().to_lowercase();
    match s.as_str() {
        "" => Some(2),
        "1" | "1.0" | "easy" | "лёгкий" | "легкий" | "лёгкая" | "легкая" => Some(1),
        "2" | "2.0" | "medium" | "средний" | "средняя" => Some(2),
        "3" | "3.0" | "hard" | "сложный" | "сложная" => Some(3),
        _ => None,
    }
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Groups flat rows (list name, icon, word) into lists, keeping first-seen order.
#[derive(Default)]
struct ListBuilder {
    lists: Vec<RawList>,
    index: HashMap<String, usize>,
}

impl ListBuilder {
    fn push(&mut self, name: &str, icon: Option<String>, word: RawWord) {
        let key = name.trim().to_lowercase();
        let i = *self.index.entry(key).or_insert_with(|| {
            self.lists.push(RawList { name: name.trim().to_string(), icon: String::new(), words: Vec::new() });
            self.lists.len() - 1
        });
        let list = &mut self.lists[i];
        if list.icon.is_empty() {
            if let Some(icon) = non_empty(icon) {
                list.icon = icon;
            }
        }
        list.words.push(word);
    }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// One custom list, or all of them (oldest first) when `list_id` is `None`.
pub fn collect(conn: &Connection, list_id: Option<i64>) -> DbResult<Vec<ListData>> {
    let mut lists = match list_id {
        Some(id) => vec![db::get_custom_list(conn, id)?],
        None => db::list_custom_lists(conn)?,
    };
    lists.reverse(); // list_custom_lists is newest-first
    lists
        .into_iter()
        .map(|l| {
            let words = db::list_entries(conn, l.id)?
                .into_iter()
                .map(|e| WordData { ru: e.ru, en: e.en, difficulty: e.difficulty })
                .collect();
            Ok(ListData { name: l.name, icon: l.icon, words })
        })
        .collect()
}

pub fn export(lists: &[ListData], format: FileFormat, ui_lang: &str) -> DbResult<Vec<u8>> {
    match format {
        FileFormat::Json => to_json(lists),
        FileFormat::Sql => Ok(to_sql(lists).into_bytes()),
        FileFormat::Xlsx => to_xlsx(lists, ui_lang),
    }
}

/// Suggested file name: the list's name for a single list, a generic one for "all".
pub fn file_name(lists: &[ListData], single: bool, format: FileFormat) -> String {
    let base = match lists.first() {
        Some(l) if single => l
            .name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' })
            .collect::<String>()
            .trim()
            .to_string(),
        _ => String::new(),
    };
    let base = if base.is_empty() { "obyasni-lists".to_string() } else { base };
    format!("{base}.{}", format.extension())
}

#[derive(Serialize)]
struct JsonExport<'a> {
    app: &'a str,
    format: &'a str,
    version: u32,
    lists: &'a [ListData],
}

fn to_json(lists: &[ListData]) -> DbResult<Vec<u8>> {
    serde_json::to_vec_pretty(&JsonExport { app: APP_ID, format: FORMAT_ID, version: 1, lists })
        .map_err(|e| e.to_string())
}

fn sql_str(s: Option<&str>) -> String {
    match s {
        Some(s) => format!("'{}'", s.replace('\'', "''")),
        None => "NULL".into(),
    }
}

const SQL_SCHEMA: &str = "\
CREATE TABLE IF NOT EXISTS lists (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS words (
    list_id    INTEGER NOT NULL REFERENCES lists(id),
    ru         TEXT,
    en         TEXT,
    difficulty INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3)
);
";

/// A plain SQLite script: runnable as-is in any SQLite tool, and importable back.
fn to_sql(lists: &[ListData]) -> String {
    let mut out = format!(
        "-- Объясни! / Explain! — word lists ({APP_ID}:{FORMAT_ID} v1)\n\
         -- difficulty: 1 = easy, 2 = medium, 3 = hard\n\n\
         BEGIN TRANSACTION;\n{SQL_SCHEMA}\n"
    );
    for (i, list) in lists.iter().enumerate() {
        let id = i + 1;
        out.push_str(&format!(
            "INSERT INTO lists (id, name, icon) VALUES ({id}, {}, {});\n",
            sql_str(Some(&list.name)),
            sql_str(Some(&list.icon))
        ));
        for w in &list.words {
            out.push_str(&format!(
                "INSERT INTO words (list_id, ru, en, difficulty) VALUES ({id}, {}, {}, {});\n",
                sql_str(w.ru.as_deref()),
                sql_str(w.en.as_deref()),
                w.difficulty
            ));
        }
        out.push('\n');
    }
    out.push_str("COMMIT;\n");
    out
}

fn xlsx_headers(ui_lang: &str) -> [&'static str; 5] {
    if ui_lang == "en" {
        ["List", "Icon", "Russian", "English", "Difficulty"]
    } else {
        ["Список", "Иконка", "Русский", "Английский", "Сложность"]
    }
}

/// One flat sheet — easiest to edit and to fill in by hand.
fn to_xlsx(lists: &[ListData], ui_lang: &str) -> DbResult<Vec<u8>> {
    use rust_xlsxwriter::{DataValidation, Format, Workbook};
    let e = |e: rust_xlsxwriter::XlsxError| e.to_string();

    let labels = difficulty_labels(ui_lang);
    let mut wb = Workbook::new();
    let ws = wb.add_worksheet();
    ws.set_name(if ui_lang == "en" { "Words" } else { "Слова" }).map_err(e)?;

    let bold = Format::new().set_bold();
    for (col, h) in xlsx_headers(ui_lang).iter().enumerate() {
        ws.write_string_with_format(0, col as u16, *h, &bold).map_err(e)?;
    }
    let mut row: u32 = 1;
    for list in lists {
        for w in &list.words {
            ws.write_string(row, 0, &list.name).map_err(e)?;
            ws.write_string(row, 1, &list.icon).map_err(e)?;
            if let Some(ru) = &w.ru {
                ws.write_string(row, 2, ru).map_err(e)?;
            }
            if let Some(en) = &w.en {
                ws.write_string(row, 3, en).map_err(e)?;
            }
            ws.write_string(row, 4, labels[(w.difficulty - 1) as usize]).map_err(e)?;
            row += 1;
        }
    }
    for (col, width) in [(0, 24.0), (1, 8.0), (2, 28.0), (3, 28.0), (4, 14.0)] {
        ws.set_column_width(col, width).map_err(e)?;
    }
    ws.set_freeze_panes(1, 0).map_err(e)?;
    ws.autofilter(0, 0, row.max(1) - 1, 4).map_err(e)?;
    // Drop-down for difficulty, with room for rows added by hand.
    let dv = DataValidation::new().allow_list_strings(&labels).map_err(e)?;
    ws.add_data_validation(1, 4, row + 1000, 4, &dv).map_err(e)?;

    wb.save_to_buffer().map_err(e)
}

// ---------------------------------------------------------------------------
// Parsing (format is detected from content, not from the file name —
// Android pickers hand out content:// URIs without a reliable extension)
// ---------------------------------------------------------------------------

pub fn parse(bytes: &[u8], default_name: &str) -> DbResult<Vec<RawList>> {
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err("err.file_too_large".into());
    }
    let lists = if bytes.starts_with(b"PK\x03\x04") {
        parse_xlsx(bytes, default_name)?
    } else {
        let text = std::str::from_utf8(bytes).map_err(|_| "err.import_format".to_string())?;
        let text = text.trim_start_matches('\u{feff}');
        match text.trim_start().chars().next() {
            Some('{') | Some('[') => parse_json(text, default_name)?,
            Some(_) => parse_sql(text, default_name)?,
            None => Vec::new(),
        }
    };
    if lists.iter().all(|l| l.words.is_empty()) {
        return Err("err.import_empty".into());
    }
    Ok(lists)
}

#[derive(Deserialize)]
#[serde(untagged)]
enum JsonImport {
    File { lists: Vec<JsonList> },
    Lists(Vec<JsonList>),
}

#[derive(Deserialize)]
struct JsonList {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    words: Vec<JsonWord>,
}

#[derive(Deserialize)]
struct JsonWord {
    #[serde(default)]
    ru: Option<String>,
    #[serde(default)]
    en: Option<String>,
    #[serde(default)]
    difficulty: Option<serde_json::Value>,
}

fn json_difficulty(v: Option<serde_json::Value>) -> Option<u8> {
    match v {
        None | Some(serde_json::Value::Null) => Some(2),
        Some(serde_json::Value::Number(n)) => parse_difficulty(&n.to_string()),
        Some(serde_json::Value::String(s)) => parse_difficulty(&s),
        Some(_) => None,
    }
}

fn parse_json(text: &str, default_name: &str) -> DbResult<Vec<RawList>> {
    let parsed: JsonImport =
        serde_json::from_str(text).map_err(|e| format!("err.import_format|{e}"))?;
    let lists = match parsed {
        JsonImport::File { lists } | JsonImport::Lists(lists) => lists,
    };
    let mut b = ListBuilder::default();
    for l in lists {
        let name = non_empty(l.name).unwrap_or_else(|| default_name.to_string());
        for w in l.words {
            let word = RawWord { ru: non_empty(w.ru), en: non_empty(w.en), difficulty: json_difficulty(w.difficulty) };
            b.push(&name, l.icon.clone(), word);
        }
    }
    Ok(b.lists)
}

fn cell_text(c: &calamine::Data) -> String {
    use calamine::Data;
    match c {
        Data::Empty => String::new(),
        Data::String(s) => s.trim().to_string(),
        Data::Float(f) if f.fract() == 0.0 => format!("{}", *f as i64),
        other => other.to_string().trim().to_string(),
    }
}

fn is_header_row(cells: &[String]) -> bool {
    let known = |s: &str| {
        matches!(
            s.to_lowercase().as_str(),
            "русский" | "russian" | "английский" | "english" | "ru" | "en" | "сложность" | "difficulty"
        )
    };
    let difficulty = cells.get(4).map(String::as_str).unwrap_or("");
    (!difficulty.is_empty() && parse_difficulty(difficulty).is_none())
        || cells.get(2).is_some_and(|s| known(s))
        || cells.get(3).is_some_and(|s| known(s))
}

/// Columns: list, icon, russian, english, difficulty. A header row is detected and skipped;
/// every sheet is read.
fn parse_xlsx(bytes: &[u8], default_name: &str) -> DbResult<Vec<RawList>> {
    use calamine::{open_workbook_auto_from_rs, Reader};
    let mut wb = open_workbook_auto_from_rs(Cursor::new(bytes.to_vec()))
        .map_err(|e| format!("err.import_format|{e}"))?;
    let mut b = ListBuilder::default();
    for sheet in wb.sheet_names().to_owned() {
        let range = wb.worksheet_range(&sheet).map_err(|e| format!("err.import_format|{e}"))?;
        for (i, row) in range.rows().enumerate() {
            let cells: Vec<String> = row.iter().take(5).map(cell_text).collect();
            if cells.iter().all(String::is_empty) || (i == 0 && is_header_row(&cells)) {
                continue;
            }
            let get = |n: usize| cells.get(n).cloned().filter(|s| !s.is_empty());
            let name = get(0).unwrap_or_else(|| default_name.to_string());
            let word = RawWord {
                ru: get(2),
                en: get(3),
                difficulty: parse_difficulty(&get(4).unwrap_or_default()),
            };
            b.push(&name, get(1), word);
        }
    }
    Ok(b.lists)
}

fn value_text(v: Value) -> Option<String> {
    match v {
        Value::Text(s) => non_empty(Some(s)),
        Value::Integer(i) => Some(i.to_string()),
        Value::Real(r) => Some(r.to_string()),
        Value::Null | Value::Blob(_) => None,
    }
}

/// Runs the script in a throwaway in-memory database that only allows creating tables,
/// inserting/reading rows and transactions — no ATTACH, PRAGMA, VACUUM INTO, etc. —
/// with a time limit, then reads the `lists`/`words` tables back.
fn parse_sql(text: &str, default_name: &str) -> DbResult<Vec<RawList>> {
    let mut sandbox = Connection::open_in_memory().map_err(|e| e.to_string())?;
    // Untyped staging tables: bad values become "invalid" words instead of failing the script.
    sandbox
        .execute_batch(
            "CREATE TABLE lists (id INTEGER PRIMARY KEY, name, icon);
             CREATE TABLE words (list_id, ru, en, difficulty);",
        )
        .map_err(|e| e.to_string())?;

    sandbox
        .authorizer(Some(|ctx: AuthContext<'_>| match ctx.action {
            AuthAction::Insert { .. }
            | AuthAction::Read { .. }
            | AuthAction::Select
            | AuthAction::CreateTable { .. }
            | AuthAction::CreateIndex { .. }
            | AuthAction::Update { .. }
            | AuthAction::Delete { .. }
            | AuthAction::Transaction { .. }
            | AuthAction::Savepoint { .. }
            | AuthAction::Function { .. } => Authorization::Allow,
            _ => Authorization::Deny,
        }))
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    sandbox
        .progress_handler(10_000, Some(move || started.elapsed() > Duration::from_secs(5)))
        .map_err(|e| e.to_string())?;

    sandbox.execute_batch(text).map_err(|e| format!("err.import_sql|{e}"))?;

    sandbox.authorizer(None::<fn(AuthContext<'_>) -> Authorization>).map_err(|e| e.to_string())?;
    sandbox.progress_handler(0, None::<fn() -> bool>).map_err(|e| e.to_string())?;

    let read = |sql: &str, cols: usize| -> DbResult<Vec<Vec<Value>>> {
        let mut stmt = sandbox.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| (0..cols).map(|i| r.get::<_, Value>(i)).collect::<Result<Vec<_>, _>>())
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    };

    let mut names: HashMap<i64, (String, Option<String>)> = HashMap::new();
    for row in read("SELECT id, name, icon FROM lists ORDER BY id", 3)? {
        let mut it = row.into_iter();
        let Some(Value::Integer(id)) = it.next() else { continue };
        let name = it.next().and_then(value_text).unwrap_or_else(|| default_name.to_string());
        names.insert(id, (name, it.next().and_then(value_text)));
    }
    let mut b = ListBuilder::default();
    // Lists in id order first, so empty-looking gaps don't reorder them.
    let mut ordered: Vec<_> = names.iter().collect();
    ordered.sort_by_key(|(id, _)| **id);
    let mut words: HashMap<Option<i64>, Vec<RawWord>> = HashMap::new();
    for row in read("SELECT list_id, ru, en, difficulty FROM words ORDER BY rowid", 4)? {
        let mut it = row.into_iter();
        let list_id = match it.next() {
            Some(Value::Integer(id)) if names.contains_key(&id) => Some(id),
            _ => None,
        };
        let ru = it.next().and_then(value_text);
        let en = it.next().and_then(value_text);
        let difficulty = parse_difficulty(&it.next().and_then(value_text).unwrap_or_default());
        words.entry(list_id).or_default().push(RawWord { ru, en, difficulty });
    }
    for (id, (name, icon)) in ordered {
        for w in words.remove(&Some(*id)).unwrap_or_default() {
            b.push(name, icon.clone(), w);
        }
    }
    for w in words.remove(&None).unwrap_or_default() {
        b.push(default_name, None, w);
    }
    Ok(b.lists)
}

// ---------------------------------------------------------------------------
// Import into the database
// ---------------------------------------------------------------------------

/// Imports parsed lists. With `target`, every word goes into that list; otherwise each list
/// is merged into the custom list of the same name (case-insensitive) or created.
/// Runs in one transaction: either everything valid is imported, or nothing.
pub fn import(conn: &Connection, lists: Vec<RawList>, target: Option<i64>) -> DbResult<ImportReport> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if let Some(t) = target {
        db::ensure_custom(&tx, t)?;
    }
    let mut by_name: HashMap<String, i64> = db::list_custom_lists(&tx)?
        .into_iter()
        .map(|l| (l.name.to_lowercase(), l.id))
        .collect();
    let mut next_pair: i64 = tx
        .query_row("SELECT COALESCE(MAX(pair_id), 0) FROM words", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    // Lower-cased texts per (list, lang), loaded on first use.
    let mut seen: HashMap<(i64, &'static str), HashSet<String>> = HashMap::new();
    let mut report = ImportReport::default();
    let mut touched: HashSet<i64> = HashSet::new();

    for list in lists {
        let name = db::clean_name(&list.name).unwrap_or_else(|_| "Import".into());
        let mut list_id = target.or_else(|| by_name.get(&name.to_lowercase()).copied());

        for w in list.words {
            let sample = || w.ru.clone().or(w.en.clone()).unwrap_or_default();
            let (ru, en, difficulty) = match (
                db::normalize_word(w.ru.as_deref(), "ru"),
                db::normalize_word(w.en.as_deref(), "en"),
                w.difficulty,
            ) {
                (Ok(None), Ok(None), _) => continue, // blank row
                (Ok(ru), Ok(en), Some(d)) if (1..=3).contains(&d) => (ru, en, d),
                _ => {
                    report.invalid += 1;
                    if report.invalid_samples.len() < 5 {
                        report.invalid_samples.push(sample());
                    }
                    continue;
                }
            };

            // Create the list lazily, so a file of only invalid words doesn't leave an empty list.
            let id = match list_id {
                Some(id) => id,
                None => {
                    let icon = non_empty(Some(list.icon.clone()))
                        .map(|i| i.chars().take(8).collect())
                        .unwrap_or_else(|| DEFAULT_ICON.to_string());
                    let created = db::create_custom_list(&tx, &name, &icon)?;
                    by_name.insert(name.to_lowercase(), created.id);
                    report.lists_created += 1;
                    touched.insert(created.id);
                    list_id = Some(created.id);
                    created.id
                }
            };
            let mut is_dup = false;
            for (lang, text) in [("ru", &ru), ("en", &en)] {
                let Some(text) = text else { continue };
                let set = match seen.entry((id, lang)) {
                    std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
                    std::collections::hash_map::Entry::Vacant(e) => e.insert(existing_texts(&tx, id, lang)?),
                };
                is_dup |= set.contains(&text.to_lowercase());
            }
            if is_dup {
                report.duplicates += 1;
                continue;
            }
            for (lang, text) in [("ru", &ru), ("en", &en)] {
                if let (Some(text), Some(set)) = (text, seen.get_mut(&(id, lang))) {
                    set.insert(text.to_lowercase());
                }
            }
            next_pair += 1;
            db::insert_entry(&tx, id, next_pair, &ru, &en, difficulty)?;
            report.added += 1;
            if target.is_none() && touched.insert(id) {
                report.lists_updated += 1; // an existing list that actually received words
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(report)
}

fn existing_texts(conn: &Connection, list_id: i64, lang: &str) -> DbResult<HashSet<String>> {
    let mut stmt = conn
        .prepare("SELECT text FROM words WHERE category_id = ?1 AND lang = ?2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![list_id, lang], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.map(|t| t.map(|t| t.to_lowercase())).collect::<Result<_, _>>().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_db() -> (Connection, i64) {
        let conn = db::open_in_memory_for_tests();
        let list = db::create_custom_list(&conn, "Друзья", "🎉").unwrap();
        db::add_entry(&conn, list.id, Some("кот"), Some("cat"), 1).unwrap();
        db::add_entry(&conn, list.id, Some("рок-н-ролл"), Some("rock'n'roll"), 3).unwrap();
        db::add_entry(&conn, list.id, None, Some("dog"), 2).unwrap();
        let other = db::create_custom_list(&conn, "Work's list", "💼").unwrap();
        db::add_entry(&conn, other.id, Some("отчёт"), None, 2).unwrap();
        (conn, list.id)
    }

    /// Export → parse → import into an empty DB reproduces the same lists.
    fn round_trip(format: FileFormat) {
        let (conn, _) = sample_db();
        let lists = collect(&conn, None).unwrap();
        assert_eq!(lists.len(), 2);
        let bytes = export(&lists, format, "ru").unwrap();

        let fresh = db::open_in_memory_for_tests();
        let parsed = parse(&bytes, "Импорт").unwrap();
        let report = import(&fresh, parsed, None).unwrap();
        assert_eq!((report.lists_created, report.added, report.invalid, report.duplicates), (2, 4, 0, 0), "{format:?}");
        assert_eq!(collect(&fresh, None).unwrap(), lists, "{format:?}");

        // Importing the same file again only finds duplicates.
        let again = import(&fresh, parse(&bytes, "Импорт").unwrap(), None).unwrap();
        assert_eq!((again.lists_created, again.lists_updated, again.added, again.duplicates), (0, 0, 0, 4));
    }

    #[test]
    fn round_trip_json() {
        round_trip(FileFormat::Json);
    }

    #[test]
    fn round_trip_sql() {
        round_trip(FileFormat::Sql);
    }

    #[test]
    fn round_trip_xlsx() {
        round_trip(FileFormat::Xlsx);
    }

    #[test]
    fn import_into_specific_list_and_validation() {
        let (conn, list_id) = sample_db();
        let json = r#"[{"name": "Whatever", "words": [
            {"ru": "Кот", "en": "kitten", "difficulty": 1},
            {"ru": "собака", "en": "dog"},
            {"ru": "дача", "difficulty": "Сложный"},
            {"ru": "house", "en": "дом"},
            {"en": "tree", "difficulty": 7},
            {"ru": "", "en": "  "}
        ]}]"#;
        let report = import(&conn, parse(json.as_bytes(), "x").unwrap(), Some(list_id)).unwrap();
        assert_eq!(report.lists_created, 0);
        assert_eq!(report.added, 1, "{report:?}"); // дача
        assert_eq!(report.duplicates, 2); // кот (ru), dog (en)
        assert_eq!(report.invalid, 2); // wrong alphabets, bad difficulty
        assert_eq!(report.invalid_samples, vec!["house".to_string(), "tree".to_string()]);
        let entries = db::list_entries(&conn, list_id).unwrap();
        assert!(entries.iter().any(|e| e.ru.as_deref() == Some("дача") && e.difficulty == 3));
    }

    #[test]
    fn merges_by_name_and_skips_empty_lists() {
        let (conn, _) = sample_db();
        let json = r#"{"lists": [
            {"name": "друзья", "words": [{"ru": "баня"}]},
            {"name": "Junk", "words": [{"ru": "bad"}]}
        ]}"#;
        let report = import(&conn, parse(json.as_bytes(), "x").unwrap(), None).unwrap();
        assert_eq!((report.lists_created, report.lists_updated, report.added, report.invalid), (0, 1, 1, 1));
        assert!(!db::list_custom_lists(&conn).unwrap().iter().any(|l| l.name == "Junk"));
    }

    #[test]
    fn sql_sandbox_blocks_dangerous_statements() {
        for script in [
            "ATTACH DATABASE '/tmp/x.db' AS x;",
            "PRAGMA writable_schema = 1;",
            "VACUUM INTO '/tmp/x.db';",
            "DROP TABLE lists;",
            "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT count(*) FROM r;",
        ] {
            let res = parse_sql(script, "x");
            assert!(res.as_ref().is_err_and(|e| e.starts_with("err.import_sql")), "{script}: {res:?}");
        }
        // Hand-written SQL without an explicit lists row still works.
        let lists = parse_sql("INSERT INTO words (ru, en) VALUES ('кот', 'cat');", "Импорт").unwrap();
        assert_eq!(lists[0].name, "Импорт");
        assert_eq!(lists[0].words.len(), 1);
    }

    #[test]
    fn xlsx_by_hand_without_header() {
        use rust_xlsxwriter::Workbook;
        let mut wb = Workbook::new();
        let ws = wb.add_worksheet();
        ws.write_string(0, 0, "Школа").unwrap();
        ws.write_string(0, 2, "парта").unwrap();
        ws.write_number(0, 4, 1.0).unwrap();
        ws.write_string(1, 3, "chalk").unwrap();
        let bytes = wb.save_to_buffer().unwrap();
        let lists = parse(&bytes, "Импорт").unwrap();
        assert_eq!(lists.len(), 2);
        assert_eq!(lists[0].words[0], RawWord { ru: Some("парта".into()), en: None, difficulty: Some(1) });
        assert_eq!(lists[1].name, "Импорт");
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse(b"", "x"), Err("err.import_empty".into()));
        assert!(parse(b"PK\x03\x04garbage", "x").unwrap_err().starts_with("err.import_format"));
        assert!(parse(b"{not json", "x").unwrap_err().starts_with("err.import_format"));
        assert_eq!(parse(&[0xff, 0xfe, 0x00], "x"), Err("err.import_format".into()));
    }
}
