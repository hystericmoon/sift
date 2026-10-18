mod detect;
mod session_store;
mod telegram;

use tauri::State;
use tauri::ipc::Channel;
use telegram::{LoginStep, ScanEvent, ScanResult, TelegramState, UiError};

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
    on_event: Channel<ScanEvent>,
) -> Result<ScanResult, UiError> {
    state.lock().await.scan(&on_event).await
}

#[tauri::command]
async fn log_out(state: State<'_, TelegramState>) -> Result<(), UiError> {
    state.lock().await.log_out().await
}

pub fn run() {
    tauri::Builder::default()
        .manage(TelegramState::default())
        .invoke_handler(tauri::generate_handler![
            restore_session,
            request_code,
            submit_code,
            submit_password,
            scan,
            log_out
        ])
        .run(tauri::generate_context!())
        .expect("error while running Sift");
}
