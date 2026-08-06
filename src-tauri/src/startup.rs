use std::{
    io::{Error, ErrorKind},
    path::PathBuf,
};

pub fn set_startup_enabled(enabled: bool) -> std::io::Result<()> {
    let app_path = std::env::current_exe()?;
    let app_data = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| Error::new(ErrorKind::NotFound, "APPDATA is unavailable"))?;
    let startup_dir = app_data.join(r"Microsoft\Windows\Start Menu\Programs\Startup");
    let startup_path = startup_dir.join("theHUB.cmd");
    let legacy_startup_path = startup_dir.join("desktop-dashboard.cmd");

    let remove_if_present = |path: &std::path::Path| match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    };

    if enabled {
        remove_if_present(&legacy_startup_path)?;
        let target = app_path
            .to_str()
            .ok_or_else(|| Error::new(ErrorKind::InvalidData, "application path is not UTF-8"))?;
        let escaped_target = target.replace('%', "%%").replace('"', "\"\"");
        std::fs::write(
            startup_path,
            format!("@start \"\" \"{escaped_target}\"\r\n"),
        )
    } else {
        remove_if_present(&startup_path)?;
        remove_if_present(&legacy_startup_path)
    }
}
