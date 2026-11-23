use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("Cargo manifest directory is set"));
    let local_env = manifest_dir.join("..") .join(".env.local");
    println!("cargo:rerun-if-changed={}", local_env.display());

    if let Ok(contents) = fs::read_to_string(&local_env) {
        for line in contents.lines() {
            if let Some(value) = line.strip_prefix("THEHUB_GOOGLE_OAUTH_CLIENT_SECRET=") {
                let value = value.trim().trim_matches('"').trim_matches('\'');
                if !value.is_empty() && !value.contains(['\r', '\n']) {
                    // Desktop OAuth clients are public clients; Google does not treat this value as confidential.
                    println!("cargo:rustc-env=THEHUB_GOOGLE_OAUTH_CLIENT_SECRET={value}");
                }
                break;
            }
        }
    }

    tauri_build::build()
}
