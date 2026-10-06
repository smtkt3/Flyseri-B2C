$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env'
$certificatePath = Join-Path $projectRoot 'certs\supabase-root-2021.crt'

if (-not (Test-Path -LiteralPath $envPath)) {
  throw 'The private .env file is missing.'
}
if (-not (Test-Path -LiteralPath $certificatePath)) {
  throw 'The Supabase root certificate is missing.'
}

$randomBytes = New-Object byte[] 32
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $generator.GetBytes($randomBytes)
  $plainPassword = [BitConverter]::ToString($randomBytes).Replace('-', '')

  $encodedPassword = [Uri]::EscapeDataString($plainPassword)
  $encodedCertificatePath = [Uri]::EscapeDataString((Resolve-Path -LiteralPath $certificatePath).Path)
  $url = 'postgresql://flyseri_api.jkgkpgdwzuxletrmseqv:' + $encodedPassword +
    '@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=' + $encodedCertificatePath

  $contents = [IO.File]::ReadAllText($envPath)
  $replacement = 'DATABASE_URL=' + $url
  if ($contents -match '(?m)^DATABASE_URL=') {
    $contents = [regex]::Replace($contents, '(?m)^DATABASE_URL=.*$', [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $replacement })
  } else {
    $contents = $contents.TrimEnd("`r", "`n") + "`r`n" + $replacement + "`r`n"
  }
  [IO.File]::WriteAllText($envPath, $contents, [Text.UTF8Encoding]::new($false))
  Set-Clipboard -Value "ALTER ROLE flyseri_api WITH PASSWORD '$plainPassword';"
  Write-Output 'A random role password is saved in the ignored local .env file.'
  Write-Output 'The ALTER ROLE statement is on your clipboard. Paste it into the Supabase SQL Editor and click Run.'
  Read-Host 'After Supabase reports success, press Enter here to clear the clipboard' | Out-Null
} finally {
  Set-Clipboard -Value ''
  [Array]::Clear($randomBytes, 0, $randomBytes.Length)
  $generator.Dispose()
  $plainPassword = $null
}
