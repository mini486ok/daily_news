# run_daily_news.ps1  (canonical source; register script copies this to the local ASCII path
#   C:\Users\mini4\daily_news_auto\run_daily_news.ps1, which Task Scheduler actually runs)
# IMPORTANT: keep this file ASCII-only. Windows PowerShell 5.1 reads a BOM-less .ps1 using the
#   system ANSI codepage (CP949 on Korean Windows), which corrupts non-ASCII string literals
#   (e.g. the Korean "My Drive" path) and breaks Test-Path. So we discover the Google Drive repo
#   folder dynamically by its ASCII email tag instead of hardcoding the Korean path.
#   (Also: the launcher must live OFF Google Drive on a local ASCII path, or the 5 AM trigger
#    fails to even read the .ps1 -- verified 2026-06-23.)

$ErrorActionPreference = 'Continue'
try { $OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$Claude = 'C:\Users\mini4\.local\bin\claude.exe'
$LogDir = 'C:\Users\mini4\daily_news_auto\logs'

# node (portable) on PATH: the /daily-news audiobook step runs scripts/nblm_*.js via node.
$env:Path = 'C:\Users\mini4\nodejs;' + $env:Path

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$stamp = (Get-Date).ToString('yyyy-MM-dd_HHmmss')
$log   = Join-Path $LogDir "daily-news_$stamp.log"
function W($m) { ("{0} {1}" -f (Get-Date).ToString('HH:mm:ss'), $m) | Tee-Object -FilePath $log -Append }

W ("=== start {0} ===" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'))

# Locate the Google Drive repo without any Korean literal (match by ASCII email tag).
function Find-Repo {
    $gd = Get-ChildItem -LiteralPath $env:USERPROFILE -Directory -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -like '*mini486ok@gmail.com*' } |
          Select-Object -First 1
    if (-not $gd) { return $null }
    $p = Join-Path $gd.FullName 'claude_project\202606_daily_news'
    if (Test-Path -LiteralPath $p) { return $p } else { return $null }
}

# Wait for the Google Drive mount/repo to be ready (up to 8 minutes; covers wake-from-sleep delay).
$deadline = (Get-Date).AddMinutes(8)
$Repo = $null
while (-not ($Repo = Find-Repo)) {
    if ((Get-Date) -ge $deadline) {
        W "[ERROR] repo not found within 8 min (Google Drive not mounted / not visible to task session)"
        exit 2
    }
    W "waiting for Google Drive repo..."
    Start-Sleep -Seconds 15
}
W ("repo found: {0}" -f $Repo)
Set-Location -LiteralPath $Repo

# Target date = yesterday in KST (matches scripts/build_news.py 'date'): local -> UTC -> +9h -> -1 day.
$date = (Get-Date).ToUniversalTime().AddHours(9).AddDays(-1).ToString('yyyy-MM-dd')
W ("target date (yesterday KST): {0}" -f $date)

# If that day is already published, do nothing (deterministic; avoids overwrite / confirmation halt).
if (Test-Path -LiteralPath (Join-Path $Repo ("days\{0}\index.html" -f $date))) {
    W ("already published {0} -- skip, nothing to do" -f $date)
    exit 0
}

# Capture HEAD before, run headless pipeline, then verify a page was built AND a new commit was pushed.
$before = ''
try { $before = (& git rev-parse HEAD 2>$null | Select-Object -Last 1) } catch {}

& $Claude -p "/daily-news" --dangerously-skip-permissions --verbose *>&1 |
    Tee-Object -FilePath $log -Append
$code = $LASTEXITCODE

$after = ''
try { $after = (& git rev-parse HEAD 2>$null | Select-Object -Last 1) } catch {}

if (Test-Path -LiteralPath (Join-Path $Repo ("days\{0}\index.html" -f $date))) {
    if ($after -and ($before -ne $after)) { W ("OK: published {0}, new commit {1}" -f $date, $after) }
    else { W ("WARN: days/{0} built but no new commit -- push may have failed" -f $date) }
} else {
    W ("WARN: claude exited {0} but days/{1} not created (0 articles, or it stopped to ask)" -f $code, $date)
}

W ("=== exit {0} / done {1} ===" -f $code, (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'))

# prune logs older than 30 days
Get-ChildItem -Path $LogDir -Filter 'daily-news_*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit $code
