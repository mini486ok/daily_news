#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
뉴스 사이트 빌드/배포 스크립트.

서브커맨드
  build  <date>   articles.json + 템플릿 → 일자별 페이지 + manifest.json 갱신(추가만)
  deploy [date]   git add/commit/push → GitHub Pages 배포

기사 수집·요약(검색 기반)과 인포그래픽 생성은 /daily-news 커맨드 흐름에서 수행하며,
이 스크립트는 결정론적 작업(렌더/배포)만 담당한다.
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DAYS_DIR = ROOT / "days"
TEMPLATES_DIR = ROOT / "templates"
MANIFEST = DATA_DIR / "manifest.json"


def log(m): print(f"[build_news] {m}", flush=True)


def load_template(name):
    from jinja2 import Environment, FileSystemLoader, select_autoescape
    env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)),
                      autoescape=select_autoescape(["html", "xml"]))
    return env.get_template(name)


def cmd_build(args):
    date = args.date
    day_dir = DAYS_DIR / date
    aj = day_dir / "articles.json"
    if not aj.exists():
        log(f"{aj} 없음. 먼저 기사 수집·요약(articles.json)을 완료하세요."); sys.exit(1)
    data = json.loads(aj.read_text(encoding="utf-8"))

    # 게재일 검증: 기준일과 다른 기사 경고(전날·다음날·미상 기사 혼입 방지)
    off = [(t["key"], a.get("rank"), a.get("published"))
           for t in data.get("topics", []) for a in t.get("articles", [])
           if (a.get("published") or "") != date]
    if off:
        log(f"[주의] 게재일이 {date} 가 아닌(또는 미상) 기사 {len(off)}건: {off[:12]}")

    # 인포그래픽 경로 주입(<key>-<rank>.png)
    for t in data.get("topics", []):
        for a in t.get("articles", []):
            a.setdefault("infographic", {})
            a["infographic"]["image_path"] = f"img/{t['key']}-{a['rank']:02d}.png"
    aj.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # 일자별 페이지
    html = load_template("day.html.j2").render(date=date, topics=data.get("topics", []), data=data)
    (day_dir / "index.html").write_text(html, encoding="utf-8")
    log(f"일자별 페이지 생성 → {day_dir / 'index.html'}")

    # manifest 갱신(추가만)
    manifest = {"site": "Daily News", "days": []}
    if MANIFEST.exists():
        try: manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        except Exception: pass
    manifest.setdefault("days", [])
    manifest["days"] = [d for d in manifest["days"] if d.get("date") != date]

    count = sum(len(t.get("articles", [])) for t in data.get("topics", []))
    entry = {
        "date": date,
        "count": count,
        "page": f"days/{date}/index.html",
        "topics": [
            {
                "key": t["key"],
                "label": t["label"],
                "articles": [
                    {
                        "rank": a["rank"],
                        "title": a.get("title", ""),
                        "outlet": a.get("outlet", ""),
                        "summary_line": a.get("summary_line", ""),
                        "url": a.get("url", ""),
                    }
                    for a in t.get("articles", [])
                ],
            }
            for t in data.get("topics", [])
        ],
    }
    manifest["days"].append(entry)
    manifest["days"].sort(key=lambda d: d["date"], reverse=True)
    manifest["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"manifest.json 갱신 완료 ({len(manifest['days'])}일치, {count}건)")

    # 오디오북(NotebookLM 등) 소스 텍스트: 그날 기사 전체를 한 파일로 묶음.
    # NotebookLM에 이 파일 하나를 소스로 올려 오디오 개요(Audio Overview)를 생성하고,
    # 결과 파일을 days/<date>/daily-news-<date>.m4a 로 저장하면 상세 페이지에 플레이어가 자동 표시된다.
    lines = [f"# {date} Daily News 브리핑",
             "", f"{date}에 국내 언론에 보도된 AI(인공지능)·철도/대중교통 분야 주요 기사 요약입니다.", ""]
    for t in data.get("topics", []):
        lines += [f"## 주제: {t.get('label', t.get('key', ''))}", ""]
        for a in t.get("articles", []):
            s = a.get("summary", {}) or {}
            lines += [f"### {a.get('rank')}. {a.get('title', '')} ({a.get('outlet', '')})", ""]
            # 원문 발췌(수집 시 WebFetch로 확인한 본문 리드 단락) — 오디오의 사실 근거 강화
            if a.get("excerpt"):
                lines += [f"**원문 발췌**: {a['excerpt']}", ""]
            for label, key in (("핵심 내용", "core"), ("시사점", "implication"),
                               ("더 생각해볼 문제", "questions"), ("추진 필요한 연구개발 주제", "rnd")):
                if s.get(key):
                    lines += [f"**{label}**: {s[key]}", ""]
    (day_dir / "audio_source.md").write_text("\n".join(lines), encoding="utf-8")
    log(f"오디오 소스 텍스트 생성 → {day_dir / 'audio_source.md'}")

    # 오디오 개요(Audio Overview) 생성용 표준 프롬프트: 두 분야 2부 구성으로
    # 당일 선정된 모든 기사를 빠짐없이 충분히 소개하도록 지시(주제·건수는 그날 데이터 기준).
    parts = [f"{i+1}부는 {t.get('label','')} 분야(기사 {len(t.get('articles', []))}건)"
             for i, t in enumerate(data.get("topics", []))]
    prompt = (
        "반드시 한국어로만 진행하는 팟캐스트입니다. "
        f"소스는 {date} 하루 동안 국내 언론에 보도된 분야별 주요 뉴스 브리핑입니다. "
        f"방송을 큰 틀에서 {len(parts)}부로 나누세요: {', '.join(parts)}. "
        "각 부에서는 해당 분야에 포함된 모든 기사를 단 한 건도 빠뜨리지 말고 소스에 실린 순서대로 다루되, "
        "기사마다 제목·핵심 내용·시사점을 충분히 소개하세요. "
        "특정 기사 몇 개만 골라 다루는 것은 금지합니다. 가능한 한 길고 상세하게 만들어 주세요. "
        "각 기사의 '원문 발췌' 내용을 사실 근거로 삼아, 소스에 없는 내용은 지어내지 말고 정확한 정보만 전달하세요."
    )
    (day_dir / "audio_prompt.txt").write_text(prompt, encoding="utf-8")
    log(f"오디오 프롬프트 생성 → {day_dir / 'audio_prompt.txt'}")

    # 오디오북 보존 정책: 용량 관리를 위해 최근 10일치만 사이트에 제공(초과분 파일 삭제).
    AUDIO_KEEP_DAYS = 10
    audio_exts = {".m4a", ".mp3", ".wav"}
    audio_days = []
    for d in sorted((p for p in DAYS_DIR.iterdir() if p.is_dir()), key=lambda p: p.name, reverse=True):
        files = [p for p in d.iterdir()
                 if p.suffix.lower() in audio_exts and (p.name.startswith("daily-news-") or p.stem == "audio")]
        if files:
            audio_days.append((d.name, files))
    for dname, files in audio_days[AUDIO_KEEP_DAYS:]:
        for p in files:
            p.unlink()
            log(f"오디오 보존기간(최근 {AUDIO_KEEP_DAYS}일) 초과 삭제 → days/{dname}/{p.name}")


def cmd_date(args):
    """게시·검색 기준 날짜를 출력. 인자가 있으면 그대로, 없으면 어제(오늘 KST-1일)."""
    if args.date:
        print(args.date)
    else:
        kst = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=9)
        print((kst - dt.timedelta(days=1)).strftime("%Y-%m-%d"))


def run(cmd):
    import subprocess
    log("$ " + " ".join(cmd))
    return subprocess.call(cmd, cwd=str(ROOT))


def cmd_deploy(args):
    date = args.date or ""
    run(["git", "add", "-A"])
    run(["git", "commit", "-m", f"news {date}".strip()])
    if run(["git", "push", "origin", "main"]) != 0:
        run(["git", "push", "-u", "origin", "main"])
    log("배포 시도 완료 → https://mini486ok.github.io/daily_news/")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build"); b.add_argument("date"); b.set_defaults(func=cmd_build)
    d = sub.add_parser("deploy"); d.add_argument("date", nargs="?"); d.set_defaults(func=cmd_deploy)
    dp = sub.add_parser("date"); dp.add_argument("date", nargs="?"); dp.set_defaults(func=cmd_date)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
