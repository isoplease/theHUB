!macro DELETE_THEHUB_STARTUP_LAUNCHERS
  ; Resolve the Startup folder through NSIS instead of assuming APPDATA. Run
  ; for both shell contexts so upgrades from older installers are covered.
  SetShellVarContext current
  Delete /REBOOTOK "$SMSTARTUP\theHUB.cmd"
  Delete /REBOOTOK "$SMSTARTUP\desktop-dashboard.cmd"
  SetShellVarContext all
  Delete /REBOOTOK "$SMSTARTUP\theHUB.cmd"
  Delete /REBOOTOK "$SMSTARTUP\desktop-dashboard.cmd"
  SetShellVarContext current
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro DELETE_THEHUB_STARTUP_LAUNCHERS
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Repeat after installed files and shortcuts are removed in case the
  ; launcher was locked during the first cleanup attempt.
  !insertmacro DELETE_THEHUB_STARTUP_LAUNCHERS
!macroend
