# theHUB Windows installer

Installers are no longer committed to this repository. Download the latest
`theHUB-Setup-<version>-x64.exe` from the
[GitHub Releases](https://github.com/isoplease/theHUB/releases) page and compare
its SHA-256 hash with the value published in the release notes:

```powershell
Get-FileHash .\theHUB-Setup-<version>-x64.exe -Algorithm SHA256
```

To build one locally, run `.\scripts\windows.ps1 build`; the output is written to
`src-tauri/target/release/bundle/nsis/`.

## Installation

1. Double-click the EXE file and complete the installation steps.
2. If Microsoft Edge WebView2 is unavailable, the installer downloads and installs its bootstrapper silently.

The installer is for Windows 10/11 x64 and installs for the current Windows account.
The publisher shown in Windows Apps & Features is `isoplease`. The installer is not
commercially code-signed, so Windows SmartScreen may display an unknown publisher
warning on first launch.
