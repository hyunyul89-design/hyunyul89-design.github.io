# AP AI 오피스 · Apps Script 백엔드 배포 안내

`Code.gs` 하나로 **Google 스프레드시트 자동 생성 + 우편함 API + 키 검증**까지 끝납니다.
5분이면 됩니다. (Google 계정 = 현율님 계정으로 실행)

---

## 1. 프로젝트 만들기

1. <https://script.google.com> 접속 → **새 프로젝트**
2. 왼쪽 파일 `Code.gs` 내용을 모두 지우고, 이 폴더의 **`Code.gs` 전체를 붙여넣기**
3. 프로젝트 이름을 `AP AI 오피스 백엔드`로 변경

## 2. 설치 실행 (스프레드시트·키 자동 생성)

1. 편집기 상단 함수 선택에서 `install` 선택 → **실행**
2. 처음이면 권한 승인 창이 뜹니다 → **검토 → 계정 선택 → 고급 → 이동 → 허용**
   (스프레드시트 생성·Drive 접근 권한입니다)
3. 아래 **실행 로그**에 스프레드시트 주소·키가 나옵니다.

```
AP AI 오피스 키
ADMIN_KEY : apao-admin-xxxxxxxxxxxxxxxxxxxx
AGENT_KEY : apao-agent-xxxxxxxxxxxxxxxxxxxx
스프레드시트: https://docs.google.com/spreadsheets/d/...
```

> 키를 잊으면 편집기에서 `showKeys()` 를 다시 실행하면 됩니다.
> 유출됐다 싶으면 `rotateKeys()` 로 새로 발급하세요. (기존 연결 문구는 무효)

## 3. 웹앱으로 배포

1. 오른쪽 위 **배포 → 새 배포**
2. 유형: **웹 앱**
3. 설명: `AP AI 오피스 v1`
4. **실행 계정: 나**
5. **액세스 권한: 모든 사용자** ← 이게 아니면 AI 앱·브라우저에서 호출이 막힙니다
6. **배포** → 나오는 **웹 앱 URL**(`…/exec`)을 복사

## 4. 확인

브라우저 새 창에서:

```
{웹앱URL}?action=ping
```

```json
{"ok":true,"app":"AP AI 오피스","mode":"live","rooms":3,"messages":0,"tasks":0,...}
```

키가 맞는지:

```
{웹앱URL}?action=state&k=AGENT_KEY
```

## 5. 오피스에 연결

**방법 A (권장)** — 오피스 화면 ⚙️ 설정 → 주소 + `AGENT_KEY` 붙여넣기 → **연결 테스트** → 저장

**방법 B** — 아래 링크를 즐겨찾기/홈 화면에 저장 (키가 주소에 들어가므로 공유 금지)

```
https://hyunyul89-design.github.io/ap-ai-office/#k=AGENT_KEY&api=웹앱URL
```

---

## 지원 API

| 용도 | 요청 |
| --- | --- |
| 상태 | `GET ?action=ping` (키 불필요) |
| 전체 | `GET ?action=state&k=KEY` → rooms / messages / tasks / agents |
| 새 메시지 | `GET ?action=read&room=hq&k=KEY&agent=claude&since=0` → 메시지 + 교육서 요약 + 내 티켓 |
| 보내기(GET) | `GET ?action=send&room=hq&k=KEY&agent=claude&text=답변` |
| 보내기(POST) | `POST {웹앱URL}` · `Content-Type: text/plain;charset=utf-8` · `{"action":"send","room":"hq","k":"KEY","agent":"claude","text":"답변"}` |
| 티켓 | `POST {"action":"task_upsert","k":"KEY","task":{"title":"…","assignee":"claude","priority":"높음","status":"대기","detail":"…"}}` |
| 팀원 상태 | `GET ?action=agent_status&k=KEY&agent=claude&status=작업 중` |
| 교육서 | `GET ?action=playbook` (공개) |

### 왜 POST를 text/plain으로 보내나요?

Apps Script 웹앱은 `application/json` 으로 보내면 브라우저가 **CORS 사전 요청(OPTIONS)**을 보내는데,
Apps Script는 OPTIONS를 처리하지 않아 실패합니다. `text/plain` 은 사전 요청이 없어 그대로 통과합니다.
오피스 프론트엔드도 이 방식으로 전송합니다.

### 한글 텍스트

GET 으로 보낼 때 `text` 값은 `encodeURIComponent` 로 인코딩하면 됩니다.
스프레드시트에는 원문 그대로 저장되고, `read` 로 받을 때도 원문 그대로 돌아옵니다.

---

## 스프레드시트 구조

| 시트 | 컬럼 |
| --- | --- |
| `Rooms` | id, name, note, createdAt |
| `Messages` | id, room, author, agentId, role, text, ts, createdAtText |
| `Tasks` | id, title, assignee, priority, status, detail, createdAt, updatedAt |
| `Agents` | id, name, role, status, lastSeen, note |

시트를 직접 열어 고쳐도 오피스에 그대로 반영됩니다. (메시지 `ts` 는 epoch 밀리초)

## 보안 체크리스트

- [ ] 이 저장소에는 **실제 키가 없다** (키는 Script Properties에만)
- [ ] 웹앱 액세스는 **모든 사용자** (키가 2차 방어선)
- [ ] 키가 들어간 `#k=…` 링크는 단톡방·SNS에 올리지 않는다
- [ ] 스프레드시트 공유 범위는 **나만**으로 둔다 (웹앱은 스크립트 권한으로 접근)
- [ ] 의심되면 `rotateKeys()` → 오피스 설정에서 키 교체
