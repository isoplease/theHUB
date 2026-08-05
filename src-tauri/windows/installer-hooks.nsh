!macro NSIS_HOOK_PREUNINSTALL
  ; The application creates this launcher at first run. The uninstaller does
  ; not execute the Rust startup cleanup path, so remove the launcher here.
  SetShellVarContext current
  Delete "$APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\desktop-dashboard.cmd"
!macroend
