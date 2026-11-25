mod db;
mod transfer;

use std::sync::Mutex;

use rusqlite::Connection;
use std::io::Write;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;

struct AppState {
    db: Mutex<Connection>,
}

type CmdResult<T> = Result<T, String>;

fn with_db<T>(state: &State<AppState>, f: impl FnOnce(&Connection) -> db::DbResult<T>) -> CmdResult<T> {
    let conn = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
    f(&conn)
}

#[tauri::command]
fn list_categories(state: State<AppState>, lang: String) -> CmdResult<Vec<db::Category>> {
    with_db(&state, |c| db::list_categories(c, &lang))
}

#[tauri::command]
fn draw_words(
    state: State<AppState>,
    lang: String,
    category_ids: Vec<i64>,
    difficulties: Vec<u8>,
    exclude: Vec<i64>,
    limit: u32,
) -> CmdResult<Vec<db::Word>> {
    with_db(&state, |c| db::draw_words(c, &lang, &category_ids, &difficulties, &exclude, limit))
}

#[tauri::command]
fn list_custom_lists(state: State<AppState>) -> CmdResult<Vec<db::CustomList>> {
    with_db(&state, db::list_custom_lists)
}

#[tauri::command]
fn get_custom_list(state: State<AppState>, id: i64) -> CmdResult<db::CustomList> {
    with_db(&state, |c| db::get_custom_list(c, id))
}

#[tauri::command]
fn create_custom_list(state: State<AppState>, name: String, icon: String) -> CmdResult<db::CustomList> {
    with_db(&state, |c| db::create_custom_list(c, &name, &icon))
}

#[tauri::command]
fn update_custom_list(state: State<AppState>, id: i64, name: String, icon: String) -> CmdResult<db::CustomList> {
    with_db(&state, |c| db::update_custom_list(c, id, &name, &icon))
}

#[tauri::command]
fn delete_custom_list(state: State<AppState>, id: i64) -> CmdResult<()> {
    with_db(&state, |c| db::delete_custom_list(c, id))
}

#[tauri::command]
fn list_entries(state: State<AppState>, list_id: i64) -> CmdResult<Vec<db::Entry>> {
    with_db(&state, |c| db::list_entries(c, list_id))
}

#[tauri::command]
fn add_entry(
    state: State<AppState>,
    list_id: i64,
    ru: Option<String>,
    en: Option<String>,
    difficulty: u8,
) -> CmdResult<db::Entry> {
    with_db(&state, |c| db::add_entry(c, list_id, ru.as_deref(), en.as_deref(), difficulty))
}

#[tauri::command]
fn update_entry(
    state: State<AppState>,
    list_id: i64,
    id: i64,
    ru: Option<String>,
    en: Option<String>,
    difficulty: u8,
) -> CmdResult<db::Entry> {
    with_db(&state, |c| db::update_entry(c, list_id, id, ru.as_deref(), en.as_deref(), difficulty))
}

#[tauri::command]
fn delete_entry(state: State<AppState>, list_id: i64, id: i64) -> CmdResult<()> {
    with_db(&state, |c| db::delete_entry(c, list_id, id))
}

// ---------------------------------------------------------------------------
// Import / export. Dialogs block, so these run on a blocking thread. File access goes
// through the fs plugin, which also handles Android content:// URIs from the pickers.
// ---------------------------------------------------------------------------

/// Returns the suggested file name, or `None` if the user cancelled the save dialog.
#[tauri::command]
async fn export_lists(
    app: AppHandle,
    list_id: Option<i64>,
    format: String,
    ui_lang: String,
) -> CmdResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || export_blocking(&app, list_id, &format, &ui_lang))
        .await
        .map_err(|e| e.to_string())?
}

fn export_blocking(app: &AppHandle, list_id: Option<i64>, format: &str, ui_lang: &str) -> CmdResult<Option<String>> {
    let format = transfer::FileFormat::parse(format)?;
    let (bytes, name) = {
        let state = app.state::<AppState>();
        let conn = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
        let lists = transfer::collect(&conn, list_id)?;
        if lists.is_empty() {
            return Err("err.export_empty".into());
        }
        (transfer::export(&lists, format, ui_lang)?, transfer::file_name(&lists, list_id.is_some(), format))
    };

    let dialog = app.dialog().file().set_file_name(&name);
    // Android's picker takes MIME types; desktop dialogs take extensions.
    #[cfg(target_os = "android")]
    let dialog = dialog.add_filter(format.extension(), &[format.mime()]);
    #[cfg(not(target_os = "android"))]
    let dialog = dialog.add_filter(format.extension().to_uppercase(), &[format.extension()]);
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(None);
    };

    let mut opts = tauri_plugin_fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    let mut file = app.fs().open(path, opts).map_err(|e| format!("err.write_failed|{e}"))?;
    file.write_all(&bytes).and_then(|_| file.flush()).map_err(|e| format!("err.write_failed|{e}"))?;
    Ok(Some(name))
}

/// Imports a picked file into `list_id`, or merges/creates lists by name when `None`.
/// Returns `None` if the user cancelled the file picker.
#[tauri::command]
async fn import_lists(
    app: AppHandle,
    list_id: Option<i64>,
    ui_lang: String,
) -> CmdResult<Option<transfer::ImportReport>> {
    tauri::async_runtime::spawn_blocking(move || import_blocking(&app, list_id, &ui_lang))
        .await
        .map_err(|e| e.to_string())?
}

fn import_blocking(app: &AppHandle, list_id: Option<i64>, ui_lang: &str) -> CmdResult<Option<transfer::ImportReport>> {
    let Some(path) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let bytes = app.fs().read(path).map_err(|e| format!("err.read_failed|{e}"))?;
    let default_name = if ui_lang == "en" { "Imported" } else { "Импорт" };
    let lists = transfer::parse(&bytes, default_name)?;
    let state = app.state::<AppState>();
    let conn = state.db.lock().map_err(|_| "database lock poisoned".to_string())?;
    transfer::import(&conn, lists, list_id).map(Some)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = db::open(&dir.join("words.db"))?;
            app.manage(AppState { db: Mutex::new(conn) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_categories,
            draw_words,
            list_custom_lists,
            get_custom_list,
            create_custom_list,
            update_custom_list,
            delete_custom_list,
            list_entries,
            add_entry,
            update_entry,
            delete_entry,
            export_lists,
            import_lists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
