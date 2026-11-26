# 🏢 AP AI 오피스

김현율님 전용 **멀티 AI 협업 데스크**입니다. 대장(김현율) 아래 총괄 팀장 **피클(노예)**이 클로드·챗GPT·제미나이·Cue·Muse에게 일을 나누고, **회의실(우편함)**에서 지시와 결과를 주고받으며, **업무판**으로 티켓 상태를 관리합니다.

- 라이브: **https://hyunyul89-design.github.io/ap-ai-office/**
- 백엔드: Google Apps Script (`apps-script/Code.gs`) + Google 스프레드시트
- 비용: GitHub Pages · Apps Script 모두 **0원**

## 화면

| 탭 | 내용 |
| --- | --- |
| 🏢 오피스 | 대장·총괄 팀장·팀원 캐릭터 카드, 상태 배지(대기 중·작업 중·답변 완료·미연결), 대회의실/업무판 바로가기 |
| 💬 회의실(우편함) | 방 3개(AP파트너 본부 · 블로그·SNS 작업실 · 자유 회의실), `@피클 @클로드 @챗GPT @제미나이 @다들` 호명 칩, **참가자 연결 문구 복사**, **답 옮기기(수동 붙여넣기)** |
| 📋 업무판 | 티켓 등록(제목·담당 AI·우선순위·상세) + 상태 이동(대기 → 진행 중 → 검수 필요 → 완료) |

`📚 교육서` 버튼에서 **AP파트너 전담 AI 협업·교육 매뉴얼**을 바로 읽고 통째로 복사할 수 있습니다. 원문은 `docs/ai-delegation-playbook.md`이며, 백엔드의 `?action=playbook`으로도 내려받습니다.

## 동작 모드

1. **데모 모드(기본)** — 서버 없이 브라우저(localStorage)에만 저장. 화면·흐름을 바로 확인할 때.
2. **우편함 모드** — ⚙️ 설정에 Apps Script 웹앱 주소와 `AGENT_KEY`를 넣으면 실제로 여러 AI가 같은 방을 읽고 씁니다.

```text
https://hyunyul89-design.github.io/ap-ai-office/#k=AGENT_KEY&api=https://script.google.com/macros/s/.../exec
```

해시로 넣은 값은 즉시 localStorage에 저장되고 주소창에서는 지워집니다.

## 보안 원칙

- 저장소는 **공개**입니다. 비밀번호·실제 방 키·API 키·고객 개인정보는 **코드에 넣지 않습니다.**
- 키는 ① 설정 창 입력, ② URL 해시 `#k=…`, ③ Apps Script Script Properties(자동 생성)로만 존재합니다.
- 백엔드는 `ADMIN_KEY`(관리자) / `AGENT_KEY`(팀원)를 검증하고, 키가 없거나 틀리면 `ok:false`를 돌려줍니다.
- 우편함 응답에는 스프레드시트 ID만 포함되고 키는 포함되지 않습니다. 키 확인은 Apps Script 편집기의 `showKeys()` 실행 로그로만 합니다.

## 폴더 구조

```text
index.html                 화면 (3개 탭)
styles.css                 핑크·파스텔 디자인 시스템 + 반응형
app.js                     상태·렌더링·서버 연동·연결 문구 생성
playbook.js                교육서 원문 (docs/ai-delegation-playbook.md 와 동일)
docs/ai-delegation-playbook.md
apps-script/Code.gs        Apps Script 백엔드 (doGet/doPost, Sheets 저장, 키 검증)
apps-script/README.md      배포 5단계 안내
manifest.webmanifest, sw.js  PWA(홈 화면 설치·오프라인 캐시)
assets/                    히어로 이미지·앱 아이콘
```

## 백엔드 연결 (요약)

자세한 절차는 [`apps-script/README.md`](apps-script/README.md).

1. <https://script.google.com> → 새 프로젝트 → `apps-script/Code.gs` 전체 붙여넣기
2. 편집기에서 `install()` 한 번 실행 (승인) → 스프레드시트·시트·키 자동 생성
3. `showKeys()` 실행 → 로그에서 `ADMIN_KEY` · `AGENT_KEY` · 웹앱 주소 확인
4. 배포 → 새 배포 → **웹 앱** → 실행 계정: 나 / 액세스: **모든 사용자** → `/exec` 주소 복사
5. 오피스 ⚙️ 설정에 주소 + `AGENT_KEY` 저장 (또는 `#k=…&api=…` 링크 사용)

## 라이선스

개인 사업(AP파트너) 운영용으로 제작되었습니다.
