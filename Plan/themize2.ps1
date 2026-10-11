# Second pass: grey scale inside <style> blocks -> variables.
$map = @{
  '#131a20' = 'var(--border-color)'
  '#202020' = 'var(--bg-panel)'
  '#232323' = 'var(--bg-panel)'
  '#252525' = 'var(--bg-panel)'
  '#262626' = 'var(--bg-panel)'
  '#282828' = 'var(--bg-panel)'
  '#2d2d2d' = 'var(--bg-panel)'
  '#2e2e34' = 'var(--bg-panel)'
  '#303030' = 'var(--bg-panel)'
  '#3c3c3c' = 'var(--bg-elev)'
  '#414141' = 'var(--bg-elev)'
  '#444'    = 'var(--bg-elev)'
  '#484848' = 'var(--bg-elev)'
  '#4a4a4a' = 'var(--bg-elev)'
  '#4d4d4d' = 'var(--bg-elev)'
  '#505050' = 'var(--bg-elev)'
  '#5a5a5a' = 'var(--bg-elev)'
  '#606060' = 'var(--bg-elev)'
  '#666'    = 'var(--text-muted)'
  '#777'    = 'var(--text-muted)'
  '#7a7a7a' = 'var(--text-muted)'
  '#999'    = 'var(--text-muted)'
  '#9a9a9a' = 'var(--text-muted)'
  '#a0a0a0' = 'var(--text-muted)'
  '#a8a8a8' = 'var(--text-muted)'
  '#a9a9a9' = 'var(--text-muted)'
  '#bbb'    = 'var(--text-main)'
  '#bdbdbd' = 'var(--text-main)'
  '#c0c0c0' = 'var(--text-main)'
  '#cfcfcf' = 'var(--text-main)'
  '#e2e2e2' = 'var(--text-main)'
  '#eee'    = 'var(--text-main)'
  '#f1f1f1' = 'var(--text-main)'
  '#f2f2f2' = 'var(--text-main)'
}

$files = Get-ChildItem "C:\develop\DMT_AFVI_Color_Parameter_AutoParse\tauri-app\src\app\components\*.svelte"
foreach ($f in $files) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  $new = [regex]::Replace($text, '(?s)<style>(.*?)</style>', {
    param($m)
    $s = $m.Groups[1].Value
    foreach ($k in $map.Keys) { $s = $s -replace [regex]::Escape($k), $map[$k] }
    '<style>' + $s + '</style>'
  })
  if ($new -ne $text) { [System.IO.File]::WriteAllText($f.FullName, $new) }
}
Write-Output "done"
