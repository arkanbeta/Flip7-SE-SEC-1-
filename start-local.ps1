# Starts Flip 7 Online on this computer (Windows): the backend and the frontend each
# open in their own window, then the game opens in your browser.
#
#   powershell -ExecutionPolicy Bypass -File .\start-local.ps1
#
# Close the two windows (or press Ctrl+C in them) to stop the game.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Start-Process powershell -WorkingDirectory (Join-Path $root 'backend') -ArgumentList '-NoExit', '-Command', 'npm run dev'
Start-Process powershell -WorkingDirectory (Join-Path $root 'frontend') -ArgumentList '-NoExit', '-Command', 'npm run dev'

Start-Sleep -Seconds 4
Start-Process 'http://localhost:5173'
