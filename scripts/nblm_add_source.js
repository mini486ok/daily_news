/**
 * NotebookLM 노트북에 "복사된 텍스트" 소스를 추가하는 스크립트.
 *
 * 사용법:
 *   node scripts/nblm_add_source.js <notebookUrl> <sourceFilePath> [screenshotDir]
 *
 * 왜 필요한가: notebooklm-mcp v2.0.0 의 add_source 는 "소스 추가" 버튼을 클릭해
 * 다이얼로그를 열려고 하는데, **빈 노트북은 로드 시 소스 추가 다이얼로그가 자동으로
 * 열려 있어** 오버레이가 클릭을 가로막아 항상 실패한다(2026-07-02 확인).
 * 이 스크립트는 자동 열린 다이얼로그를 그대로 활용하고, 닫혀 있으면 버튼으로 연다.
 * notebooklm-mcp 의 영구 Chrome 프로필(로그인 쿠키)을 재사용하므로 MCP 서버가
 * 실행 중이지 않을 때 돌려야 한다(프로필 잠금 충돌 방지).
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require(String.raw`C:\Users\mini4\nodejs\node_modules\notebooklm-mcp\node_modules\patchright`);

const [, , NOTEBOOK_URL, SOURCE_FILE, SHOT_DIR] = process.argv;
if (!NOTEBOOK_URL || !SOURCE_FILE) {
  console.log(JSON.stringify({ ok: false, error: "usage: node nblm_add_source.js <notebookUrl> <sourceFile> [shotDir]" }));
  process.exit(1);
}
const CONTENT = fs.readFileSync(SOURCE_FILE, "utf-8");
const shots = SHOT_DIR || process.env.TEMP || ".";
const shot = async (page, name) => {
  try { await page.screenshot({ path: path.join(shots, `nblm_${name}.png`) }); } catch (e) {}
};

(async () => {
  const profileDir = path.join(process.env.LOCALAPPDATA, "notebooklm-mcp", "Data", "chrome_profile");
  const STATE = path.join(process.env.LOCALAPPDATA, "notebooklm-mcp", "Data", "browser_state", "state.json");
  const opts = {
    headless: true,
    viewport: { width: 1440, height: 960 },
    storageState: STATE,
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check"],
  };
  let ctx;
  try { ctx = await chromium.launchPersistentContext(profileDir, { ...opts, channel: "chrome" }); }
  catch (e) { ctx = await chromium.launchPersistentContext(profileDir, opts); }
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto(NOTEBOOK_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    if (/accounts\.google\.com/.test(page.url())) throw new Error("redirected to login");
    await shot(page, "01_loaded");

    // 현재 소스 개수(사이드바 행 수)
    const countSources = () => page.locator(".single-source-container").count();
    const before = await countSources();
    console.error("sources before: " + before);

    // 1) "복사된 텍스트" 칩 클릭.
    //    빈 노트북은 로드 시 "Create Audio and Video Overviews ..." 모달이 자동으로 열리고
    //    (role="dialog" 없음, cdk-overlay), 그 안에 파일 업로드/웹사이트/Drive/복사된 텍스트
    //    칩이 있다(2026-07-02 한국어 UI 스크린샷으로 확인). 칩을 직접 찾아 클릭하고,
    //    안 보이면 "소스 추가" 버튼으로 모달을 연 뒤 다시 찾는다.
    const chipSel = [
      ':is(button,[role="button"]):has-text("복사된 텍스트")',
      ':is(button,[role="button"]):has(mat-icon:text-is("content_paste"))',
      ':is(button,[role="button"]):has-text("Copied text")',
      ':is(button,[role="button"]):has-text("Pasted text")',
    ];
    const findChip = async (timeoutEach) => {
      for (const sel of chipSel) {
        const c = page.locator(sel).first();
        if (await c.isVisible({ timeout: timeoutEach }).catch(() => false)) return { c, sel };
      }
      return null;
    };
    let chip = await findChip(2500);
    if (!chip) {
      // 모달이 안 열려 있으면 "소스 추가"(aria-label "출처 추가")로 연다.
      const addBtnSel = ['button.add-source-button', 'button[aria-label*="출처 추가"]', 'button[aria-label*="소스 추가"]', 'button[aria-label*="add source" i]'];
      for (const sel of addBtnSel) {
        const b = page.locator(sel).first();
        if (await b.isVisible({ timeout: 1500 }).catch(() => false)) {
          await b.click({ timeout: 8000 }).catch(() => {});
          break;
        }
      }
      await page.waitForTimeout(2000);
      chip = await findChip(2500);
    }
    if (!chip) {
      const texts = await page.locator('button, [role="button"]').allInnerTexts().catch(() => []);
      await shot(page, "02b_chip_not_found");
      throw new Error("text-source chip not found. visible buttons: " + JSON.stringify(texts).slice(0, 600));
    }
    await shot(page, "02_dialog");
    await chip.c.click();
    console.error("clicked text chip: " + chip.sel);
    await page.waitForTimeout(2000);
    await shot(page, "03_paste_panel");

    // 2) 본문 붙여넣기 — 모달 내 textarea(없으면 페이지 전체에서 탐색)
    let ta = page.locator('[role="dialog"] textarea').first();
    if (!(await ta.isVisible({ timeout: 2500 }).catch(() => false))) {
      ta = page.locator("textarea:visible").last();
    }
    if (!(await ta.isVisible({ timeout: 5000 }).catch(() => false))) {
      await shot(page, "03b_no_textarea");
      throw new Error("paste textarea not visible");
    }
    await ta.click();
    await ta.fill(CONTENT);
    await page.waitForTimeout(800);
    await shot(page, "04_filled");

    // 3) "삽입" 확정 버튼 — 반드시 오버레이(모달) 안에서만 찾는다.
    //    (페이지 뒤의 "메모 추가" 버튼이 "추가" 텍스트로 오매칭되는 사고 방지, 2026-07-02 확인)
    const confirmSel = [
      '.cdk-overlay-container button:has-text("삽입")',
      '.cdk-overlay-container button:has-text("Insert")',
      '.cdk-overlay-container button.mdc-button--raised:not(:has-text("취소")):not(:has-text("닫기"))',
    ];
    let confirmed = false;
    for (const sel of confirmSel) {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 2000 }).catch(() => false)) {
        const label = (await b.innerText().catch(() => "")).trim();
        if (/취소|닫기|cancel|close/i.test(label)) continue;
        await b.click({ timeout: 10000 });
        confirmed = true;
        console.error(`clicked confirm: ${sel} ("${label}")`);
        break;
      }
    }
    if (!confirmed) {
      const texts = await page.locator("button:visible").allInnerTexts().catch(() => []);
      await shot(page, "04b_confirm_not_found");
      throw new Error("confirm button not found. visible buttons: " + JSON.stringify(texts).slice(0, 600));
    }

    // 4) 소스 등록 완료 대기(사이드바 소스 행 증가)
    let after = before;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1500);
      after = await countSources();
      if (after > before) break;
    }
    await shot(page, "05_done");
    console.log(JSON.stringify({ ok: after > before, sourcesBefore: before, sourcesAfter: after, url: page.url() }));
    if (!(after > before)) process.exit(1);
  } finally {
    await ctx.close().catch(() => {});
  }
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
