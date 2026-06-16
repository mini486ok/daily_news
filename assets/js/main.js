/* =========================================================================
   Daily News — 테마 토글 + 메인 페이지 동적 렌더링(날짜 → 주제 → 기사)
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

  const state = { query: "", date: "all", topic: "all", days: [] };

  function initIndex() {
    fetch("data/manifest.json", { cache: "no-store" })
      .then((r) => r.json())
      .then((m) => {
        state.days = (m.days || []).slice();
        buildControls();
        renderStats();
        render();
      })
      .catch(() => {
        document.getElementById("app").innerHTML =
          '<div class="empty">아직 게시된 뉴스가 없습니다. <code>/daily-news</code> 를 실행해 첫 데이터를 생성하세요.</div>';
      });
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
    // 주제 칩(고정 + 데이터에 존재하는 것)
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
    // 날짜 칩
    const dateChips = document.getElementById("dateChips");
    if (dateChips) {
      const dates = state.days.map((d) => d.date);
      dateChips.innerHTML = ["all", ...dates]
        .map((dt) => `<button class="chip${dt === "all" ? " active" : ""}" data-date="${esc(dt)}">${dt === "all" ? "전체" : esc(dt)}</button>`)
        .join("");
      dateChips.querySelectorAll(".chip").forEach((c) =>
        c.addEventListener("click", function () {
          dateChips.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
          c.classList.add("active");
          state.date = c.getAttribute("data-date");
          render();
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

  function render() {
    const app = document.getElementById("app");
    const dateOk = (dt) => state.date === "all" || dt === state.date;
    const topicOk = (k) => state.topic === "all" || k === state.topic;

    // 검색/주제 단일선택 시 평면 그리드, 그 외 날짜→주제 섹션
    const flat = !!state.query;
    if (flat) {
      const arr = allArticles().filter((a) => matchQuery(a) && dateOk(a.date) && topicOk(a.topic_key));
      app.innerHTML = arr.length
        ? `<div class="grid">${arr.map(cardHtml).join("")}</div>`
        : '<div class="empty">조건에 맞는 기사가 없습니다.</div>';
      return;
    }

    let html = "";
    state.days.filter((d) => dateOk(d.date)).forEach((d) => {
      const topics = (d.topics || []).filter((t) => topicOk(t.key));
      const dayHas = topics.some((t) => (t.articles || []).length);
      if (!dayHas) return;
      html += `<section class="day-section">
        <div class="day-head"><h2>${esc(fmtDate(d.date))}</h2><a class="seeall" href="${esc(d.page)}">그날 전체 페이지 →</a></div>`;
      topics.forEach((t) => {
        const arts = (t.articles || []).map((a) => Object.assign({ page: d.page, topic_key: t.key, topic_label: t.label }, a));
        if (!arts.length) return;
        html += `<div class="topic-head"><span class="topic-badge t-${esc(t.key)}">${esc(t.label)}</span><span class="count">${arts.length}건</span></div>
          <div class="grid">${arts.map(cardHtml).join("")}</div>`;
      });
      html += `</section>`;
    });
    app.innerHTML = html || '<div class="empty">조건에 맞는 기사가 없습니다.</div>';
  }
})();
