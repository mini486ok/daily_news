/**
 * NotebookLM 스튜디오의 완성된 오디오 오버뷰 아티팩트를 삭제하는 스크립트(재생성 준비용).
 *
 * 사용법:
 *   node scripts/nblm_delete_audio.js <notebookUrl>
 *
 * 오디오가 이미 존재하면 MCP generate_audio 가 "already existed"로 건너뛰므로,
 * 재생성 전에 기존 아티팩트를 지워야 한다. MCP 서버 미실행 상태에서 돌릴 것.
 */
const path = require("path");
const { chromium } = require(String.raw`C:\Users\mini4\nodejs\node_modules\notebooklm-mcp\node_modules\patchright`);

const [, , NOTEBOOK_URL] = process.argv;
if (!NOTEBOOK_URL) {
  console.log(JSON.stringify({ ok: false, error: "usage: node nblm_delete_audio.js <notebookUrl>" }));
  process.exit(1);
}

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

    const tile = page.locator("artifact-library-item").first();
    if (!(await tile.isVisible({ timeout: 5000 }).catch(() => false))) {
      console.log(JSON.stringify({ ok: true, deleted: false, note: "no audio artifact present" }));
      return;
    }
    const moreBtn = page.locator('artifact-library-item button:has(mat-icon:text-is("more_vert"))').first();
    if (!(await moreBtn.isVisible({ timeout: 5000 }).catch(() => false))) throw new Error("more(⋮) button not found");
    await moreBtn.click();
    await page.waitForTimeout(1200);

    const delSel = [
      '[role="menuitem"]:has(mat-icon:text-is("delete"))',
      '[role="menuitem"]:has-text("삭제")',
      '[role="menuitem"]:has-text("Delete")',
    ];
    let item = null;
    for (const sel of delSel) {
      const m = page.locator(sel).first();
      if (await m.isVisible({ timeout: 1500 }).catch(() => false)) { item = m; break; }
    }
    if (!item) {
      const texts = await page.locator('[role="menuitem"]').allInnerTexts().catch(() => []);
      throw new Error("delete menu item not found. items: " + JSON.stringify(texts).slice(0, 300));
    }
    await item.click();
    await page.waitForTimeout(1500);

    // 확인 다이얼로그(있으면): 오버레이 안의 "삭제" 버튼
    const confirm = page.locator('.cdk-overlay-container button:has-text("삭제"), .cdk-overlay-container button:has-text("Delete")').first();
    if (await confirm.isVisible({ timeout: 2500 }).catch(() => false)) await confirm.click();

    // 타일이 사라질 때까지 대기
    let gone = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1500);
      if (!(await page.locator("artifact-library-item").first().isVisible({ timeout: 500 }).catch(() => false))) { gone = true; break; }
    }
    console.log(JSON.stringify({ ok: gone, deleted: gone }));
    if (!gone) process.exit(1);
  } finally {
    await ctx.close().catch(() => {});
  }
})().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
