fn web_url(value: &str) -> Result<String, String> {
    if value.chars().any(char::is_control) {
        return Err("Invalid web address".into());
    }
    let url = tauri::Url::parse(value).map_err(|_| "Invalid web address")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Only HTTP and HTTPS links can be opened".into());
    }
    Ok(url.into())
}

// Pass a validated URL as one argument, never as a shell command.
pub async fn open_url(value: String) -> Result<(), String> {
    let url = web_url(&value)?;
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("/usr/bin/open");
        #[cfg(target_os = "windows")]
        let mut command = std::process::Command::new("explorer.exe");
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let mut command = std::process::Command::new("xdg-open");
        let status = command.arg(url).status().map_err(|e| e.to_string())?;
        if status.success() { Ok(()) } else { Err("Could not open the browser".into()) }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_web_link(url: String) -> Result<(), String> {
    open_url(url).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_links_keep_paths_queries_and_fragments() {
        assert_eq!(web_url("Https://example.com/projects?q=hello%20world#links").unwrap(), "https://example.com/projects?q=hello%20world#links");
        assert_eq!(web_url("http://localhost:8080/planning").unwrap(), "http://localhost:8080/planning");
    }

    #[test]
    fn local_files_commands_and_other_schemes_are_rejected() {
        for value in ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hello", "mailto:user@example.com", "notesdive://open", "--args", "/tmp/notes.md", "https://", "https://example.com\n--args"] {
            assert!(web_url(value).is_err(), "accepted {value}");
        }
    }
}
