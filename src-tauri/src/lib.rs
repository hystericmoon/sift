mod detect;
mod session_store;
mod telegram;

use tauri::State;
use tauri::ipc::Channel;
use telegram::{
    AppInfo, AvatarEvent, Controls, DeleteEvent, DeleteReport, LoginStep, ScanEvent, ScanResult, TelegramState,
    UiError,
};

#[tauri::command]
fn app_info() -> AppInfo {
    telegram::app_info()
}

#[tauri::command]
async fn restore_session(state: State<'_, TelegramState>) -> Result<bool, UiError> {
    state.lock().await.restore().await
}

#[tauri::command]
async fn request_code(state: State<'_, TelegramState>, phone: String) -> Result<(), UiError> {
    state.lock().await.request_code(&phone).await
}

#[tauri::command]
async fn submit_code(state: State<'_, TelegramState>, code: String) -> Result<LoginStep, UiError> {
    state.lock().await.submit_code(&code).await
}

#[tauri::command]
async fn submit_password(state: State<'_, TelegramState>, password: String) -> Result<(), UiError> {
    state.lock().await.submit_password(&password).await
}

#[tauri::command]
async fn scan(
    state: State<'_, TelegramState>,
    controls: State<'_, Controls>,
    on_event: Channel<ScanEvent>,
) -> Result<ScanResult, UiError> {
    telegram::scan(&state, &controls, &on_event).await
}

#[tauri::command]
async fn load_avatars(
    state: State<'_, TelegramState>,
    controls: State<'_, Controls>,
    on_event: Channel<AvatarEvent>,
) -> Result<(), UiError> {
    telegram::load_avatars(&state, &controls, &on_event).await
}

#[tauri::command]
async fn delete_chats(
    state: State<'_, TelegramState>,
    controls: State<'_, Controls>,
    ids: Vec<String>,
    on_event: Channel<DeleteEvent>,
) -> Result<DeleteReport, UiError> {
    telegram::delete_chats(&state, &controls, ids, &on_event).await
}

#[tauri::command]
fn stop_deleting(controls: State<'_, Controls>) {
    controls.request_stop();
}

#[tauri::command]
async fn log_out(state: State<'_, TelegramState>) -> Result<(), UiError> {
    state.lock().await.log_out().await
}

pub fn run() {
    tauri::Builder::default()
        .manage(TelegramState::default())
        .manage(Controls::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            restore_session,
            request_code,
            submit_code,
            submit_password,
            scan,
            load_avatars,
            delete_chats,
            stop_deleting,
            log_out
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sift");
}
