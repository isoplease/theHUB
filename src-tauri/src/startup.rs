use std::{
    io::{Error, ErrorKind},
    path::PathBuf,
};

pub fn set_startup_enabled(enabled: bool) -> std::io::Result<()> {
    let app_path = std::env::current_exe()?;
    let app_data = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| Error::new(ErrorKind::NotFound, "APPDATA is unavailable"))?;
    let startup_path = app_data
        .join(r"Microsoft\Windows\Start Menu\Programs\Startup")
        .join("desktop-dashboard.cmd");

    if enabled {
        let target = app_path
            .to_str()
            .ok_or_else(|| Error::new(ErrorKind::InvalidData, "application path is not UTF-8"))?;
        let escaped_target = target.replace('%', "%%").replace('"', "\"\"");
        std::fs::write(
            startup_path,
            format!("@start \"\" \"{escaped_target}\" --autostart\r\n"),
        )
    } else {
        match std::fs::remove_file(startup_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}
