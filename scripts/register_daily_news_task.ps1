# register_daily_news_task.ps1
# 매일 새벽 5시(KST, 로컬 시간) /daily-news 를 실행하는 Windows 예약 작업을 (재)등록한다.
#   핵심: 작업이 실행하는 러너를 Google Drive(한글 경로) 밖의 로컬 ASCII 경로에 "복사"해 두고
#         예약 작업은 그 로컬 복사본을 실행한다(새벽 트리거 시 마운트/인코딩 문제 회피).
# 같은 이름 작업이 있으면 먼저 제거 후 재등록(멱등). 본인 계정 작업이라 관리자 권한 없이 등록 가능.
#   실행:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register_daily_news_task.ps1

$TaskName = 'DailyNews-AutoBrief'
$RepoDir  = 'C:\Users\mini4\내 드라이브(mini486ok@gmail.com)\claude_project\202606_daily_news'
$LocalDir = 'C:\Users\mini4\daily_news_auto'                 # 로컬 ASCII 경로(작업 실행 안정성)
$LocalRun = Join-Path $LocalDir 'run_daily_news.ps1'

# 1) 정본 러너를 로컬 ASCII 경로로 복사 — 예약 작업은 이 복사본을 실행한다.
#    Google Drive 원본 읽기 지연(방금 수정 직후 등)에 대비해 검증+재시도하고, 실패 시 중단한다.
New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null
$src = Join-Path $RepoDir 'scripts\run_daily_news.ps1'
$copied = $false
for ($i = 1; $i -le 5; $i++) {
    try { Copy-Item -LiteralPath $src -Destination $LocalRun -Force -ErrorAction Stop } catch {}
    if ((Test-Path -LiteralPath $LocalRun) -and ((Get-Item -LiteralPath $LocalRun).Length -gt 0)) { $copied = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $copied) { Write-Error "[중단] 러너 복사 실패: $src → $LocalRun (Google Drive 원본을 못 읽음)"; exit 1 }
Write-Host "[복사] 러너 → $LocalRun"

# 2) 작업 정의 (로컬 5:00 = KST 5:00, 이 머신 시간대 Korea Standard Time 확인됨)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $LocalRun)

$trigger = New-ScheduledTaskTrigger -Daily -At '5:00AM'

$settings = New-ScheduledTaskSettingsSet `
    -WakeToRun `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -MultipleInstances IgnoreNew `
    -DontStopIfGoingOnBatteries `
    -AllowStartIfOnBatteries

# 로그온 세션(Interactive)에서 실행: Google Drive·Git 인증·claude 인증을 그대로 사용.
$principal = New-ScheduledTaskPrincipal -UserId ('{0}\{1}' -f $env:USERDOMAIN, $env:USERNAME) `
    -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description '매일 새벽 5시(KST) /daily-news 자동 실행 → 어제 뉴스 수집·요약·칠판 인포그래픽·GitHub Pages 배포' |
    Out-Null

Write-Host "[OK] 예약 작업 '$TaskName' 재등록 완료 (매일 05:00 KST, 로컬 러너 실행)."
