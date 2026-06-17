/* =========================================================================
   Daily News — 테마 토글 + 메인 동적 렌더링(날짜→주제→기사) + 상세 네비
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

  const state = { query: "", date: "all", topic: "all", days: [], open: {} };

  function initIndex() {
    fetch("data/manifest.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((m) => {
        state.days = (m.days || []).slice();
        const params = new URLSearchParams(location.search);
        const want = params.get("d");
        const dates = state.days.map((d) => d.date);
        if (want && dates.indexOf(want) >= 0) state.date = want;
        else if (dates.length) state.date = dates[0]; // 기본: 최신 날짜만
        if (dates.length) state.open[dates[0]] = true; // 전체보기 시 최신만 펼침
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
    const dateChips = document.getElementById("dateChips");
    if (dateChips) {
      const dates = state.days.map((d) => d.date);
      dateChips.innerHTML = ["all", ...dates]
        .map((dt) => `<button class="chip${dt === state.date ? " active" : ""}" data-date="${esc(dt)}">${dt === "all" ? "전체" : esc(dt)}</button>`)
        .join("");
      dateChips.querySelectorAll(".chip").forEach((c) =>
        c.addEventListener("click", function () {
          dateChips.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
          c.classList.add("active");
          state.date = c.getAttribute("data-date");
          render();
          window.scrollTo({ top: 0, behavior: "smooth" });
        })
      );
    }
    const search = document.getElementById("search");
    if (search)
      search.addEventListener("input", function () {
        state.query = this.value.trim().toLowerCase();
        render();
      });
  }

  function renderStats() {
    const totalDays = state.days.length;
    const totalArticles = state.days.reduce((s, d) => s + (d.count || 0), 0);
    const el = document.getElementById("stats");
    if (!el) return;
    const latest = totalDays ? state.days[0].date : "-";
    el.innerHTML = `
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
    return `<a class="card" href="${href}">
      <div class="body">
        <div class="card-title">${esc(a.title)}</div>
        ${a.summary_line ? `<div class="card-summary">${esc(a.summary_line)}</div>` : ""}
        <div class="org">📰 ${esc(a.outlet || "언론사 미상")}</div>
      </div>
    </a>`;
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

  function render() {
    const app = document.getElementById("app");
    const dateOk = (dt) => state.date === "all" || dt === state.date;

    if (state.query) {
      const arr = allArticles().filter((a) => matchQuery(a) && dateOk(a.date) && topicOk(a.topic_key));
      app.innerHTML = arr.length
        ? `<div class="grid">${arr.map(cardHtml).join("")}</div>`
        : '<div class="empty">조건에 맞는 기사가 없습니다.</div>';
      return;
    }

    const collapsible = state.date === "all";
    const html = state.days.filter((d) => dateOk(d.date)).map((d) => daySectionHtml(d, collapsible)).join("");
    app.innerHTML = html || '<div class="empty">조건에 맞는 기사가 없습니다.</div>';
    if (collapsible) wireDayToggles(app);
  }

  function wireDayToggles(app) {
    app.querySelectorAll(".day-section.collapsible .day-head").forEach((head) => {
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
  }

  function scrollToDateHash() {
    const m = (location.hash || "").match(/^#date-(.+)$/);
    if (!m) return;
    const sec = document.querySelector(`.day-section[data-date="${CSS.escape(m[1])}"]`);
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* =======================================================================
     상세(일자별) 페이지 — 스마트 앵커 점프 + 플로팅 네비
     ======================================================================= */
  function initDetail() {
    smartScrollToHash();
    buildDetailNav();
    setupBackToTop();
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
