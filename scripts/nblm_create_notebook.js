/**
 * NotebookLM 새 노트북 생성 + 이름 지정 스크립트.
 *
 * 사용법:
 *   node scripts/nblm_create_notebook.js "<노트북 제목>" [urlOutFile]
 * 출력(마지막 줄 JSON): {"ok":true,"url":"https://notebooklm.google.com/notebook/<uuid>","uuid":"..."}
 * urlOutFile 을 주면 생성된 URL을 그 파일에도 기록한다(러너의 오디오 다운로드 폴백용).
 *
 * notebooklm-mcp v2.0.0에는 노트북 생성 도구가 없어 UI 자동화로 생성한다(2026-07-02 실증 절차).
 * 생성 직후 빈 노트북은 소스 추가 모달이 자동으로 열리므로 닫은 뒤 제목을 입력한다.
 * MCP 서버(및 그 브라우저 세션)가 실행 중이지 않을 때 돌릴 것(프로필 잠금 충돌 방지).
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require(String.raw`C:\Users\mini4\nodejs\node_modules\notebooklm-mcp\node_modules\patchright`);

const TITLE = process.argv[2];
const URL_OUT = process.argv[3];
if (!TITLE) {
  console.log(JSON.stringify({ ok: false, error: 'usage: node nblm_create_notebook.js "<title>"' }));
  process.exit(1);
}
const UUID_RE = /notebook\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/;

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
    await page.goto("https://notebooklm.google.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);
    if (/accounts\.google\.com/.test(page.url())) throw new Error("redirected to login");

    // 0) 홈 진입 직후 뜨는 공지/프로모션 오버레이 닫기(2026-07-18 '새로 만들기' 클릭 차단 사례)
    for (let round = 0; round < 4; round++) {
      const overlay = await page.locator(".cdk-overlay-backdrop-showing").first().isVisible({ timeout: 800 }).catch(() => false);
      if (!overlay) break;
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(1200);
      const still = await page.locator(".cdk-overlay-backdrop-showing").first().isVisible({ timeout: 500 }).catch(() => false);
      if (still) await page.locator(".cdk-overlay-backdrop-showing").first().click({ position: { x: 10, y: 10 } }).catch(() => {});
      await page.waitForTimeout(800);
    }

    // 1) "새로 만들기"/"노트북 만들기" 클릭
    const createSel = [
      'button:has-text("새로 만들기")',
      'button:has-text("노트북 만들기")',
      'button:has-text("Create new")',
      'button:has-text("New notebook")',
    ];
    let clicked = false;
    for (const sel of createSel) {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 2000 }).catch(() => false)) { await b.click(); clicked = true; break; }
    }
    if (!clicked) throw new Error("create-notebook button not found");

    // 2) 실제 UUID URL이 될 때까지 대기(중간에 /notebook/creating 을 거침)
    let uuid = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1500);
      const m = page.url().match(UUID_RE);
      if (m) { uuid = m[1]; break; }
    }
    if (!uuid) throw new Error("notebook uuid not resolved. url=" + page.url());
    const url = "https://notebooklm.google.com/notebook/" + uuid;
    console.error("created: " + url);
    if (URL_OUT) { try { fs.writeFileSync(URL_OUT, url + "\n", "utf-8"); } catch (e) { console.error("url out write failed: " + e.message); } }
    await page.waitForTimeout(3000);

    // 3) 자동으로 열린 소스 추가 모달 닫기(제목 입력을 위해)
    const closeSel = [
      '[role="dialog"] button[aria-label*="닫기"]',
      '[role="dialog"] button[aria-label*="close" i]',
      '.cdk-overlay-container button[aria-label*="닫기"]',
      '.cdk-overlay-container button:has(mat-icon:text-is("close"))',
    ];
    for (let round = 0; round < 4; round++) {
      const overlay = await page.locator(".cdk-overlay-backdrop-showing").first().isVisible({ timeout: 800 }).catch(() => false);
      if (!overlay) break;
      let closed = false;
      for (const sel of closeSel) {
        const b = page.locator(sel).first();
        if (await b.isVisible({ timeout: 600 }).catch(() => false)) { await b.click().catch(() => {}); closed = true; break; }
      }
      if (!closed) await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(1200);
    }

    // 4) 제목 입력(UI 실패 시 JS 이벤트 디스패치 폴백)
    let renamed = false;
    const input = page.locator("input.title-input").first();
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      try {
        await input.click({ timeout: 5000 });
        await input.fill(TITLE, { timeout: 5000 });
        await page.keyboard.press("Enter").catch(() => {});
        renamed = true;
      } catch (e) { /* 폴백으로 */ }
    }
    if (!renamed) {
      renamed = await page.evaluate((title) => {
        const el = document.querySelector("input.title-input");
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(el, title);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur();
        return true;
      }, TITLE).catch(() => false);
    }
    await page.waitForTimeout(3000);
    console.log(JSON.stringify({ ok: true, url, uuid, renamed, title: TITLE }));
  } finally {
    await ctx.close().catch(() => {});
  }
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
