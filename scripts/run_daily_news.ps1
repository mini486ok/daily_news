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

# Run headless pipeline; retry once on transient failure with no output
# (e.g. "API Error: Server error mid-response" killed the run on 2026-07-08).
$dayIndexEarly = Join-Path $Repo ("days\{0}\index.html" -f $date)
$code = 1
for ($attempt = 1; $attempt -le 2; $attempt++) {
    W ("claude attempt {0}" -f $attempt)
    & $Claude -p "/daily-news" --dangerously-skip-permissions --verbose *>&1 |
        Tee-Object -FilePath $log -Append
    $code = $LASTEXITCODE
    if (($code -eq 0) -or (Test-Path -LiteralPath $dayIndexEarly)) { break }
    W ("claude failed (exit {0}) with no page built -- retrying in 120 s" -f $code)
    Start-Sleep -Seconds 120
}

# ---- Deterministic fallbacks (the agent flaked twice on these steps) ----
$dayIndex = Join-Path $Repo ("days\{0}\index.html" -f $date)
$m4aFile  = Join-Path $Repo ("days\{0}\daily-news-{0}.m4a" -f $date)
$nbFile   = Join-Path $Repo ("days\{0}\notebook_url.txt" -f $date)

if (Test-Path -LiteralPath $dayIndex) {
    # Fallback 1: audio missing but notebook URL known -> download it ourselves (waits up to 30 min)
    if (-not (Test-Path -LiteralPath $m4aFile) -and (Test-Path -LiteralPath $nbFile)) {
        $nb = (Get-Content -LiteralPath $nbFile -TotalCount 1).Trim()
        if ($nb) {
            W ("fallback: audio missing -- downloading from " + $nb)
            & node (Join-Path $Repo 'scripts\nblm_download_audio.js') $nb $m4aFile 30 *>&1 |
                Tee-Object -FilePath $log -Append
        }
    }
    # Fallback 2: uncommitted work or no new commit -> deploy ourselves
    $after = ''
    try { $after = (& git rev-parse HEAD 2>$null | Select-Object -Last 1) } catch {}
    $dirty = 0
    try { $dirty = (& git status --porcelain 2>$null | Measure-Object).Count } catch {}
    if (($dirty -gt 0) -or ($before -eq $after)) {
        W ("fallback: deploying (dirty={0}, newCommit={1})" -f $dirty, ($before -ne $after))
        & git add -A *>&1 | Out-Null
        & git commit -m ("news {0}" -f $date) *>&1 | Tee-Object -FilePath $log -Append
        & git push origin main *>&1 | Tee-Object -FilePath $log -Append
    }
    $final = ''
    try { $final = (& git rev-parse HEAD 2>$null | Select-Object -Last 1) } catch {}
    if ($final -and ($before -ne $final)) { W ("OK: published {0}, commit {1}" -f $date, $final) }
    else { W ("WARN: still no new commit for {0} -- check log" -f $date) }
} else {
    W ("WARN: claude exited {0} but days/{1} not created (0 articles, or it stopped to ask)" -f $code, $date)
}

W ("=== exit {0} / done {1} ===" -f $code, (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'))

# prune logs older than 30 days
Get-ChildItem -Path $LogDir -Filter 'daily-news_*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

exit $code
