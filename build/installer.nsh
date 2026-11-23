!macro customInstall
  WriteRegStr SHCTX "Software\Classes\Ymd.Markdown" "" "Markdown Document"
  WriteRegStr SHCTX "Software\Classes\Ymd.Markdown\DefaultIcon" "" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0"
  WriteRegStr SHCTX "Software\Classes\Ymd.Markdown\shell\open\command" "" "$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "Ymd.Markdown" ""
  WriteRegStr SHCTX "Software\Ymd\Capabilities" "ApplicationName" "Ymd"
  WriteRegStr SHCTX "Software\Ymd\Capabilities" "ApplicationDescription" "Markdown editor"
  WriteRegStr SHCTX "Software\Ymd\Capabilities\FileAssociations" ".md" "Ymd.Markdown"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Ymd" "Software\Ymd\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Ymd"
  DeleteRegKey SHCTX "Software\Ymd\Capabilities"
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "Ymd.Markdown"
  DeleteRegKey SHCTX "Software\Classes\Ymd.Markdown"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
