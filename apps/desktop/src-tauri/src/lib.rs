use tauri::Manager;

#[tauri::command]
fn model_cache_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("models");

    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![model_cache_dir])
        .run(tauri::generate_context!())
        .expect("error while running Mini Hub desktop app");
}

