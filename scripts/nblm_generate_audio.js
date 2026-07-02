/**
 * NotebookLM 오디오 오버뷰 생성 트리거 스크립트(맞춤 프롬프트 적용).
 *
 * 사용법:
 *   node scripts/nblm_generate_audio.js <notebookUrl> <프롬프트파일(txt)>
 * 출력(마지막 줄 JSON): {"ok":true,"status":"started"} — 생성을 시작만 하고 반환한다.
 * 완성 대기·저장은 nblm_download_audio.js 가 담당.
 *
 * 절차(2026-07-02 한국어 UI 실증): 스튜디오의 "AI 오디오 오버뷰 맞춤설정"(aria-label) 버튼
 * → 오버레이의 textarea에 프롬프트 입력 → "생성" 버튼. 오디오가 이미 있으면 실패로 보고
 * (재생성하려면 먼저 scripts/nblm_delete_audio.js 로 삭제).
 * MCP 서버 미실행 상태에서 돌릴 것.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require(String.raw`C:\Users\mini4\nodejs\node_modules\notebooklm-mcp\node_modules\patchright`);

const [, , NOTEBOOK_URL, PROMPT_FILE] = process.argv;
if (!NOTEBOOK_URL || !PROMPT_FILE) {
  console.log(JSON.stringify({ ok: false, error: "usage: node nblm_generate_audio.js <notebookUrl> <promptFile>" }));
  process.exit(1);
}
const PROMPT = fs.readFileSync(PROMPT_FILE, "utf-8").trim();

(async () => {
  const profileDir = path.join(process.env.LOCALAPPDATA, "notebooklm-mcp", "Data", "chrome_profile");
  const STATE = path.join(process.env.LOCALAPPDATA, "notebooklm-mcp", "Data", "browser_state", "state.json");
  const opts = {
    headless: true, viewport: { width: 1440, height: 960 }, storageState: STATE,
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
  };
  let ctx;
  try { ctx = await chromium.launchPersistentContext(profileDir, { ...opts, channel: "chrome" }); }
  catch (e) { ctx = await chromium.launchPersistentContext(profileDir, opts); }
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto(NOTEBOOK_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(7000);
    if (/accounts\.google\.com/.test(page.url())) throw new Error("redirected to login");

    // 완성된 오디오가 이미 있으면 재생성 전 삭제가 필요하므로 실패로 보고
    if (await page.locator("artifact-library-item").first().isVisible({ timeout: 2000 }).catch(() => false)) {
      throw new Error("audio artifact already exists — run nblm_delete_audio.js first");
    }

    // 1) "AI 오디오 오버뷰 맞춤설정" 버튼
    const customizeSel = [
      'button[aria-label*="오디오 오버뷰 맞춤설정"]',
      'button[aria-label*="오디오"][aria-label*="맞춤설정"]',
      'button[aria-label*="customize audio" i]',
      'button[aria-label*="customise audio" i]',
    ];
    let opened = false;
    for (const sel of customizeSel) {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 2000 }).catch(() => false)) { await b.click(); opened = true; break; }
    }
    if (!opened) throw new Error("audio customize button not found");
    await page.waitForTimeout(2000);

    // 2) 오버레이의 프롬프트 입력란 채우기
    const ta = page.locator('.cdk-overlay-container textarea, [role="dialog"] textarea').first();
    if (!(await ta.isVisible({ timeout: 5000 }).catch(() => false))) throw new Error("prompt textarea not visible in customize dialog");
    await ta.click();
    await ta.fill(PROMPT);
    await page.waitForTimeout(800);

    // 3) "생성" 버튼 (오버레이 안에서만, 취소 제외)
    const genSel = [
      '.cdk-overlay-container button:has-text("생성")',
      '.cdk-overlay-container button:has-text("Generate")',
    ];
    let generated = false;
    for (const sel of genSel) {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 2000 }).catch(() => false)) {
        const label = (await b.innerText().catch(() => "")).trim();
        if (/취소|닫기|cancel|close/i.test(label)) continue;
        await b.click({ timeout: 10000 });
        generated = true;
        console.error(`clicked generate: "${label}"`);
        break;
      }
    }
    if (!generated) {
      const texts = await page.locator(".cdk-overlay-container button").allInnerTexts().catch(() => []);
      throw new Error("generate button not found. overlay buttons: " + JSON.stringify(texts).slice(0, 300));
    }

    // 4) 생성 시작 확인: 스피너 타일 또는 "생성 중" 문구 (최대 60초)
    let started = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(3000);
      const tile = await page.locator("artifact-library-item").first().isVisible({ timeout: 500 }).catch(() => false);
      const studioText = await page.locator(".studio-panel").first().textContent({ timeout: 500 }).catch(() => "");
      if (tile || /생성 중|잠시 후 다시/.test(studioText || "")) { started = true; break; }
    }
    console.log(JSON.stringify({ ok: started, status: started ? "started" : "unknown" }));
    if (!started) process.exit(1);
  } finally {
    await ctx.close().catch(() => {});
  }
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
