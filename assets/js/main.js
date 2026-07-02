/* =========================================================================
   Daily News — 테마 토글 + 메인 동적 렌더링(월→날짜→주제→기사) + 상세 네비
   + 공유(Web Share API) + 오디오 브리핑 + 인포그래픽 라이트박스
   ========================================================================= */
(function () {
  "use strict";

  const root = document.documentElement;
  function currentTheme() { return root.getAttribute("data-theme") || "light"; }
  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch (e) {}
    const btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
  }
  window.addEventListener("DOMContentLoaded", function () {
    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.textContent = currentTheme() === "dark" ? "☀️" : "🌙";
      btn.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
    }
    if (document.getElementById("app")) initIndex();
    else if (document.querySelector(".day-hero")) initDetail();
  });

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtDate(d) {
    const days = ["일", "월", "화", "수", "목", "금", "토"];
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt)) return d;
    return `${d} (${days[dt.getDay()]})`;
  }
  function monthOf(d) { return String(d || "").slice(0, 7); }
  function fmtMonth(m) {
    const p = String(m || "").split("-");
    return p.length === 2 ? `${p[0]}년 ${Number(p[1])}월` : m;
  }

  /* ---------- 공유 유틸(공용) ---------- */
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 2200);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((res, rej) => {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); res(); } catch (e) { rej(e); }
      document.body.removeChild(ta);
    });
  }
  // 이미지 파일을 포함해 공유 시도 → 링크 공유 → 링크 복사 순으로 폴백
  async function shareArticle(opt) {
    const payload = { title: opt.title, text: opt.text || opt.title, url: opt.url };
    if (opt.imgUrl && navigator.share && navigator.canShare) {
      try {
        const blob = await fetch(opt.imgUrl).then((r) => (r.ok ? r.blob() : Promise.reject()));
        const file = new File([blob], (opt.imgName || "infographic") + ".png", { type: blob.type || "image/png" });
        const withFile = { files: [file], title: opt.title, text: (opt.text || opt.title) + "\n" + opt.url };
        if (navigator.canShare(withFile)) { await navigator.share(withFile); return; }
      } catch (e) { if (e && e.name === "AbortError") return; /* 파일 공유 불가 → 링크 공유로 */ }
    }
    if (navigator.share) {
      try { await navigator.share(payload); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    try { await copyText(opt.url); toast("링크를 복사했습니다. 카카오톡 등에 붙여넣어 공유하세요."); }
    catch (e) { toast("공유를 지원하지 않는 환경입니다."); }
  }

  /* =======================================================================
     메인(아카이브) 페이지 — 월 → 날짜 2단 구조
     ======================================================================= */
  const state = { query: "", month: "all", date: "all", topic: "all", days: [], open: {}, openM: {} };

  function initIndex() {
    fetch("data/manifest.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((m) => {
        state.days = (m.days || []).slice();
        const dates = state.days.map((d) => d.date);
        const params = new URLSearchParams(location.search);
        const want = params.get("d");
        if (want && dates.indexOf(want) >= 0) { state.date = want; state.month = monthOf(want); }
        else if (dates.length) { state.date = dates[0]; state.month = monthOf(dates[0]); } // 기본: 최신 날짜만
        if (dates.length) {
          state.open[dates[0]] = true;          // 월/전체 보기에서 최신 날짜만 펼침
          state.openM[monthOf(dates[0])] = true; // 전체 보기에서 최신 월만 펼침
        }
        buildControls();
        renderStats();
        render();
        scrollToDateHash();
      })
      .catch(() => {
        document.getElementById("app").innerHTML =
          '<div class="empty">아직 게시된 뉴스가 없습니다. <code>/daily-news</code> 를 실행해 첫 데이터를 생성하세요.</div>';
      });
    setupBackToTop();
    wireShareDelegation(document.getElementById("app"));
  }

  function allArticles() {
    const out = [];
    state.days.forEach((d) =>
      (d.topics || []).forEach((t) =>
        (t.articles || []).forEach((a) =>
          out.push(Object.assign({ date: d.date, page: d.page, topic_key: t.key, topic_label: t.label }, a))
        )
      )
    );
    return out;
  }

  function months() {
    const seen = {};
    const out = [];
    state.days.forEach((d) => {
      const m = monthOf(d.date);
      if (!seen[m]) { seen[m] = { key: m, days: 0, count: 0 }; out.push(seen[m]); }
      seen[m].days += 1;
      seen[m].count += d.count || 0;
    });
    return out; // manifest가 최신순이므로 그대로 최신월 우선
  }

  function buildControls() {
    const topicMap = {};
    state.days.forEach((d) => (d.topics || []).forEach((t) => (topicMap[t.key] = t.label)));
    const topicChips = document.getElementById("topicChips");
    if (topicChips) {
      const items = [["all", "전체"]].concat(Object.keys(topicMap).map((k) => [k, topicMap[k]]));
      topicChips.innerHTML = items
        .map(([k, lbl]) => `<button class="chip${k === "all" ? " active" : ""}" data-topic="${esc(k)}">${esc(lbl)}</button>`)
        .join("");
      topicChips.querySelectorAll(".chip").forEach((c) =>
        c.addEventListener("click", function () {
          topicChips.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
          c.classList.add("active");
          state.topic = c.getAttribute("data-topic");
          render();
        })
      );
    }
    buildMonthChips();
    buildDateChips();
    const search = document.getElementById("search");
    if (search)
      search.addEventListener("input", function () {
        state.query = this.value.trim().toLowerCase();
        render();
      });
  }

  function buildMonthChips() {
    const el = document.getElementById("monthChips");
    if (!el) return;
    const ms = months();
    el.innerHTML = [`<button class="chip${state.month === "all" ? " active" : ""}" data-month="all">전체</button>`]
      .concat(ms.map((m) =>
        `<button class="chip${m.key === state.month ? " active" : ""}" data-month="${esc(m.key)}">${esc(fmtMonth(m.key))} <span class="chip-sub">${m.days}일</span></button>`))
      .join("");
    el.querySelectorAll(".chip").forEach((c) =>
      c.addEventListener("click", function () {
        state.month = c.getAttribute("data-month");
        state.date = "all"; // 월을 바꾸면 그 월 전체(날짜 아코디언)부터
        if (state.month !== "all") {
          const first = state.days.map((d) => d.date).find((dt) => monthOf(dt) === state.month);
          if (first) state.open[first] = true; // 해당 월 최신 날짜만 펼침
        }
        buildMonthChips();
        buildDateChips();
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
    );
  }

  function buildDateChips() {
    const el = document.getElementById("dateChips");
    if (!el) return;
    const row = el.closest(".filter-group");
    if (state.month === "all") { if (row) row.style.display = "none"; el.innerHTML = ""; return; }
    if (row) row.style.display = "";
    const dates = state.days.map((d) => d.date).filter((dt) => monthOf(dt) === state.month);
    el.innerHTML = [`<button class="chip${state.date === "all" ? " active" : ""}" data-date="all">${esc(fmtMonth(state.month))} 전체</button>`]
      .concat(dates.map((dt) =>
        `<button class="chip${dt === state.date ? " active" : ""}" data-date="${esc(dt)}">${esc(dt.slice(8))}일</button>`))
      .join("");
    el.querySelectorAll(".chip").forEach((c) =>
      c.addEventListener("click", function () {
        el.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
        c.classList.add("active");
        state.date = c.getAttribute("data-date");
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
    );
  }

  function renderStats() {
    const totalDays = state.days.length;
    const totalArticles = state.days.reduce((s, d) => s + (d.count || 0), 0);
    const el = document.getElementById("stats");
    if (!el) return;
    const latest = totalDays ? state.days[0].date : "-";
    el.innerHTML = `
      <div class="stat"><div class="num">${months().length}</div><div class="lbl">아카이브 월수</div></div>
      <div class="stat"><div class="num">${totalDays}</div><div class="lbl">아카이브 일수</div></div>
      <div class="stat"><div class="num">${totalArticles}</div><div class="lbl">누적 기사</div></div>
      <div class="stat"><div class="num">${esc(latest)}</div><div class="lbl">최신 업데이트</div></div>`;
  }

  function matchQuery(a) {
    if (!state.query) return true;
    return [a.title, a.outlet, a.summary_line, a.topic_label].join(" ").toLowerCase().includes(state.query);
  }

  function cardHtml(a) {
    const href = `${a.page}#article-${esc(a.topic_key)}-${esc(a.rank)}`;
    const img = a.page ? String(a.page).replace(/index\.html$/, "") + `img/${esc(a.topic_key)}-${String(a.rank).padStart(2, "0")}.png` : "";
    return `<a class="card t-${esc(a.topic_key)}" href="${href}">
      <div class="body">
        <div class="card-title">${esc(a.title)}</div>
        ${a.summary_line ? `<div class="card-summary">${esc(a.summary_line)}</div>` : ""}
        <div class="card-foot">
          <span class="org">📰 ${esc(a.outlet || "언론사 미상")}</span>
          <button class="card-share" title="공유" aria-label="공유"
            data-title="${esc(a.title)}" data-text="${esc(a.summary_line || a.title)}"
            data-url="${href}" data-img="${img}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.6 6.8-3.9M8.6 13.4l6.8 3.9"/></svg>
          </button>
        </div>
      </div>
    </a>`;
  }

  function wireShareDelegation(container) {
    if (!container) return;
    container.addEventListener("click", function (e) {
      const btn = e.target.closest(".card-share");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const abs = (p) => new URL(p, location.href).href;
      shareArticle({
        title: btn.getAttribute("data-title"),
        text: btn.getAttribute("data-text"),
        url: abs(btn.getAttribute("data-url")),
        imgUrl: btn.getAttribute("data-img") ? abs(btn.getAttribute("data-img")) : "",
        imgName: (btn.getAttribute("data-title") || "infographic").slice(0, 40),
      });
    });
  }

  const topicOk = (k) => state.topic === "all" || k === state.topic;

  function dayInner(d) {
    const topics = (d.topics || []).filter((t) => topicOk(t.key));
    let inner = "";
    let total = 0;
    topics.forEach((t) => {
      const arts = (t.articles || []).map((a) => Object.assign({ page: d.page, topic_key: t.key, topic_label: t.label }, a));
      if (!arts.length) return;
      total += arts.length;
      inner += `<div class="topic-head"><span class="topic-badge t-${esc(t.key)}">${esc(t.label)}</span><span class="count">${arts.length}건</span></div>
        <div class="grid">${arts.map(cardHtml).join("")}</div>`;
    });
    return { inner, total };
  }

  function daySectionHtml(d, collapsible) {
    const { inner, total } = dayInner(d);
    if (!total) return "";
    const open = !collapsible || !!state.open[d.date];
    return `<section class="day-section${collapsible ? " collapsible" : ""}${open ? "" : " collapsed"}" data-date="${esc(d.date)}">
      <div class="day-head" ${collapsible ? 'role="button" tabindex="0"' : ""}>
        ${collapsible ? '<span class="toggle" aria-hidden="true">▾</span>' : ""}
        <h2>${esc(fmtDate(d.date))}</h2>
        <span class="count">${total}건</span>
        <a class="seeall" href="${esc(d.page)}">그날 전체 페이지 →</a>
      </div>
      <div class="day-body">${inner}</div>
    </section>`;
  }

  function monthSectionHtml(mkey, ds) {
    const daysHtml = ds.map((d) => daySectionHtml(d, true)).join("");
    if (!daysHtml) return "";
    const total = ds.reduce((s, d) => s + (d.count || 0), 0);
    const open = !!state.openM[mkey];
    return `<section class="month-section collapsible${open ? "" : " collapsed"}" data-month="${esc(mkey)}">
      <div class="month-head" role="button" tabindex="0">
        <span class="toggle" aria-hidden="true">▾</span>
        <h2>${esc(fmtMonth(mkey))}</h2>
        <span class="count">${ds.length}일 · ${total}건</span>
      </div>
      <div class="month-body">${daysHtml}</div>
    </section>`;
  }

  function render() {
    const app = document.getElementById("app");
    const monthOk = (dt) => state.month === "all" || monthOf(dt) === state.month;
    const dateOk = (dt) => (state.date === "all" || dt === state.date) && monthOk(dt);

    if (state.query) {
      const arr = allArticles().filter((a) => matchQuery(a) && dateOk(a.date) && topicOk(a.topic_key));
      app.innerHTML = arr.length
        ? `<div class="grid">${arr.map(cardHtml).join("")}</div>`
        : '<div class="empty">조건에 맞는 기사가 없습니다.</div>';
      return;
    }

    let html = "";
    if (state.month === "all") {
      // 전체: 월 아코디언 → 그 안에 날짜 아코디언
      const byMonth = {};
      const order = [];
      state.days.forEach((d) => {
        const m = monthOf(d.date);
        if (!byMonth[m]) { byMonth[m] = []; order.push(m); }
        byMonth[m].push(d);
      });
      html = order.map((m) => monthSectionHtml(m, byMonth[m])).join("");
    } else if (state.date === "all") {
      // 특정 월: 날짜 아코디언
      html = state.days.filter((d) => monthOk(d.date)).map((d) => daySectionHtml(d, true)).join("");
    } else {
      // 특정 날짜: 펼친 단일 섹션
      html = state.days.filter((d) => d.date === state.date).map((d) => daySectionHtml(d, false)).join("");
    }
    app.innerHTML = html || '<div class="empty">조건에 맞는 기사가 없습니다.</div>';
    wireToggles(app);
  }

  function wireToggles(app) {
    app.querySelectorAll(".day-section.collapsible > .day-head").forEach((head) => {
      const toggle = (e) => {
        if (e.target.closest(".seeall")) return;
        const sec = head.closest(".day-section");
        const dt = sec.getAttribute("data-date");
        const nowCollapsed = sec.classList.toggle("collapsed");
        state.open[dt] = !nowCollapsed;
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); }
      });
    });
    app.querySelectorAll(".month-section > .month-head").forEach((head) => {
      const toggle = () => {
        const sec = head.closest(".month-section");
        const m = sec.getAttribute("data-month");
        const nowCollapsed = sec.classList.toggle("collapsed");
        state.openM[m] = !nowCollapsed;
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
    });
  }

  function scrollToDateHash() {
    const m = (location.hash || "").match(/^#date-(.+)$/);
    if (!m) return;
    const sec = document.querySelector(`.day-section[data-date="${CSS.escape(m[1])}"]`);
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* =======================================================================
     상세(일자별) 페이지 — 스마트 앵커 점프 + 플로팅 네비 + 공유/오디오/라이트박스
     ======================================================================= */
  function initDetail() {
    smartScrollToHash();
    buildDetailNav();
    setupBackToTop();
    wireDetailShare();
    setupAudioBrief();
    setupLightbox();
  }

  function smartScrollToHash() {
    const id = (location.hash || "").slice(1);
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    let userMoved = false;
    const stop = () => {
      userMoved = true;
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchmove", stop);
      window.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].indexOf(e.key) >= 0) stop();
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    window.addEventListener("keydown", onKey);
    const jump = () => { if (!userMoved) el.scrollIntoView({ block: "start" }); };
    jump();
    const imgs = document.images;
    for (let i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete) {
        imgs[i].addEventListener("load", jump, { once: true });
        imgs[i].addEventListener("error", jump, { once: true });
      }
    }
    window.addEventListener("load", function () {
      jump();
      setTimeout(jump, 80);
      setTimeout(stop, 400);
    });
  }

  function detailDate() {
    const m = location.pathname.match(/days\/([^\/]+)\//);
    return m ? m[1] : null;
  }

  // 각 기사(.paper)의 공유 버튼: DOM에서 제목·이미지·앵커를 추출해 공유
  function wireDetailShare() {
    document.querySelectorAll(".paper").forEach((paper) => {
      const btn = paper.querySelector(".share-btn");
      if (!btn) return;
      btn.addEventListener("click", function () {
        const title = (paper.querySelector("h3") || {}).textContent || document.title;
        const org = (paper.querySelector(".meta .org") || {}).textContent || "";
        const img = paper.querySelector(".paper-figure img");
        const url = location.origin + location.pathname + "#" + paper.id;
        shareArticle({
          title: title.trim(),
          text: [title.trim(), org.trim()].filter(Boolean).join(" · "),
          url,
          imgUrl: img ? img.currentSrc || img.src : "",
          imgName: title.trim().slice(0, 40),
        });
      });
    });
  }

  // days/<date>/audio.(m4a|mp3|wav) 가 존재하면 오디오 브리핑 카드 표시
  function setupAudioBrief() {
    const holder = document.getElementById("audioBrief");
    if (!holder) return;
    const candidates = ["audio.m4a", "audio.mp3", "audio.wav"];
    (async () => {
      for (const name of candidates) {
        try {
          const r = await fetch(name, { method: "HEAD", cache: "no-store" });
          if (r.ok) {
            holder.innerHTML = `
              <div class="audio-brief">
                <div class="ab-icon">🎧</div>
                <div class="ab-body">
                  <div class="ab-title">오디오 브리핑</div>
                  <div class="ab-desc">이 날짜의 기사 전체를 음성으로 정리한 오디오북입니다.</div>
                  <audio controls preload="none" src="${name}"></audio>
                </div>
                <a class="btn ab-down" href="${name}" download="daily-news-${esc(detailDate() || "audio")}.${name.split(".").pop()}">⬇ 저장</a>
              </div>`;
            holder.style.display = "";
            return;
          }
        } catch (e) { /* 다음 후보 */ }
      }
      holder.style.display = "none";
    })();
  }

  // 인포그래픽 클릭 → 라이트박스 확대
  function setupLightbox() {
    const imgs = document.querySelectorAll(".paper-figure img");
    if (!imgs.length) return;
    const box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = `<img alt="" /><span class="lb-close" aria-label="닫기">✕</span>`;
    document.body.appendChild(box);
    const lbImg = box.querySelector("img");
    const closeBox = () => { box.classList.remove("show"); document.body.style.overflow = ""; };
    imgs.forEach((img) => {
      img.style.cursor = "zoom-in";
      img.addEventListener("click", () => {
        lbImg.src = img.currentSrc || img.src;
        box.classList.add("show");
        document.body.style.overflow = "hidden";
      });
    });
    box.addEventListener("click", closeBox);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBox(); });
  }

  function buildDetailNav() {
    const dt = detailDate();
    const wrap = document.createElement("div");
    wrap.className = "fabnav";
    wrap.innerHTML = `
      <button class="fab" data-act="top" title="이 날짜 목록 맨 위로" aria-label="맨 위로">↑</button>
      <a class="fab fab-home" href="../../${dt ? "?d=" + encodeURIComponent(dt) + "#date-" + encodeURIComponent(dt) : ""}" title="전체 아카이브로" aria-label="전체 아카이브">⌂</a>`;
    document.body.appendChild(wrap);
    wrap.querySelector('[data-act="top"]').addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" })
    );
    const onScroll = () => wrap.classList.toggle("show", window.scrollY > 320);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function setupBackToTop() {
    if (document.querySelector(".fabnav")) return;
    const wrap = document.createElement("div");
    wrap.className = "fabnav";
    wrap.innerHTML = `<button class="fab" data-act="top" title="맨 위로" aria-label="맨 위로">↑</button>`;
    document.body.appendChild(wrap);
    wrap.querySelector('[data-act="top"]').addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" })
    );
    const onScroll = () => wrap.classList.toggle("show", window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
})();
