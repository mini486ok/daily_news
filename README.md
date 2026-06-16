# Daily News — 국내 뉴스 요약·인포그래픽 아카이브

국내 언론 기준으로 **AI(인공지능)**·**철도·대중교통** 분야의 주요 기사를 매일 선별·요약하고,
한 장짜리 칠판형 인포그래픽으로 정리해 웹페이지로 아카이빙하는 프로젝트입니다.

🌐 **배포 사이트**: https://mini486ok.github.io/daily_news/

## 동작 방식

원하는 시간에 이 폴더에서 Claude Code를 실행하고 `/daily-news` (또는 `/daily-news 2026-06-17`)를 입력하면,
해당 날짜에 대해 두 주제별로 기사 10건씩을 검색·요약하고 인포그래픽을 만들어 GitHub Pages로 배포합니다.

```
/daily-news [YYYY-MM-DD]
   ├─ ① 날짜 확정
   ├─ ② 기사 수집·요약 : 주제별(AI / 철도·대중교통) 국내 언론 기사 10건씩 검색·요약 → days/<date>/articles.json
   ├─ ③ 인포그래픽     : 기사별 칠판형 인포그래픽(제목·언론사·핵심내용·시사점·더 생각해볼 문제·R&D)
   ├─ ④ build         : 일자별 페이지 + manifest.json 갱신(추가만)
   └─ ⑤ deploy        : git push → GitHub Pages 자동 배포
```

## 구성

- **메인 카드**: 기사 제목 · 핵심 내용 1문장(서술식) · 언론사
- **상세 페이지**: 기사제목 → 칠판 인포그래픽 → 언론사 → 핵심 내용 → 시사점 → 더 생각해볼 문제 → 추진 필요한 연구개발 주제 → 원문 링크
- 라이트/다크 모드, 날짜·주제 필터, 검색, 모바일 대응

## 디렉터리

| 경로 | 설명 |
|---|---|
| `index.html` | 메인 페이지(1회 생성, 이후 불변). `data/manifest.json`을 읽어 동적 렌더 |
| `data/manifest.json` | 누적 메타데이터(매일 append) |
| `days/<YYYY-MM-DD>/` | 날짜별 페이지·이미지·데이터(articles.json) |
| `scripts/build_news.py` | build / deploy |
| `scripts/compose_news.py` | 칠판 인포그래픽 합성(Playwright) |
| `templates/` | HTML 템플릿(Jinja2) |
| `.claude/commands/daily-news.md` | 전용 슬래시 커맨드 |
