$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
Start-Process 'C:\develop\DMT_AFVI_Color_Parameter_AutoParse\tauri-app\src-tauri\target\release\AFVI_Parse.exe'
Start-Sleep -Seconds 6
(Get-Process AFVI_Parse | Where-Object { $_.Path -like '*target\release*' } | Select-Object -ExpandProperty Id)
