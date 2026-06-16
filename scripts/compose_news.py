#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
뉴스 인포그래픽 합성기 (HTML → PNG, Playwright) — 칠판 도식 스타일.

기사의 핵심 내용·시사점·더 생각해볼 문제·추진 필요한 R&D를 "칠판에 도식화한" 느낌의
한 장짜리 한글 인포그래픽 이미지로 렌더링한다. 통일 템플릿(templates/infographic.html.j2) 사용.

사용:
  python compose_news.py --articles days/DATE/articles.json --all
"""
import argparse
import json
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "templates"


def spec_from_article(a: dict, topic_label: str, date: str) -> dict:
    s = a.get("summary", {})
    return {
        "date": date,
        "rank": a.get("rank"),
        "topic_label": topic_label,
        "title": a.get("title", ""),
        "outlet": a.get("outlet", ""),
        "core": s.get("core", ""),
        "implication": s.get("implication", ""),
        "questions": s.get("questions", ""),
        "rnd": s.get("rnd", ""),
    }


def make_env():
    return Environment(loader=FileSystemLoader(str(TEMPLATES)),
                       autoescape=select_autoescape(["html", "xml"]))


def render_one(page, env, spec, out):
    html = env.get_template("infographic.html.j2").render(**spec)
    page.set_content(html, wait_until="networkidle")
    page.wait_for_timeout(300)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    page.locator(".board").screenshot(path=out)
    print(f"[compose] {out}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--articles", required=True)
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    data = json.loads(Path(args.articles).read_text(encoding="utf-8"))
    date = data.get("date", "")
    img_dir = Path(args.articles).resolve().parent / "img"

    env = make_env()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1160, "height": 1200}, device_scale_factor=2)
        for t in data.get("topics", []):
            for a in t.get("articles", []):
                out = img_dir / f"{t['key']}-{a['rank']:02d}.png"
                render_one(page, env, spec_from_article(a, t.get("label", ""), date), str(out))
        browser.close()


if __name__ == "__main__":
    main()
