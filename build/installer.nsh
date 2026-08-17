!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "WordFunc.nsh"

!macro customInstall
  CreateDirectory "$PROFILE\.musefold\bin"
  FileOpen $0 "$PROFILE\.musefold\bin\musefold.cmd" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'set ELECTRON_RUN_AS_NODE=1$\r$\n'
  FileWrite $0 'set MUSEFOLD_AUTOSTART=1$\r$\n'
  FileWrite $0 'set "MUSEFOLD_APP_EXECUTABLE=$INSTDIR\${APP_EXECUTABLE_FILENAME}"$\r$\n'
  FileWrite $0 'set "NODE_PATH=$INSTDIR\resources\integration\node_modules"$\r$\n'
  FileWrite $0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "$INSTDIR\resources\integration\musefold-cli.mjs" %*$\r$\n'
  FileClose $0

  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 ";$0;"
  ${WordReplace} "$1" ";$PROFILE\.musefold\bin;" "" "+" $2
  ${If} $1 == $2
    ${If} $0 == ""
      StrCpy $0 "$PROFILE\.musefold\bin"
    ${Else}
      StrCpy $0 "$0;$PROFILE\.musefold\bin"
    ${EndIf}
    WriteRegExpandStr HKCU "Environment" "Path" "$0"
  ${EndIf}
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro customUnInstall
  Delete "$PROFILE\.musefold\bin\musefold.cmd"
  RMDir "$PROFILE\.musefold\bin"

  ReadRegStr $0 HKCU "Environment" "Path"
  StrCpy $1 ";$0;"
  ${un.WordReplace} "$1" ";$PROFILE\.musefold\bin;" ";" "+" $2
  StrLen $3 $2
  ${If} $3 >= 2
    IntOp $3 $3 - 2
    StrCpy $2 $2 $3 1
  ${Else}
    StrCpy $2 ""
  ${EndIf}
  ${If} $2 != $0
    WriteRegExpandStr HKCU "Environment" "Path" "$2"
  ${EndIf}
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend
