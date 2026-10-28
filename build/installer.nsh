; Twilight's installer, in Twilight's colours. electron-builder includes this file before the
; installer's pages are built, so the Modern UI settings below apply to every page.
;
; Colours: night 0B0D1C, surface 111430, ink ECEEFE, ink-muted A6ABD8, line-strong 6F77BD,
; iris 9497FF.

!define MUI_BGCOLOR "0B0D1C"
!define MUI_TEXTCOLOR "ECEEFE"

; The same script builds the uninstaller; installer-only parts stay out of it (NSIS treats an
; unused function as an error here).
!ifndef BUILD_UNINSTALLER

!define MUI_INSTFILESPAGE_COLORS "A6ABD8 111430"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"
!define MUI_CUSTOMFUNCTION_GUIINIT twilightGuiInit

!define MUI_WELCOMEPAGE_TITLE "Welcome to Twilight"
!define MUI_WELCOMEPAGE_TEXT "A quiet place to write with language models.$\r$\n$\r$\nThis installs Twilight ${VERSION}. Your chats, documents and settings stay on your computer; installing or updating never touches them.$\r$\n$\r$\nClick Next to begin."
!define MUI_FINISHPAGE_TITLE "Twilight is ready"
!define MUI_FINISHPAGE_TEXT "Everything is in place. Twilight opens with a short welcome that helps you connect a model and choose where your writing lives."

!define TWILIGHT_PBM_SETBARCOLOR 0x0409
!define TWILIGHT_PBM_SETBKCOLOR 0x2001

; The window around the pages: night behind everything.
Function twilightGuiInit
  SetCtlColors $HWNDPARENT "A6ABD8" "0B0D1C"
  ; The version label at the bottom left (Modern UI draws it twice, as 1028 and 1256).
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 /BRANDING "6F77BD" "0B0D1C"
  GetDlgItem $0 $HWNDPARENT 1256
  SetCtlColors $0 /BRANDING "6F77BD" "0B0D1C"
FunctionEnd

; Darkens an ordinary page: its background, labels, radio buttons and checkboxes (whose
; Windows styling is removed so the colours show), and the progress bar.
Function twilightDarkPage
  FindWindow $0 "#32770" "" $HWNDPARENT
  SetCtlColors $0 "ECEEFE" "111430"
  StrCpy $1 0
  twilightNext:
    FindWindow $1 "" "" $0 $1
    StrCmp $1 0 twilightDone
    System::Call 'user32::GetClassName(p r1, t .r2, i 64) i'
    StrCmp $2 "msctls_progress32" 0 twilightNotBar
      System::Call 'uxtheme::SetWindowTheme(p r1, w " ", w " ")'
      SendMessage $1 ${TWILIGHT_PBM_SETBARCOLOR} 0 0x00FF9794
      SendMessage $1 ${TWILIGHT_PBM_SETBKCOLOR} 0 0x00301411
      Goto twilightNext
    twilightNotBar:
    StrCmp $2 "Button" 0 twilightLabel
      System::Call 'user32::GetWindowLong(p r1, i -16) i .r3'
      IntOp $3 $3 & 0xF
      ; Only checkboxes (2, 3) and radio buttons (4, 9): push buttons keep the Windows look.
      IntCmp $3 2 twilightRestyle
      IntCmp $3 3 twilightRestyle
      IntCmp $3 4 twilightRestyle
      IntCmp $3 9 twilightRestyle
      Goto twilightNext
      twilightRestyle:
      System::Call 'uxtheme::SetWindowTheme(p r1, w " ", w " ")'
    twilightLabel:
    SetCtlColors $1 "ECEEFE" "111430"
    Goto twilightNext
  twilightDone:
FunctionEnd

!endif

; A welcome page first; the page after it (who to install for) gets the dark treatment.
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW twilightDarkPage
!macroend

; Just before the progress page: dark too.
!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW twilightDarkPage
!macroend

; The finish page, with Twilight's words, an "Open Twilight" box readable on the dark page, and
; the app opening afterwards.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_RUN_TEXT "Open Twilight"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW twilightFinishShow
  !insertmacro MUI_PAGE_FINISH
  Function twilightFinishShow
    StrCpy $0 $mui.FinishPage.Run
    System::Call 'uxtheme::SetWindowTheme(p r0, w " ", w " ")'
    SetCtlColors $0 "ECEEFE" "0B0D1C"
  FunctionEnd
!macroend
