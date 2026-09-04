# theHUB 3.3.1 Windows Installer

`theHUB-Setup-3.3.1-x64.exe` is the NSIS installer for Windows 10/11 x64. It installs the application for the current Windows account.

## Installation

1. Copy the EXE file to the target computer.
2. Double-click the file and complete the installation steps.
3. If Microsoft Edge WebView2 is unavailable, the installer downloads and installs its bootstrapper silently.

The uninstaller cleans `theHUB.cmd` and the legacy `desktop-dashboard.cmd` from both per-user and common Windows Startup folders before and after removing the application. Files that are temporarily locked are scheduled for deletion after Windows restarts.

The publisher shown in Windows Apps & Features is `isoplease`.

The installer is not commercially code-signed, so Windows SmartScreen may display an unknown publisher warning on first launch.

## SHA-256

```text
1E5EFB041E7E30FC3FC655E8D1EC25F0490AEB90E3650D9D4110EF75881D3007
```
