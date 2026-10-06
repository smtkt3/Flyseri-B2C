param(
  [Parameter(Mandatory)][string]$BroadJson,
  [Parameter(Mandatory)][string]$BroadImages,
  [Parameter(Mandatory)][string]$CuratedJson,
  [Parameter(Mandatory)][string]$CuratedAssets,
  [string]$H1Logo,
  [string]$ODLogo
)

$ErrorActionPreference = 'Stop'
$web = Join-Path $PSScriptRoot '..\apps\customer-web'
$assets = Join-Path $web 'public\airlines'
$output = Join-Path $web 'src\flight\data\airlines.json'
New-Item -ItemType Directory -Path $assets -Force | Out-Null

$catalog = [ordered]@{}
$broad = (Get-Content -LiteralPath $BroadJson -Raw | ConvertFrom-Json).data
$unique = $broad | Where-Object { $_.iata_code -cmatch '^[A-Z0-9]{2}$' } | Group-Object iata_code | Where-Object Count -eq 1
foreach ($group in $unique) {
  $airline = $group.Group[0]
  $code = $airline.iata_code
  if (-not $airline.name) { continue }
  $record = [ordered]@{ name = $airline.name }
  $logoFile = [regex]::Match($airline.logo, '^\./images/([A-Z0-9]{3})\.png$')
  if ($logoFile.Success) {
    $file = Join-Path $BroadImages "$($logoFile.Groups[1].Value).png"
    if (Test-Path -LiteralPath $file) {
      Copy-Item -LiteralPath $file -Destination (Join-Path $assets "$code.png") -Force
      $record['logo'] = "/airlines/$code.png"
    }
  }
  $catalog[$code] = $record
}

$curated = Get-Content -LiteralPath $CuratedJson -Raw | ConvertFrom-Json
foreach ($airline in $curated) {
  if ($airline.iata -cnotmatch '^[A-Z0-9]{2}$' -or -not $airline.name -or $airline.slug -notmatch '^[a-z0-9-]+$') { continue }
  $code = $airline.iata
  $icon = Join-Path $CuratedAssets "$($airline.slug)\icon.svg"
  if (-not (Test-Path -LiteralPath $icon)) { $icon = Join-Path $CuratedAssets "$($airline.slug)\logo.svg" }
  if (-not (Test-Path -LiteralPath $icon)) { continue }
  $svg = Get-Content -LiteralPath $icon -Raw
  if ($svg -match '<script|foreignObject|<image|xlink:href=|https?://(?!www\.w3\.org/(2000/svg|1999/xlink))') { continue }
  Copy-Item -LiteralPath $icon -Destination (Join-Path $assets "$code.svg") -Force
  $catalog[$code] = [ordered]@{ name = $airline.name; logo = "/airlines/$code.svg" }
}

if ($H1Logo) {
  Copy-Item -LiteralPath $H1Logo -Destination (Join-Path $assets 'H1.gif') -Force
  $catalog['H1'] = [ordered]@{ name = 'Hahnair Systems'; logo = '/airlines/H1.gif' }
}
if ($ODLogo) {
  $svg = Get-Content -LiteralPath $ODLogo -Raw
  if ($svg -match '<script|foreignObject|<image|xlink:href=|https?://(?!www\.w3\.org/(2000/svg|1999/xlink))') { throw 'Unsafe OD logo SVG' }
  Copy-Item -LiteralPath $ODLogo -Destination (Join-Path $assets 'OD.svg') -Force
  $catalog['OD'] = [ordered]@{ name = 'Batik Air Malaysia'; logo = '/airlines/OD.svg' }
}

$json = ConvertTo-Json -InputObject $catalog -Depth 3 -Compress
[System.IO.File]::WriteAllText($output, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $($catalog.Count) airline names and local logos to $output"
