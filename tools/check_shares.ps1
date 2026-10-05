$model = '\\192.168.1.61\pxrepository\25fbo015-15'
Write-Output "== version folders =="
Get-ChildItem -LiteralPath $model -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }

Write-Output "== Top\Layer =="
Get-ChildItem -LiteralPath "$model\2.0\Line\Top\Layer" -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }

foreach ($p in @("$model\2.0\Line\Top\Layer\L01\UNIT_0.tif", "$model\2.0\Line\Top\Layer\GB\Pattern.tif")) {
  $item = Get-Item -LiteralPath $p -ErrorAction SilentlyContinue
  Write-Output ("{0} -> exists={1} size={2}" -f $p, ($null -ne $item), $(if ($item) { $item.Length } else { '' }))
}
