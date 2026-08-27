Unicode true

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef DRUSE_VERSION
  !error "Falta DRUSE_VERSION"
!endif
!ifndef COMPLETE_URL
  !error "Falta COMPLETE_URL"
!endif
!ifndef LITE_URL
  !error "Falta LITE_URL"
!endif
!ifndef COMPLETE_SHA256
  !error "Falta COMPLETE_SHA256"
!endif
!ifndef LITE_SHA256
  !error "Falta LITE_SHA256"
!endif
!ifndef OUTPUT_FILE
  !error "Falta OUTPUT_FILE"
!endif

Name "Druse ${DRUSE_VERSION}"
OutFile "${OUTPUT_FILE}"
RequestExecutionLevel user
ShowInstDetails show
BrandingText "Druse"
Icon "..\..\shells\desktop-tauri\icons\icon.ico"

Var Variant
Var CompleteRadio
Var LiteRadio
Var DownloadUrl
Var ExpectedHash
Var DownloadPath

!define MUI_ABORTWARNING
!define MUI_ICON "..\..\shells\desktop-tauri\icons\icon.ico"
!define MUI_PAGE_HEADER_TEXT "Elige la edición de Druse"
!define MUI_PAGE_HEADER_SUBTEXT "Podrás cambiarla ejecutando de nuevo este instalador."

Page custom VariantPageCreate VariantPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

Function VariantPageCreate
  !insertmacro MUI_HEADER_TEXT "Edición de Druse" "Elige los motores que necesitas."
  nsDialogs::Create 1018
  Pop $0

  ${NSD_CreateLabel} 0 0 100% 24u "Las dos ediciones incluyen PostgreSQL, SQL Server, MySQL y MariaDB."
  Pop $0

  ${NSD_CreateRadioButton} 8u 38u 100% 14u "Completa"
  Pop $CompleteRadio
  ${NSD_Check} $CompleteRadio

  ${NSD_CreateLabel} 26u 55u 92% 25u "Añade Informix y su controlador IBM. Ocupa más espacio."
  Pop $0

  ${NSD_CreateRadioButton} 8u 92u 100% 14u "Sin Informix"
  Pop $LiteRadio

  ${NSD_CreateLabel} 26u 109u 92% 25u "Más pequeña. Recomendada si no te conectas a servidores Informix."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function VariantPageLeave
  ${NSD_GetState} $LiteRadio $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Variant "sin-informix"
    StrCpy $DownloadUrl "${LITE_URL}"
    StrCpy $ExpectedHash "${LITE_SHA256}"
  ${Else}
    StrCpy $Variant "completo"
    StrCpy $DownloadUrl "${COMPLETE_URL}"
    StrCpy $ExpectedHash "${COMPLETE_SHA256}"
  ${EndIf}
FunctionEnd

Section "Instalar"
  GetTempFileName $0
  Delete $0
  StrCpy $DownloadPath "$0.exe"

  System::Call 'Kernel32::SetEnvironmentVariable(t "DRUSE_DOWNLOAD_URL", t "$DownloadUrl")'
  System::Call 'Kernel32::SetEnvironmentVariable(t "DRUSE_DOWNLOAD_PATH", t "$DownloadPath")'
  System::Call 'Kernel32::SetEnvironmentVariable(t "DRUSE_DOWNLOAD_SHA256", t "$ExpectedHash")'

  DetailPrint "Descargando Druse $Variant..."
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$ProgressPreference = $\'SilentlyContinue$\'; Invoke-WebRequest -UseBasicParsing -Uri $$env:DRUSE_DOWNLOAD_URL -OutFile $$env:DRUSE_DOWNLOAD_PATH"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "No se pudo descargar el instalador.$\r$\n$\r$\n$1"
    Abort
  ${EndIf}

  DetailPrint "Verificando la descarga..."
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "if ((Get-FileHash -LiteralPath $$env:DRUSE_DOWNLOAD_PATH -Algorithm SHA256).Hash -ne $$env:DRUSE_DOWNLOAD_SHA256) { exit 2 }"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    Delete $DownloadPath
    MessageBox MB_OK|MB_ICONSTOP "La descarga no coincide con la publicación oficial y no se ejecutará."
    Abort
  ${EndIf}

  DetailPrint "Abriendo el instalador de Druse..."
  ExecWait '"$DownloadPath"' $0
  Delete $DownloadPath
  System::Call 'Kernel32::SetEnvironmentVariable(t "DRUSE_DOWNLOAD_URL", p 0)'
  System::Call 'Kernel32::SetEnvironmentVariable(t "DRUSE_DOWNLOAD_PATH", p 0)'
  System::Call 'Kernel32::SetEnvironmentVariable(t "DRUSE_DOWNLOAD_SHA256", p 0)'
  SetErrorLevel $0
SectionEnd
