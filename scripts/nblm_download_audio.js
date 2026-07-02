/**
 * NotebookLM 오디오 오버뷰 완성 대기 + 다운로드 스크립트.
 *
 * 사용법:
 *   node scripts/nblm_download_audio.js <notebookUrl> <저장할파일경로(.m4a)> [최대대기분:기본30]
 *
 * 동작: 노트북을 열고 스튜디오의 완성된 오디오 타일(artifact-library-item에 재생/⋮ 버튼)이
 * 나타날 때까지 폴링 → ⋮(more_vert) 클릭 → "다운로드" 메뉴 → download 이벤트를 받아
 * 지정 경로에 저장한다. notebooklm-mcp 의 영구 Chrome 프로필을 재사용하므로
 * MCP 서버가 실행 중이지 않을 때 돌릴 것.
 */
const path = require("path");
const { chromium } = require(String.raw`C:\Users\mini4\nodejs\node_modules\notebooklm-mcp\node_modules\patchright`);

const [, , NOTEBOOK_URL, DEST_FILE, MAX_MIN] = process.argv;
if (!NOTEBOOK_URL || !DEST_FILE) {
  console.log(JSON.stringify({ ok: false, error: "usage: node nblm_download_audio.js <notebookUrl> <destFile> [maxWaitMin]" }));
  process.exit(1);
}
const maxWaitMs = (parseInt(MAX_MIN, 10) || 30) * 60 * 1000;

(async () => {
  const profileDir = path.join(process.env.LOCALAPPDATA, "notebooklm-mcp", "Data", "chrome_profile");
  const STATE = path.join(process.env.LOCALAPPDATA, "notebooklm-mcp", "Data", "browser_state", "state.json");
  const opts = {
    headless: true, viewport: { width: 1440, height: 960 }, storageState: STATE,
    acceptDownloads: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
  };
  let ctx;
  try { ctx = await chromium.launchPersistentContext(profileDir, { ...opts, channel: "chrome" }); }
  catch (e) { ctx = await chromium.launchPersistentContext(profileDir, opts); }
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto(NOTEBOOK_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    if (/accounts\.google\.com/.test(page.url())) throw new Error("redirected to login");

    // 1) 완성 타일 대기: artifact-library-item 안에 ⋮(more_vert) 또는 재생 버튼이 생기면 완성
    const moreBtn = page.locator('artifact-library-item button:has(mat-icon:text-is("more_vert"))').first();
    const playBtn = page.locator("artifact-library-item button.artifact-action-button").first();
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < maxWaitMs) {
      if (await moreBtn.isVisible({ timeout: 1000 }).catch(() => false)) { ready = true; break; }
      if (await playBtn.isVisible({ timeout: 500 }).catch(() => false)) { ready = true; break; }
      console.error(`waiting... ${Math.round((Date.now() - t0) / 1000)}s`);
      await page.waitForTimeout(20000);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(5000);
    }
    if (!ready) throw new Error(`audio not ready within ${maxWaitMs / 60000} min`);
    console.error("audio tile ready at " + Math.round((Date.now() - t0) / 1000) + "s");

    // 2) ⋮ 메뉴 → "다운로드" 클릭 → download 이벤트 저장
    await moreBtn.click({ timeout: 15000 });
    await page.waitForTimeout(1200);
    const dlSel = [
      '[role="menuitem"]:has(mat-icon:text-is("download"))',
      '[role="menuitem"]:has-text("다운로드")',
      '[role="menuitem"]:has-text("Download")',
    ];
    let dlItem = null;
    for (const sel of dlSel) {
      const m = page.locator(sel).first();
      if (await m.isVisible({ timeout: 1500 }).catch(() => false)) { dlItem = m; break; }
    }
    if (!dlItem) {
      const texts = await page.locator('[role="menuitem"]').allInnerTexts().catch(() => []);
      throw new Error("download menu item not found. items: " + JSON.stringify(texts).slice(0, 300));
    }
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 120000 }),
      dlItem.click(),
    ]);
    await download.saveAs(DEST_FILE);
    const fs = require("fs");
    const size = fs.statSync(DEST_FILE).size;
    console.log(JSON.stringify({ ok: true, file: DEST_FILE, bytes: size, suggested: download.suggestedFilename() }));
  } finally {
    await ctx.close().catch(() => {});
  }
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
