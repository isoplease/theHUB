# theHUB 3.0.0 Windows Installer

`theHUB-Setup-3.0.0-x64.exe` is the NSIS installer for Windows 10/11 x64. It installs the application for the current Windows account.

## Installation

1. Copy the EXE file to the target computer.
2. Double-click the file and complete the installation steps.
3. If Microsoft Edge WebView2 is unavailable, the installer downloads and installs its bootstrapper silently.

The uninstaller cleans `theHUB.cmd` and the legacy `desktop-dashboard.cmd` from both per-user and common Windows Startup folders before and after removing the application. Files that are temporarily locked are scheduled for deletion after Windows restarts.

The publisher shown in Windows Apps & Features is `isoplease`.

The installer is not commercially code-signed, so Windows SmartScreen may display an unknown publisher warning on first launch.

## SHA-256

```text
C9AFADE6230E680C4F444C5B5EF05EC6F39E6847A3ED731E7615B23E21F67FF4
```
