# One-shot: replace dark-theme hex colors with CSS variables inside <style> blocks.
$map = @{
  '#2b2b2b' = 'var(--bg-dark)'
  '#2d2d30' = 'var(--bg-dark)'
  '#252526' = 'var(--bg-panel)'
  '#333337' = 'var(--bg-header)'
  '#333333' = 'var(--bg-header)'
  '#333'    = 'var(--bg-header)'
  '#222222' = 'var(--bg-darker)'
  '#222'    = 'var(--bg-darker)'
  '#1e1e1e' = 'var(--bg-input)'
  '#3a3a3a' = 'var(--bg-header)'
  '#3f3f46' = 'var(--border-color)'
  '#3e3e42' = 'var(--slider-track)'
  '#111111' = 'var(--border-strong)'
  '#111'    = 'var(--border-strong)'
  '#d4d4d4' = 'var(--text-main)'
  '#cccccc' = 'var(--text-main)'
  '#ccc'    = 'var(--text-main)'
  '#dddddd' = 'var(--text-main)'
  '#ddd'    = 'var(--text-main)'
  '#aaaaaa' = 'var(--text-muted)'
  '#aaa'    = 'var(--text-muted)'
  '#888888' = 'var(--text-muted)'
  '#888'    = 'var(--text-muted)'
  '#808080' = 'var(--text-muted)'
  '#007acc' = 'var(--accent-blue)'
  '#0088cc' = 'var(--accent-blue-bright)'
  '#087fc1' = 'var(--accent-blue-bright)'
  '#8cc63f' = 'var(--status-green)'
  '#424242' = 'var(--scrollbar-thumb)'
  '#4f4f4f' = 'var(--scrollbar-thumb-hover)'
  '#555555' = 'var(--toggle-bg)'
  '#555'    = 'var(--toggle-bg)'
}

$files = Get-ChildItem "C:\develop\DMT_AFVI_Color_Parameter_AutoParse\tauri-app\src\app\components\*.svelte"
$leftover = @{}
foreach ($f in $files) {
  $text = [System.IO.File]::ReadAllText($f.FullName)
  $new = [regex]::Replace($text, '(?s)<style>(.*?)</style>', {
    param($m)
    $s = $m.Groups[1].Value
    foreach ($k in $map.Keys) { $s = $s -replace [regex]::Escape($k), $map[$k] }
    '<style>' + $s + '</style>'
  })
  if ($new -ne $text) { [System.IO.File]::WriteAllText($f.FullName, $new) }
  # inventory what is left inside style blocks (may need manual mapping)
  [regex]::Matches($new, '(?s)<style>(.*?)</style>') | ForEach-Object {
    [regex]::Matches($_.Groups[1].Value, '#[0-9a-fA-F]{3,8}\b') | ForEach-Object {
      $key = $f.Name + ': ' + $_.Value.ToLower()
      $leftover[$key] = [int]$leftover[$key] + 1
    }
  }
}
$leftover.GetEnumerator() | Sort-Object Name | ForEach-Object { "{0} x{1}" -f $_.Name, $_.Value }
