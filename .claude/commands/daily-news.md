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
각 주제 에이전트에게: "**오직 DATE 당일(YYYY-MM-DD)에 국내 언론사가 보도(게재)한** '<주제>' 관련 기사 중 중요한 **10건**을 찾아라.
한국어로 검색하고(예: '<주제> YYYY년 M월 D일', '<주제> 뉴스 YYYY.MM.DD'), **각 후보 기사는 반드시 WebFetch로 본문을 열어 게재일(보도일)이 DATE와 정확히 일치하는지 확인**하라.
게재일이 DATE가 아닌 기사(전날·다음날·날짜 미상 포함)는 **반드시 제외**하고, 포함하는 모든 기사의 게재일은 DATE와 같아야 한다.
DATE 당일 중요 기사가 10건 미만이면 억지로 채우지 말고 **확인된 것만** 포함하고 개수를 보고하라.
각 기사에 대해 아래 JSON 요소를 채워 한 파일에 배열로 저장하라." 라고 지시합니다.
- 각 기사 필드(한글):
  - `title`: 기사 제목, `outlet`: 언론사, `url`: 기사 URL, `published`: **게재일(반드시 DATE와 동일, YYYY-MM-DD) — WebFetch로 확인한 값**
  - `excerpt`: **원문 발췌** — WebFetch로 게재일을 확인할 때 그 본문에서 **도입부(리드) 2~3문단을 원문 그대로 인용**(300~700자 내외). 요약·의역 금지, 광고·기자 서명·저작권 문구 제외. (오디오북 생성 시 사실 근거로 사용되므로 반드시 채울 것)
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
   {"key": "ai", "label": "AI(인공지능)", "articles": [ {rank,title,outlet,url,published,excerpt,summary_line,summary{core,implication,questions,rnd}}, ... 10개 ]},
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

### 6단계 · 오디오북 생성 (NotebookLM, 스크립트 전용)
5단계 build가 만든 `days/DATE/audio_source.md`(기사 전체+원문 발췌)와 `days/DATE/audio_prompt.txt`(2부 구성 지시)로 그날의 한국어 오디오북을 생성합니다.

**반드시 아래 스크립트만 사용하고, `mcp__notebooklm-mcp__*` MCP 도구는 절대 호출하지 마세요** (MCP 서버의 브라우저가 Chrome 프로필을 잠가 스크립트와 충돌합니다).

```
node scripts/nblm_create_notebook.js "Daily News DATE"        # ① 노트북 생성 → 마지막 줄 JSON의 url 사용
node scripts/nblm_add_source.js <url> days/DATE/audio_source.md   # ② 소스 추가(sourcesAfter≥1 확인)
node scripts/nblm_generate_audio.js <url> days/DATE/audio_prompt.txt  # ③ 생성 트리거(started 확인)
node scripts/nblm_download_audio.js <url> "<저장소절대경로>/days/DATE/daily-news-DATE.m4a" 30  # ④ 완성 대기(최대 30분)+저장
```
- **중요: ③ 직후 반드시 ④를 곧바로, 반드시 포그라운드로 실행하세요.** ④(nblm_download_audio.js)는 오디오가 완성될 때까지 **스스로 폴링하며 블로킹 대기**(보통 8~15분, 최대 30분)한 뒤 파일을 저장하고 끝납니다. **Bash timeout=2100000(35분)으로, `run_in_background`는 절대 사용 금지** — 백그라운드로 띄우고 "완료 알림을 받으면 이어서 하겠다"고 응답을 끝내면, 헤드리스(`claude -p`) 실행은 응답 종료와 동시에 프로세스가 죽어 백그라운드 작업·알림이 모두 증발하고 그날 오디오·배포가 통째로 누락됩니다(2026-07-02 조기 종료, 2026-07-03·07-04 백그라운드 대기로 이틀 연속 실제 발생). ④의 결과 JSON을 이 응답 안에서 확인한 뒤에만 7단계로 넘어가세요.
- 각 스크립트는 **마지막 줄에 JSON**(`{"ok":true,...}`)을 출력합니다. `ok:false`면 그 스크립트만 1회 재시도하고, 그래도 실패하면 **오디오 단계를 포기하고 7단계로 진행**합니다(사이트는 오디오 없이도 정상 게시되며, 페이지에 파일이 있을 때만 플레이어가 표시됨). 실패 사실과 오류 메시지는 최종 보고에 포함하세요.
- 성공 시 `days/DATE/daily-news-DATE.m4a` 파일 존재(수십 MB)를 확인합니다. 오디오 보존은 최근 10일치만(빌드가 자동 정리).
- **어떤 경우에도 7단계(배포)는 반드시 실행하고 응답을 마쳐야 합니다.**

### 7단계 · 배포 (스크립트)
```
python scripts/build_news.py deploy DATE
```
- 오디오 파일(m4a)도 함께 커밋·푸시됩니다.
- 완료 후 처리 건수·오디오 생성 성공 여부·배포 URL(`https://mini486ok.github.io/daily_news/`)을 보고합니다(반영까지 약 1분).

---

**유의사항**
- 메인 카드에는 **기사 제목 · 핵심 내용 1문장(서술식) · 언론사** 만 표시됩니다.
- 상세 페이지는 **기사제목 → 칠판 인포그래픽 → 언론사 → 핵심 내용 → 시사점 → 더 생각해볼 문제 → 추진 필요한 연구개발 주제 → 원문 링크** 순서입니다.
- `index.html`·`assets/`·`templates/` 는 최초 1회 생성 자산이므로 수정하지 않습니다(매일 `data/manifest.json` 추가 + `days/DATE/` 신규 생성만).
- 신뢰할 수 있는 국내 언론(연합뉴스·주요 일간지·방송·전문지 등) 기사를 우선하고, 원문 URL을 반드시 보존합니다.
