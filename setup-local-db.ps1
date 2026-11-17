# One-time local database setup for Flip 7 Online (Windows).
#
#   powershell -ExecutionPolicy Bypass -File .\setup-local-db.ps1
#
# Asks for your MySQL root password once, then:
#   1. creates the flip7_online database from backend/src/db/schema.sql (skipped if it exists)
#   2. creates the flip7_app database user with the DB_PASSWORD found in backend/.env
# Safe to run again: it never drops or overwrites existing data.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root 'backend\.env'
$schema = Join-Path $root 'backend\src\db\schema.sql'

if (-not (Test-Path $envFile)) { throw "backend\.env not found. Copy backend\.env.example to backend\.env first." }

$settings = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim() }
}
$dbName = $settings['DB_NAME']
$dbUser = $settings['DB_USER']
$dbPass = $settings['DB_PASSWORD']
if (-not $dbPass -or $dbPass -like 'replace_with*') { throw "Set a real DB_PASSWORD in backend\.env first." }
if ($dbPass -notmatch '^[A-Za-z0-9_\-]+$' -or $dbUser -notmatch '^[A-Za-z0-9_]+$' -or $dbName -notmatch '^[A-Za-z0-9_]+$') {
  throw "DB_NAME, DB_USER and DB_PASSWORD in backend\.env may only contain letters, digits, _ and - for this script."
}

$mysql = (Get-Command mysql -ErrorAction SilentlyContinue).Source
if (-not $mysql) { $mysql = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe' }
if (-not (Test-Path $mysql)) { throw "mysql.exe not found. Install MySQL 8 or add its bin folder to PATH." }

$secure = Read-Host -AsSecureString 'MySQL root password'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$env:MYSQL_PWD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

try {
  $common = @('-u', 'root', '--default-character-set=utf8mb4')

  $existing = & $mysql @common -N -B -e "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$dbName';"
  if ($LASTEXITCODE -ne 0) { throw "Could not log in to MySQL as root. Check the password and that the MySQL80 service is running." }

  if ($existing) {
    Write-Host "Database $dbName already exists - leaving it untouched."
  } else {
    Write-Host "Creating database $dbName ..."
    cmd /c "`"$mysql`" -u root --default-character-set=utf8mb4 < `"$schema`""
    if ($LASTEXITCODE -ne 0) { throw "Loading schema.sql failed." }
  }

  Write-Host "Creating database user $dbUser ..."
  $sql = "CREATE USER IF NOT EXISTS '$dbUser'@'localhost' IDENTIFIED BY '$dbPass'; " +
         "ALTER USER '$dbUser'@'localhost' IDENTIFIED BY '$dbPass'; " +
         "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE ON $dbName.* TO '$dbUser'@'localhost';"
  & $mysql @common -e $sql
  if ($LASTEXITCODE -ne 0) { throw "Creating the database user failed." }

  Write-Host ""
  Write-Host "Done. The database is ready." -ForegroundColor Green
} finally {
  Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
}
