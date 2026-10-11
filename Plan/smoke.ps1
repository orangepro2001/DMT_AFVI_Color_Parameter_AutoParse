# Smoke: launch the release app, count conhost spawns during the first 12 s
# (the median load window), then report visible windows + app state via CDP.
powershell -ExecutionPolicy Bypass -File "C:\develop\DMT_AFVI_Color_Parameter_AutoParse\plan\launchcdp.ps1"
$before = (Get-Process conhost -ErrorAction SilentlyContinue).Count
Start-Sleep -Seconds 12
$after = (Get-Process conhost -ErrorAction SilentlyContinue).Count
Write-Output "conhost before=$before after=$after"
$list = Invoke-RestMethod -Uri 'http://127.0.0.1:9223/json/list'
Write-Output ("cdp target: {0} {1}" -f $list[0].title, $list[0].url)
