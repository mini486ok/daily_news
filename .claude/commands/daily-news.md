---
description: 국내 언론 기준 AI·철도/대중교통 주요 뉴스를 한글 요약·칠판 인포그래픽으로 만들어 GitHub Pages에 배포
argument-hint: "[YYYY-MM-DD] (생략 시 어제 날짜)"
---

당신은 이 저장소(Daily News)의 **일일 뉴스 브리핑 파이프라인**을 실행합니다. 모든 명령은 저장소 루트에서 수행하세요.
선택 인자(특정 날짜): `$ARGUMENTS` — 비어 있으면 **어제(KST 기준, 오늘−1일)** 를 사용합니다. (주로 당일 아침에 실행하는데 당일 기사가 적으므로, **하루 전 날짜**의 뉴스를 검색·정리해 그 날짜로 게시합니다.)

두 가지 주제를 각각 다룹니다: **① AI(인공지능)**, **② 철도·대중교통**. 각 주제별로 그날(또는 지정일)
국내 언론에 보도된 기사 중 **중요하다고 판단되는 10건**을 선별·요약합니다.

아래 순서를 그대로 따르세요.

### 1단계 · 날짜 확정
- 실행: `python scripts/build_news.py date $ARGUMENTS` 의 출력을 `DATE` 로 사용합니다.
  - 인자가 있으면 그 날짜를, **없으면 어제(오늘 KST − 1일)** 를 반환합니다.
- 검색 질의도, 게시 날짜도 모두 이 `DATE`(기본=어제) 기준입니다.
- `days/DATE/` 가 이미 완성돼 있으면(재실행) 덮어쓸지 사용자에게 먼저 확인합니다.

### 2단계 · 기사 수집·요약 (Claude, 주제별)
주제별로 **병렬 서브에이전트(general-purpose)** 를 1개씩 띄워 진행하면 효율적입니다(각 에이전트는 WebSearch·WebFetch 사용 가능).
각 주제 에이전트에게: "DATE에 **국내 언론사**가 보도한 '<주제>' 관련 기사 중 중요한 **10건**을 찾아라.
한국어로 검색(예: 'AI 2026년 6월 17일', '철도 대중교통 뉴스 <날짜>')하고, 가능하면 기사 본문을 WebFetch로 확인하라.
각 기사에 대해 아래 JSON 요소를 채워 한 파일에 배열로 저장하라." 라고 지시합니다.
- 각 기사 필드(한글):
  - `title`: 기사 제목, `outlet`: 언론사, `url`: 기사 URL, `published`: 보도일(가능하면)
  - `summary_line`: **핵심 내용 1문장(서술식, '~했다/~이다' 등으로 끝나는 완전한 문장)** — 메인 카드에 표시
  - `summary.core`: 핵심 내용 2~4문장
  - `summary.implication`: 시사점 2~3문장
  - `summary.questions`: 더 생각해볼 문제 1~2문장(질문형 가능)
  - `summary.rnd`: 추진 필요한 연구개발 주제 1~2문장
- 각 주제 에이전트가 `C:\tmp\news_<DATE>_<topickey>.json`(topickey: `ai`, `transit`)에 **기사 배열 JSON만** 저장하게 합니다.
- 수집 후, 두 주제 결과를 합쳐 `days/DATE/articles.json` 을 **Write** 로 생성합니다. 구조:
```json
{
 "date": "DATE",
 "topics": [
   {"key": "ai", "label": "AI(인공지능)", "articles": [ {rank,title,outlet,url,summary_line,summary{core,implication,questions,rnd}}, ... 10개 ]},
   {"key": "transit", "label": "철도·대중교통", "articles": [ ... 10개 ]}
 ]
}
```
- 각 기사에 `rank`(주제 내 1~10, 중요도/대표성 순)를 부여합니다.

### 3단계 · 칠판 인포그래픽 합성 (스크립트, 한 번에)
```
python scripts/compose_news.py --articles days/DATE/articles.json --all
```
- 기사별로 `days/DATE/img/<topickey>-NN.png` 를 생성합니다(영문이 아닌 한글 제목·언론사·핵심내용·시사점·더 생각해볼 문제·R&D를 칠판 도식으로).

### 4단계 · 품질 검증(QA)
- 인포그래픽 2~3장을 Read 도구로 열어 한글 텍스트가 또렷한지, 레이아웃이 깨지지 않았는지 확인합니다.

### 5단계 · 페이지 생성 (스크립트)
```
python scripts/build_news.py build DATE
```
- `days/DATE/index.html` 생성 + `data/manifest.json` 에 해당 날짜 **추가**(메인 `index.html` 은 수정하지 않음).

### 6단계 · 배포 (스크립트)
```
python scripts/build_news.py deploy DATE
```
- 완료 후 처리 건수·배포 URL(`https://mini486ok.github.io/daily_news/`)을 보고합니다(반영까지 약 1분).

---

**유의사항**
- 메인 카드에는 **기사 제목 · 핵심 내용 1문장(서술식) · 언론사** 만 표시됩니다.
- 상세 페이지는 **기사제목 → 칠판 인포그래픽 → 언론사 → 핵심 내용 → 시사점 → 더 생각해볼 문제 → 추진 필요한 연구개발 주제 → 원문 링크** 순서입니다.
- `index.html`·`assets/`·`templates/` 는 최초 1회 생성 자산이므로 수정하지 않습니다(매일 `data/manifest.json` 추가 + `days/DATE/` 신규 생성만).
- 신뢰할 수 있는 국내 언론(연합뉴스·주요 일간지·방송·전문지 등) 기사를 우선하고, 원문 URL을 반드시 보존합니다.
