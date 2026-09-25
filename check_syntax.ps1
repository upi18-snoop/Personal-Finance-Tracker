$base = "d:\DATA LAPTOP LAMA\Upi\Personal Finance Tracker\Personal-Finance-Tracker\js"

Write-Output "=== 1. app.js ==="
node --check "$base\app.js" 2>&1
Write-Output "Exit code: $LASTEXITCODE"

Write-Output ""
Write-Output "=== 2. dashboard.js ==="
node --check "$base\dashboard.js" 2>&1
Write-Output "Exit code: $LASTEXITCODE"

Write-Output ""
Write-Output "=== 3. reports.js ==="
node --check "$base\reports.js" 2>&1
Write-Output "Exit code: $LASTEXITCODE"

Write-Output ""
Write-Output "=== 4. git diff --stat ==="
git -C "d:\DATA LAPTOP LAMA\Upi\Personal Finance Tracker\Personal-Finance-Tracker" diff --stat 2>&1
Write-Output "Exit code: $LASTEXITCODE"
