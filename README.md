# theHUB

theHUB is a native Windows desktop workspace built with Tauri, React, TypeScript, and Tailwind CSS.

## Features

- Tasks, task history, an integrated calendar, reminders, day notes, and visual recurring cycles
- Rich Quick Notes with highlighting, text colors, lists, line privacy controls, adjustable height, automatic saving, recovery backups, and TXT/PDF/HTML export
- Standard and scientific calculator modes with persistent calculation history
- Stopwatch and 24-hour timer in a shared card
- Drag-and-drop card ordering with a persistent single-column layout
- Turkish and English interface languages
- Dark and light themes, custom colors, background transparency, and an optional frameless window
- System Tray operation, remembered window position, and automatic launch with Windows
- Native Windows notifications for task reminders
- Local device storage based on IndexedDB

## Development

Node.js 20 or later and npm are required.

```bash
npm install
npm run dev
```

Create a production web build:

```bash
npm run build
```

Run the available checks:

```bash
npm audit
npm run lint
npm test
cargo audit --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --all-targets -- -D warnings
```

## Security and privacy

- The development server listens only on `127.0.0.1`.
- The Tauri Content Security Policy blocks unapproved external network connections.
- Tasks and notes are stored unencrypted in the device's WebView storage. Quick Note recovery backups are also plain text. Do not store passwords, API keys, or other secrets.
- Task titles are limited to 200 characters and Quick Notes to 10,000 visible characters.
- `package-lock.json` and `src-tauri/Cargo.lock` are committed to keep release dependencies reproducible.

## Windows installer

Build the NSIS `.exe` package with:

```bash
npm run tauri -- build --bundles nsis
```

The Windows 10/11 x64 installer is available at:

- `installer/theHUB-Setup-2.2.0-x64.exe`

The installer targets the current Windows account. Its uninstaller removes `theHUB.cmd` and the legacy `desktop-dashboard.cmd` from both per-user and common Startup folders before and after uninstalling. Locked launchers are scheduled for deletion after Windows restarts.

The installer is not commercially code-signed, so Windows SmartScreen may display an unknown publisher warning on first launch.

## Font license

The calculator and time tools use the DS-Digital font from the `fonts` directory. Review its shareware terms in [fonts/DIGITAL.TXT](fonts/DIGITAL.TXT) before choosing a distribution model.
