# theHUB

theHUB is a native Windows desktop workspace built with Tauri, React, TypeScript, and Tailwind CSS.

## Features

- Tasks, task history, an integrated calendar, reminders, day notes, and visual recurring cycles
- Rich Quick Notes with highlighting, text colors, lists, line privacy controls, adjustable height, automatic saving, recovery backups, and TXT/PDF/HTML export
- Standard and scientific calculator modes with persistent calculation history
- Stopwatch and 24-hour timer in a shared card
- Ten persistent file, folder, and website URL shortcuts with native Windows icons
- Contacts card with structured exports, a date tracker, and a screenshot tool
- Media session controls, multi-monitor taskbar strips, a floating panel, and a joystick menu for file conversion (Word/PDF)
- Ctrl+Alt+X screen text capture with Windows OCR, and Ctrl+F12 to show or hide theHUB
- Drag-and-drop card ordering with a persistent single-column layout
- Turkish and English interface languages
- Dark and light themes, custom colors, background transparency, and an optional frameless window
- System Tray operation, remembered window position, and automatic launch with Windows
- Native Windows notifications for task reminders
- Local device storage based on IndexedDB

## Development

Node.js 24 LTS and npm are recommended (the locked Vite version requires Node.js 20.19+ or 22.12+).

```bash
npm install
npm run dev
```

### Windows desktop development

Install Microsoft C++ Build Tools with the **Desktop development with C++**
workload and Windows SDK, Rust's stable `x86_64-pc-windows-msvc` toolchain,
and Microsoft Edge WebView2. See the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

From the project directory in PowerShell:

```powershell
# Run the native desktop application in development mode
.\scripts\windows.ps1 dev

# Run only the browser frontend
.\scripts\windows.ps1 web

# Build the frontend, lint, and run tests
.\scripts\windows.ps1 check

# Build the Windows installer
.\scripts\windows.ps1 build
```

The script refreshes PATH from the installed user and system settings. Installer
output is written to `src-tauri/target/release/bundle/nsis/`.

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
- Tasks and Quick Note workspaces I–IV are stored unencrypted in the device's WebView storage. Their recovery backups are also plain text. Do not store passwords, API keys, or other secrets there.
- Quick Note workspace V is optional and requires Google sign-in only when opened. It is synced through Firestore, held in memory while the app is running, and is not written to local note storage or recovery backups. It is not end-to-end encrypted.
- Task titles are limited to 200 characters and Quick Notes to 10,000 visible characters.
- `package-lock.json` and `src-tauri/Cargo.lock` are committed to keep release dependencies reproducible.

## Shared Quick Note V setup

The rest of theHUB works without a Google account. To enable the shared V workspace:

1. Create a Firebase Web App and a Google OAuth client with application type **Desktop app** in the same Google Cloud project.
2. Enable Google as a Firebase Authentication provider, add `tauri.localhost` and `localhost` to Authentication's authorized domains, and create a Cloud Firestore database.
3. Copy `.env.example` to `.env.local` and fill in the Firebase Web App values, the desktop OAuth client ID, and the desktop OAuth client secret. `.env.local` is ignored by Git; never commit it.
4. Allow each Google account that may use V: sign in once in theHUB, copy the account's **User UID** from Firebase console → Authentication → Users, and create an empty document `allowedUsers/<UID>` in Firestore (console only; clients cannot read or write this collection).
5. Deploy the included Firestore rules with `firebase deploy --only firestore:rules`.

Google sign-in opens the system browser and uses OAuth authorization code with PKCE and a temporary loopback callback. Firebase Auth uses durable WebView storage, so the Google session remains signed in across app restarts unless the user signs out, the stored data is cleared, or Firebase revokes the session. V does not keep a local offline copy or recovery backup. If edits arrive from another PC while this PC has unsaved edits, the app asks which version to keep.

### What is public in a release build

The Firebase Web API key, the OAuth client ID, and the Desktop OAuth client secret are compiled into every build and can be extracted from the installer. Google treats Desktop OAuth clients as public clients, so these values are not account passwords; protection comes from the server side:

- Firestore rules allow only `allowedUsers` accounts, only their own `users/<uid>/quickNotes/sharedV` document, and nothing else.
- In Google Cloud console → APIs & Services → Credentials, restrict the Firebase API key to the APIs theHUB uses (Identity Toolkit API, Token Service API, Cloud Firestore API, Firebase Installations API).
- Set a budget alert on the Google Cloud project.
- Never put a service account key or Admin SDK credentials in this app.

## Windows installer

Build the NSIS `.exe` package with:

```powershell
.\scripts\windows.ps1 build
```

The installer is written to `src-tauri/target/release/bundle/nsis/`. Publish it as an asset on a
[GitHub Release](https://github.com/isoplease/theHUB/releases) together with its SHA-256 hash
(`Get-FileHash <file> -Algorithm SHA256`). Installers and `dist/` are not committed to the repository.

The installer targets the current Windows account (Windows 10/11 x64). Its uninstaller removes `theHUB.cmd` and the legacy `desktop-dashboard.cmd` from both per-user and common Startup folders before and after uninstalling. Locked launchers are scheduled for deletion after Windows restarts.

The installer is not commercially code-signed, so Windows SmartScreen may display an unknown publisher warning on first launch.

## License

theHUB source code is available under the [MIT License](LICENSE). Third-party
components and bundled fonts remain subject to their respective terms; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Font license

The calculator and time tools use the DS-Digital font from the `fonts` directory. Review its shareware terms in [fonts/DIGITAL.TXT](fonts/DIGITAL.TXT) before choosing a distribution model.
