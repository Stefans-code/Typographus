; Typographus — Windows installer (NSIS)
; (c) 2026 Nexflamma S.r.l.
; Wraps the PyInstaller onedir build (build_out\Typographus\) produced by
; build_windows.bat into a normal double-click Windows installer.

!include "MUI2.nsh"

Name "Typographus"
OutFile "build_out\TypographusSetup.exe"
InstallDir "$PROGRAMFILES64\Typographus"
InstallDirRegKey HKCU "Software\Typographus" "InstallDir"
RequestExecutionLevel admin
Unicode true

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Italian"
!insertmacro MUI_LANGUAGE "English"

Section "Typographus" SEC01
  SetOutPath "$INSTDIR"
  File /r "build_out\Typographus\*.*"

  WriteRegStr HKCU "Software\Typographus" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Typographus"
  CreateShortcut "$SMPROGRAMS\Typographus\Typographus.lnk" "$INSTDIR\Typographus.exe"
  CreateShortcut "$SMPROGRAMS\Typographus\Disinstalla Typographus.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Typographus.lnk" "$INSTDIR\Typographus.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Typographus" \
    "DisplayName" "Typographus"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Typographus" \
    "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Typographus" \
    "Publisher" "Nexflamma S.r.l."
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Typographus" \
    "DisplayIcon" "$INSTDIR\Typographus.exe"
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\Typographus\Typographus.lnk"
  Delete "$SMPROGRAMS\Typographus\Disinstalla Typographus.lnk"
  RMDir "$SMPROGRAMS\Typographus"
  Delete "$DESKTOP\Typographus.lnk"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Typographus"
  DeleteRegKey HKCU "Software\Typographus"
SectionEnd
