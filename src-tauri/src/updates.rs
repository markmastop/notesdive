use serde::Deserialize;

#[derive(Deserialize)]
struct ReleaseConfig { repository: String, asset: String }
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReleasePage { Download, Notes }

fn release_url(page: ReleasePage, version: &str) -> Result<String, String> {
    // Construct destinations locally; documents and API responses cannot supply arbitrary URLs.
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|part|
        part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()) ||
        (part.len() > 1 && part.starts_with('0')) || part.parse::<u32>().is_err()
    ) {
        return Err("Invalid release version".into());
    }
    let config: ReleaseConfig = serde_json::from_str(include_str!("../../release-config.json")).map_err(|e| e.to_string())?;
    let base = format!("https://github.com/{}/releases", config.repository);
    Ok(match page {
        ReleasePage::Download => format!("{base}/download/v{version}/{}", config.asset),
        ReleasePage::Notes => format!("{base}/tag/v{version}"),
    })
}

#[tauri::command]
pub fn update_platform() -> String {
    let os = match std::env::consts::OS { "macos" => "darwin", value => value };
    format!("{}-{}", os, std::env::consts::ARCH)
}

#[tauri::command]
pub async fn open_release_page(page: ReleasePage, version: String) -> Result<(), String> {
    crate::browser::open_url(release_url(page, &version)?).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_versioned_github_release_pages_can_be_opened() {
        assert_eq!(release_url(ReleasePage::Download, "0.19.0").unwrap(), "https://github.com/markmastop/notesdive/releases/download/v0.19.0/NotesDive-macOS-Apple-Silicon.dmg");
        assert_eq!(release_url(ReleasePage::Notes, "0.19.0").unwrap(), "https://github.com/markmastop/notesdive/releases/tag/v0.19.0");
        assert!(serde_json::from_str::<ReleasePage>("\"https://other.example\"").is_err());
        for version in ["", "v0.19.0", "01.0.0", "0.19.0-beta.1", "0.19.0/../other", "1.0", "1.0.0?x=1", "1.0.0\n", "999999999999.0.0"] {
            assert!(release_url(ReleasePage::Download, version).is_err(), "{version}");
        }
    }
}
