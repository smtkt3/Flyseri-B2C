param(
  [string]$CsvPath,
  [string]$CitiesPath
)

$ErrorActionPreference = 'Stop'
$source = 'https://davidmegginson.github.io/ourairports-data/airports.csv'
$directory = Join-Path $PSScriptRoot '..\apps\customer-web\src\flight\data'
$output = Join-Path $directory 'airports.json'

if (-not $CsvPath) {
  $CsvPath = Join-Path $env:TEMP 'flyseri-airports.csv'
  Invoke-WebRequest -Uri $source -OutFile $CsvPath
}

if (-not $CitiesPath) {
  $citiesZip = Join-Path $env:TEMP 'flyseri-geonames-cities5000.zip'
  $citiesDir = Join-Path $env:TEMP 'flyseri-geonames-cities5000'
  Invoke-WebRequest -Uri 'https://download.geonames.org/export/dump/cities5000.zip' -OutFile $citiesZip
  Expand-Archive -LiteralPath $citiesZip -DestinationPath $citiesDir -Force
  $CitiesPath = Join-Path $citiesDir 'cities5000.txt'
}

function Get-PlaceKey([string]$value) {
  if (-not $value) { return '' }
  $normalized = $value.Normalize([System.Text.NormalizationForm]::FormD)
  $withoutMarks = [System.Text.RegularExpressions.Regex]::Replace($normalized, '\p{Mn}', '')
  return [System.Text.RegularExpressions.Regex]::Replace($withoutMarks.ToLowerInvariant(), '[^a-z0-9]+', '')
}

$cityCentres = @{}
$cityGrid = @{}
$gridSize = 0.5
$longitudeCellCount = [int](360 / $gridSize)
foreach ($line in Get-Content -LiteralPath $CitiesPath) {
  $fields = $line.Split("`t")
  if ($fields.Length -lt 15 -or $fields[8] -eq '') { continue }
  $population = 0L
  [void][long]::TryParse($fields[14], [ref]$population)
  $place = [pscustomobject]@{
    id = $fields[0]
    name = $fields[1]
    asciiName = $fields[2]
    country = $fields[8]
    latitude = [double]::Parse($fields[4], [System.Globalization.CultureInfo]::InvariantCulture)
    longitude = [double]::Parse($fields[5], [System.Globalization.CultureInfo]::InvariantCulture)
    population = $population
  }
  foreach ($name in @($fields[1], $fields[2]) | Select-Object -Unique) {
    $key = "$($fields[8])|$(Get-PlaceKey $name)"
    if ($key.EndsWith('|')) { continue }
    if (-not $cityCentres.ContainsKey($key) -or $place.population -gt $cityCentres[$key].population) {
      $cityCentres[$key] = $place
    }
  }
  $latitudeCell = [int][Math]::Floor(($place.latitude + 90) / $gridSize)
  $longitudeCell = [int][Math]::Floor(($place.longitude + 180) / $gridSize)
  $gridKey = "$($place.country)|$latitudeCell|$longitudeCell"
  if (-not $cityGrid.ContainsKey($gridKey)) { $cityGrid[$gridKey] = [System.Collections.Generic.List[object]]::new() }
  $cityGrid[$gridKey].Add($place)
}

function Get-CityCentreForAirport([string]$airportCode, [string]$country, [string]$municipality, [string]$searchableText, [double]$latitude, [double]$longitude) {
  $metroAliases = @{
    'KUL' = @{ key = 'MY|kualalumpur'; label = 'Kuala Lumpur' }
    'SZB' = @{ key = 'MY|kualalumpur'; label = 'Kuala Lumpur' }
    'PEN' = @{ key = 'MY|georgetown'; label = 'Penang' }
  }
  if ($metroAliases.ContainsKey($airportCode) -and $cityCentres.ContainsKey($metroAliases[$airportCode].key)) {
    $knownCentre = $cityCentres[$metroAliases[$airportCode].key]
    return [pscustomobject]@{
      name = $metroAliases[$airportCode].label
      latitude = $knownCentre.latitude
      longitude = $knownCentre.longitude
    }
  }

  $latitudeRange = 1.0
  $cosLatitude = [Math]::Max(0.05, [Math]::Abs([Math]::Cos($latitude * [Math]::PI / 180)))
  $longitudeRange = [Math]::Min(180, 1.0 / $cosLatitude)
  $latitudeCell = [int][Math]::Floor(($latitude + 90) / $gridSize)
  $longitudeCell = [int][Math]::Floor(($longitude + 180) / $gridSize)
  $latitudeCells = [int][Math]::Ceiling($latitudeRange / $gridSize)
  $longitudeCells = [int][Math]::Ceiling($longitudeRange / $gridSize)
  $nearby = [System.Collections.Generic.List[object]]::new()
  $seenPlaces = @{}
  for ($latOffset = -$latitudeCells; $latOffset -le $latitudeCells; $latOffset++) {
    $currentLatCell = $latitudeCell + $latOffset
    if ($currentLatCell -lt 0 -or $currentLatCell -ge [int](180 / $gridSize)) { continue }
    for ($lonOffset = -$longitudeCells; $lonOffset -le $longitudeCells; $lonOffset++) {
      $currentLonCell = ($longitudeCell + $lonOffset) % $longitudeCellCount
      if ($currentLonCell -lt 0) { $currentLonCell += $longitudeCellCount }
      $key = "$country|$currentLatCell|$currentLonCell"
      foreach ($place in $cityGrid[$key]) {
        if ($seenPlaces.ContainsKey($place.id)) { continue }
        $seenPlaces[$place.id] = $true
        $deltaLat = ($place.latitude - $latitude) * [Math]::PI / 180
        $deltaLonDegrees = $place.longitude - $longitude
        if ($deltaLonDegrees -gt 180) { $deltaLonDegrees -= 360 }
        if ($deltaLonDegrees -lt -180) { $deltaLonDegrees += 360 }
        $deltaLon = $deltaLonDegrees * [Math]::PI / 180
        $a = [Math]::Sin($deltaLat / 2) * [Math]::Sin($deltaLat / 2) +
          [Math]::Cos($latitude * [Math]::PI / 180) * [Math]::Cos($place.latitude * [Math]::PI / 180) *
          [Math]::Sin($deltaLon / 2) * [Math]::Sin($deltaLon / 2)
        $a = [Math]::Min(1, [Math]::Max(0, $a))
        $distance = 6371 * 2 * [Math]::Atan2([Math]::Sqrt($a), [Math]::Sqrt(1 - $a))
        if ([Math]::Abs($place.latitude - $latitude) -le $latitudeRange -and $distance -le 100) {
          $nearby.Add([pscustomobject]@{ place = $place; distance = $distance })
        }
      }
    }
  }

  $namedMajorCities = @($nearby | Where-Object {
    $_.place.population -ge 100000 -and
    ((Get-PlaceKey $_.place.name).Length -ge 5 -and $searchableText.Contains((Get-PlaceKey $_.place.name)) -or
     (Get-PlaceKey $_.place.asciiName).Length -ge 5 -and $searchableText.Contains((Get-PlaceKey $_.place.asciiName)))
  } | Sort-Object { $_.place.population } -Descending)
  if ($namedMajorCities.Count) { return $namedMajorCities[0].place }

  $exactKey = "$country|$(Get-PlaceKey $municipality)"
  if ($cityCentres.ContainsKey($exactKey)) { return $cityCentres[$exactKey] }

  $nearbyMajorCities = @($nearby | Where-Object { $_.place.population -ge 100000 -and $_.distance -le 35 } | Sort-Object distance)
  if ($nearbyMajorCities.Count) { return $nearbyMajorCities[0].place }

  return $null
}

New-Item -ItemType Directory -Path $directory -Force | Out-Null
$airports = @(
  Import-Csv -LiteralPath $CsvPath |
    Where-Object { $_.iata_code -cmatch '^[A-Z]{3}$' -and $_.type -notin @('closed', 'balloonport') } |
    Sort-Object iata_code |
    ForEach-Object {
      $municipality = $_.municipality
      $latitude = if ($_.latitude_deg) { [double]::Parse($_.latitude_deg, [System.Globalization.CultureInfo]::InvariantCulture) } else { $null }
      $longitude = if ($_.longitude_deg) { [double]::Parse($_.longitude_deg, [System.Globalization.CultureInfo]::InvariantCulture) } else { $null }
      $searchableText = Get-PlaceKey "$($_.iata_code) $municipality $($_.name) $($_.keywords)"
      $cityCentre = if ($null -ne $latitude -and $null -ne $longitude) {
        Get-CityCentreForAirport $_.iata_code $_.iso_country $municipality $searchableText $latitude $longitude
      } else { $null }
      $airportData = [ordered]@{
        code = $_.iata_code
        city = $municipality
        name = $_.name
        country = $_.iso_country
        type = $_.type
        scheduled = ($_.scheduled_service -eq 'yes')
        keywords = $_.keywords
      }
      if ($null -ne $latitude -and $null -ne $longitude) {
        $airportData.latitude = $latitude
        $airportData.longitude = $longitude
      }
      if ($cityCentre) {
        $airportData.cityCenterName = $cityCentre.name
        $airportData.cityCenterLatitude = $cityCentre.latitude
        $airportData.cityCenterLongitude = $cityCentre.longitude
      }
      [pscustomobject]$airportData
    }
)

$json = ConvertTo-Json -InputObject $airports -Depth 3 -Compress
[System.IO.File]::WriteAllText($output, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $($airports.Count) IATA-coded open airports to $output"
