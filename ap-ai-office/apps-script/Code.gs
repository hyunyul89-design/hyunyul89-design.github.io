/**
 * =============================================================================
 *  AP AI 오피스 · Google Apps Script 백엔드 (Code.gs)
 *  대상 저장소: https://github.com/hyunyul89-design/ap-ai-office
 *  프론트엔드:  https://hyunyul89-design.github.io/ap-ai-office/
 * -----------------------------------------------------------------------------
 *  하는 일
 *   · Google 스프레드시트를 자동 생성해 Rooms / Messages / Tasks / Agents 시트에 저장
 *   · 클로드 · 챗GPT · 제미나이 같은 AI 앱이 "우편함"처럼 읽고 쓰는 REST 엔드포인트 제공
 *   · GET 한 줄로도 읽기/쓰기가 되게 만들어서, 브라우저·검색 없이도 연결 가능
 *
 *  지원 action
 *   GET  ?action=ping                                  서버/시트 상태 확인 (키 불필요)
 *   GET  ?action=setup&k=ADMIN_KEY                     시트·키 최초 생성(수동)
 *   GET  ?action=keys&k=ADMIN_KEY                      생성된 키 확인 (관리자만)
 *   GET  ?action=state&k=KEY                           전체 스냅샷(방·메시지·티켓·팀원)
 *   GET  ?action=read&room=hq&k=KEY&agent=claude&since=0   새 메시지 + 교육서 요약
 *   GET  ?action=send&room=hq&k=KEY&agent=claude&text=...  메시지 보내기(한글 URL 인코딩 안전)
 *   GET  ?action=task_upsert&k=KEY&task={"title":...}      티켓 생성/수정
 *   GET  ?action=agent_status&k=KEY&agent=claude&status=작업 중
 *   GET  ?action=playbook                              교육서 원문(공개, 키 불필요)
 *   POST (Content-Type: text/plain)  {"action":"send", ...}  위 action 전부 동일하게 지원
 *
 *  보안
 *   · ADMIN_KEY / AGENT_KEY 는 Script Properties 에 자동 생성되어 저장됩니다.
 *   · 코드에는 어떤 키도 들어 있지 않습니다. (공개 저장소 안전)
 *   · 키 값은 Apps Script 편집기에서 showKeys() 를 실행하면 로그로 확인할 수 있습니다.
 *
 *  배포 방법은 같은 폴더의 README.md 참고.
 * =============================================================================
 */

var PROP_SS = 'APAO_SPREADSHEET_ID';
var PROP_ADMIN_KEY = 'APAO_ADMIN_KEY';
var PROP_AGENT_KEY = 'APAO_AGENT_KEY';
var APP_VERSION = '1.0';
var MAX_TEXT = 4000;
var MAX_MESSAGES_PER_ROOM_READ = 30;

var DEFAULT_ROOMS = [
  { id: 'hq',   name: 'AP파트너 본부' },
  { id: 'blog', name: '블로그·SNS 작업실' },
  { id: 'free', name: '자유 회의실' }
];

var AGENT_INFO = {
  pickle:  { name: '노예 · 피클', role: '총괄 팀장' },
  claude:  { name: '클로드',      role: '원고·분석' },
  chatgpt: { name: '챗GPT',       role: '카피·아이디어' },
  gemini:  { name: '제미나이',    role: '리서치·검증' },
  cue:     { name: 'Cue',         role: '시장조사' },
  muse:    { name: 'Muse',        role: '해외 리서치' }
};

var STATUS_LIST = ['대기 중', '작업 중', '답변 완료', '미연결'];
var TASK_STATUS = ['대기', '진행 중', '검수 필요', '완료'];

/* =============================================================================
 *  1. 웹 요청 진입점
 * ==========================================================================*/

function doGet(e) {
  var p = (e && e.parameter) || {};
  return route_(p, p.callback || '', 'GET');
}

function doPost(e) {
  var body = {};
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw) body = JSON.parse(raw);
  } catch (err) {
    body = {};
  }
  // JSON 이 아니면 폼 파라미터로도 받아 줍니다.
  var p = {};
  var src = (e && e.parameter) || {};
  for (var k in src) p[k] = src[k];
  for (var k2 in body) p[k2] = body[k2];
  return route_(p, '', 'POST');
}

function route_(p, callback, method) {
  var action = String(p.action || 'ping').toLowerCase();
  try {
    var out;
    switch (action) {
      case 'ping':
        out = handlePing_();
        break;
      case 'setup':
        out = handleSetup_(p);
        break;
      case 'keys':
        requireAdmin_(p.k);
        out = handleKeys_();
        break;
      case 'state':
        requireKey_(p.k);
        out = handleState_();
        break;
      case 'read':
        requireKey_(p.k);
        out = handleRead_(p);
        break;
      case 'send':
        requireKey_(p.k);
        out = handleSend_(p);
        break;
      case 'task_upsert':
        requireKey_(p.k);
        out = handleTaskUpsert_(p);
        break;
      case 'agent_status':
        requireKey_(p.k);
        out = handleAgentStatus_(p);
        break;
      case 'playbook':
        out = { ok: true, playbook: getPlaybook_(), version: APP_VERSION };
        break;
      default:
        throw new Error('알 수 없는 action 입니다: ' + action);
    }
    out.ok = (out.ok === undefined) ? true : out.ok;
    out.action = action;
    out.method = method;
    out.serverTime = Date.now();
    return json_(out, callback);
  } catch (err) {
    return json_({
      ok: false,
      action: action,
      method: method,
      error: String((err && err.message) || err),
      serverTime: Date.now()
    }, callback);
  }
}

/* =============================================================================
 *  2. 핸들러
 * ==========================================================================*/

function handlePing_() {
  var ctx = ensureSetup_();
  var rooms = readRooms_(ctx.ss);
  return {
    ok: true,
    app: 'AP AI 오피스',
    version: APP_VERSION,
    mode: 'live',
    rooms: rooms.length,
    messages: countRows_(ctx.ss, 'Messages'),
    tasks: countRows_(ctx.ss, 'Tasks'),
    timezone: Session.getScriptTimeZone(),
    note: '키는 편집기에서 showKeys() 실행 후 로그에서 확인하세요.'
  };
}

function handleSetup_(p) {
  var ctx = ensureSetup_();
  var adminKey = ctx.props.getProperty(PROP_ADMIN_KEY);
  var out = {
    ok: true,
    setup: true,
    initialized: true,
    spreadsheetId: ctx.ss.getId(),
    rooms: readRooms_(ctx.ss).length
  };
  if (String(p.k || '') === adminKey) {
    out.adminKey = adminKey;
    out.agentKey = ctx.props.getProperty(PROP_AGENT_KEY);
    out.warning = '이 응답에는 키가 들어 있습니다. 관리자만 보고, 공개 저장소나 단톡방에 올리지 마세요.';
  } else {
    out.note = '설치가 완료되어 있습니다. 키는 Apps Script 편집기에서 showKeys() 를 실행한 뒤 로그에서 확인하세요.';
  }
  return out;
}

function handleKeys_() {
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    adminKey: props.getProperty(PROP_ADMIN_KEY),
    agentKey: props.getProperty(PROP_AGENT_KEY),
    spreadsheetId: props.getProperty(PROP_SS)
  };
}

function handleState_() {
  var ctx = ensureSetup_();
  var rooms = readRooms_(ctx.ss);
  var messages = readMessages_(ctx.ss);
  var tasks = readTasks_(ctx.ss);
  var agents = readAgents_(ctx.ss);

  var byRoom = {};
  rooms.forEach(function (r) { byRoom[r.id] = []; });
  messages.forEach(function (m) {
    if (!byRoom[m.room]) byRoom[m.room] = [];
    byRoom[m.room].push(m);
  });
  Object.keys(byRoom).forEach(function (rid) {
    byRoom[rid] = byRoom[rid].slice(-60); // 방마다 최근 60건
  });

  return {
    ok: true,
    rooms: rooms,
    messages: byRoom,
    tasks: tasks,
    agents: agents,
    serverTime: Date.now()
  };
}

/**
 * AI 앱이 "새 메시지 확인" 할 때 쓰는 엔드포인트.
 *   ?action=read&room=hq&k=KEY&agent=claude&since=1700000000000
 * since 를 주면 그 이후 메시지만, 없으면 최근 30건을 돌려줍니다.
 */
function handleRead_(p) {
  var ctx = ensureSetup_();
  var roomId = String(p.room || 'hq');
  var room = findRoom_(ctx.ss, roomId);
  if (!room) throw new Error('없는 방입니다: ' + roomId + ' (state 로 방 목록을 확인하세요)');

  var since = Number(p.since || 0) || 0;
  var agentId = String(p.agent || '');
  var all = readMessages_(ctx.ss).filter(function (m) { return m.room === roomId; });

  var picked;
  if (since > 0) {
    picked = all.filter(function (m) { return Number(m.ts) > since; });
  } else {
    picked = all.slice(-MAX_MESSAGES_PER_ROOM_READ);
  }

  var nextSince = picked.length ? Math.max.apply(null, picked.map(function (m) { return Number(m.ts); })) : since;

  var myTasks = readTasks_(ctx.ss).filter(function (t) {
    if (!agentId) return t.status !== '완료';
    return t.assignee === agentId && t.status !== '완료';
  });

  var mentioned = picked.filter(function (m) {
    if (!agentId) return false;
    var name = (AGENT_INFO[agentId] && AGENT_INFO[agentId].name) || agentId;
    return String(m.text || '').indexOf('@' + name) >= 0 || String(m.text || '').indexOf('@다들') >= 0;
  }).length;

  var url = ScriptApp.getService().getUrl();
  return {
    ok: true,
    room: room,
    rooms: readRooms_(ctx.ss),
    messages: picked,
    mentioned: mentioned,
    nextSince: nextSince,
    myTasks: myTasks,
    playbookSummary: getPlaybookSummary_(),
    playbookUrl: url + '?action=playbook',
    hint: '답장: GET ' + url + '?action=send&room=' + roomId + '&k=키&agent=' + (agentId || 'claude') +
          '&text=답변  /  POST 는 {"action":"send","room":"' + roomId + '","k":"키","text":"답변"}',
    serverTime: Date.now()
  };
}

/**
 * 메시지 저장. GET/POST 둘 다 지원하며 한글은 URL 인코딩된 그대로 안전하게 저장됩니다.
 */
function handleSend_(p) {
  var ctx = ensureSetup_();
  var roomId = String(p.room || 'hq');
  if (!findRoom_(ctx.ss, roomId)) throw new Error('없는 방입니다: ' + roomId);

  var text = String(p.text == null ? '' : p.text).trim();
  if (!text) throw new Error('text 가 비어 있습니다.');
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

  var agentId = String(p.agent || '').trim();
  var role = String(p.role || (agentId && agentId !== 'hyunyul' ? 'ai' : 'me'));
  var author = String(p.author || '').trim();
  if (!author) {
    author = (agentId && AGENT_INFO[agentId] && AGENT_INFO[agentId].name) ||
             (agentId === 'hyunyul' ? '김현율' : '') || '외부 AI';
  }

  var now = Date.now();
  var msg = {
    id: 'm-' + Utilities.getUuid().slice(0, 8),
    room: roomId,
    author: author,
    agentId: agentId,
    role: role,
    text: text,
    ts: now
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    appendRow_(ctx.ss, 'Messages', [
      msg.id, msg.room, msg.author, msg.agentId, msg.role, msg.text, msg.ts,
      Utilities.formatDate(new Date(now), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
    ]);
    if (agentId && AGENT_INFO[agentId]) touchAgent_(ctx.ss, agentId, '답변 완료', now);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, message: msg, room: roomId };
}

function handleTaskUpsert_(p) {
  var ctx = ensureSetup_();
  var task = p.task;
  if (typeof task === 'string') {
    try { task = JSON.parse(task); } catch (e) { task = null; }
  }
  if (!task || !task.title) throw new Error('task.title 이 필요합니다.');

  var now = Date.now();
  var id = String(task.id || ('t-' + Utilities.getUuid().slice(0, 8)));
  var row = {
    id: id,
    title: String(task.title).slice(0, 300),
    assignee: String(task.assignee || 'pickle'),
    priority: String(task.priority || '보통'),
    status: String(task.status || '대기'),
    detail: String(task.detail || '').slice(0, 2000),
    createdAt: Number(task.createdAt || now),
    updatedAt: now
  };
  if (TASK_STATUS.indexOf(row.status) < 0) row.status = '대기';

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    upsertRow_(ctx.ss, 'Tasks', 'id', id, [
      row.id, row.title, row.assignee, row.priority, row.status, row.detail, row.createdAt, row.updatedAt
    ]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, task: row };
}

function handleAgentStatus_(p) {
  var ctx = ensureSetup_();
  var agentId = String(p.agent || '');
  if (!agentId) throw new Error('agent 가 필요합니다.');
  var status = String(p.status || '대기 중');
  if (STATUS_LIST.indexOf(status) < 0) status = '대기 중';

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    touchAgent_(ctx.ss, agentId, status, Date.now());
  } finally {
    lock.releaseLock();
  }
  return { ok: true, agent: agentId, status: status };
}

/* =============================================================================
 *  3. 스프레드시트 · 시트 관리
 * ==========================================================================*/

function ensureSetup_() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty(PROP_SS);
  var ss = null;
  var created = false;

  if (ssId) {
    try { ss = SpreadsheetApp.openById(ssId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('AP AI 오피스 데이터 (' +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') + ')');
    props.setProperty(PROP_SS, ss.getId());
    created = true;
  }

  if (!props.getProperty(PROP_ADMIN_KEY)) props.setProperty(PROP_ADMIN_KEY, 'apao-admin-' + randomKey_());
  if (!props.getProperty(PROP_AGENT_KEY)) props.setProperty(PROP_AGENT_KEY, 'apao-agent-' + randomKey_());

  ensureSheet_(ss, 'Rooms', ['id', 'name', 'note', 'createdAt']);
  ensureSheet_(ss, 'Messages', ['id', 'room', 'author', 'agentId', 'role', 'text', 'ts', 'createdAtText']);
  ensureSheet_(ss, 'Tasks', ['id', 'title', 'assignee', 'priority', 'status', 'detail', 'createdAt', 'updatedAt']);
  ensureSheet_(ss, 'Agents', ['id', 'name', 'role', 'status', 'lastSeen', 'note']);

  if (created) {
    seedRooms_(ss);
    seedAgents_(ss);
  }

  return { ss: ss, props: props };
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#ffe3ef');
    return sh;
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function seedRooms_(ss) {
  var sh = ss.getSheetByName('Rooms');
  var existing = readRooms_(ss);
  if (existing.length) return;
  var now = new Date();
  DEFAULT_ROOMS.forEach(function (r) {
    sh.appendRow([r.id, r.name, '', now]);
  });
}

function seedAgents_(ss) {
  var sh = ss.getSheetByName('Agents');
  var existing = readAgents_(ss);
  if (existing.length) return;
  Object.keys(AGENT_INFO).forEach(function (id) {
    sh.appendRow([id, AGENT_INFO[id].name, AGENT_INFO[id].role, '대기 중', '', '']);
  });
}

function readRooms_(ss) {
  return readTable_(ss, 'Rooms').map(function (r) {
    return { id: String(r.id), name: String(r.name || r.id), note: String(r.note || '') };
  });
}

function findRoom_(ss, id) {
  var rooms = readRooms_(ss);
  for (var i = 0; i < rooms.length; i++) if (rooms[i].id === id) return rooms[i];
  return null;
}

function readMessages_(ss) {
  return readTable_(ss, 'Messages').map(function (r) {
    return {
      id: String(r.id),
      room: String(r.room),
      author: String(r.author || ''),
      agentId: String(r.agentId || ''),
      role: String(r.role || 'ai'),
      text: String(r.text || ''),
      ts: Number(r.ts) || 0
    };
  }).filter(function (m) { return m.id && m.room; })
    .sort(function (a, b) { return a.ts - b.ts; });
}

function readTasks_(ss) {
  return readTable_(ss, 'Tasks').map(function (r) {
    return {
      id: String(r.id),
      title: String(r.title || ''),
      assignee: String(r.assignee || ''),
      priority: String(r.priority || '보통'),
      status: TASK_STATUS.indexOf(String(r.status)) >= 0 ? String(r.status) : '대기',
      detail: String(r.detail || ''),
      createdAt: Number(r.createdAt) || 0,
      updatedAt: Number(r.updatedAt) || 0
    };
  }).filter(function (t) { return t.id; });
}

function readAgents_(ss) {
  return readTable_(ss, 'Agents').map(function (r) {
    return {
      id: String(r.id),
      name: String(r.name || r.id),
      role: String(r.role || ''),
      status: String(r.status || '대기 중'),
      lastSeen: Number(r.lastSeen) || 0,
      note: String(r.note || '')
    };
  }).filter(function (a) { return a.id; });
}

function readTable_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row || row.join('') === '') continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[String(headers[c])] = row[c];
    rows.push(obj);
  }
  return rows;
}

function appendRow_(ss, name, values) {
  var sh = ss.getSheetByName(name);
  sh.appendRow(values);
}

function upsertRow_(ss, name, keyCol, keyValue, values) {
  var sh = ss.getSheetByName(name);
  var valuesAll = sh.getDataRange().getValues();
  var headers = valuesAll[0];
  var keyIndex = headers.indexOf(keyCol);
  for (var i = 1; i < valuesAll.length; i++) {
    if (String(valuesAll[i][keyIndex]) === String(keyValue)) {
      sh.getRange(i + 1, 1, 1, values.length).setValues([values]);
      return i + 1;
    }
  }
  sh.appendRow(values);
  return valuesAll.length + 1;
}

function touchAgent_(ss, agentId, status, ts) {
  var sh = ss.getSheetByName('Agents');
  var valuesAll = sh.getDataRange().getValues();
  var headers = valuesAll[0];
  var idIdx = headers.indexOf('id');
  var stIdx = headers.indexOf('status');
  var seenIdx = headers.indexOf('lastSeen');
  for (var i = 1; i < valuesAll.length; i++) {
    if (String(valuesAll[i][idIdx]) === agentId) {
      sh.getRange(i + 1, stIdx + 1).setValue(status);
      sh.getRange(i + 1, seenIdx + 1).setValue(ts);
      return;
    }
  }
  var info = AGENT_INFO[agentId] || { name: agentId, role: '' };
  sh.appendRow([agentId, info.name, info.role, status, ts, '']);
}

function countRows_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return 0;
  return Math.max(0, sh.getLastRow() - 1);
}

/* =============================================================================
 *  4. 키 · 보안
 * ==========================================================================*/

function requireKey_(k) {
  var props = PropertiesService.getScriptProperties();
  ensureSetup_();
  var agentKey = props.getProperty(PROP_AGENT_KEY);
  var adminKey = props.getProperty(PROP_ADMIN_KEY);
  var given = String(k || '');
  if (!given) throw new Error('키가 없습니다. 요청에 k=AGENT_KEY 를 넣어 주세요.');
  if (given === agentKey) return 'agent';
  if (given === adminKey) return 'admin';
  throw new Error('키가 올바르지 않습니다. (AGENT_KEY 확인 필요)');
}

function requireAdmin_(k) {
  var props = PropertiesService.getScriptProperties();
  ensureSetup_();
  var adminKey = props.getProperty(PROP_ADMIN_KEY);
  if (String(k || '') !== adminKey) throw new Error('관리자 키가 필요합니다.');
  return 'admin';
}

function randomKey_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 20);
}

/** 편집기에서 직접 실행: 생성된 키를 로그로 보여 줍니다. */
function showKeys() {
  var ctx = ensureSetup_();
  var props = ctx.props;
  var adminKey = props.getProperty(PROP_ADMIN_KEY);
  var agentKey = props.getProperty(PROP_AGENT_KEY);
  var url = ScriptApp.getService().getUrl();
  Logger.log('──────────────────────────────────────────────');
  Logger.log('AP AI 오피스 키');
  Logger.log('ADMIN_KEY : ' + adminKey);
  Logger.log('AGENT_KEY : ' + agentKey);
  Logger.log('스프레드시트: https://docs.google.com/spreadsheets/d/' + ctx.ss.getId());
  Logger.log('웹앱 주소  : ' + url);
  Logger.log('오피스 주소: https://hyunyul89-design.github.io/ap-ai-office/#k=' + agentKey + '&api=' + url);
  Logger.log('──────────────────────────────────────────────');
  return { adminKey: adminKey, agentKey: agentKey, url: url };
}

/** 편집기에서 직접 실행: 키를 새로 발급합니다. (기존 연결 문구는 무효가 됩니다) */
function rotateKeys() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(PROP_ADMIN_KEY, 'apao-admin-' + randomKey_());
  props.setProperty(PROP_AGENT_KEY, 'apao-agent-' + randomKey_());
  return showKeys();
}

/* =============================================================================
 *  5. 응답 · 교육서
 * ==========================================================================*/

function json_(obj, callback) {
  var body = JSON.stringify(obj);
  if (callback) {
    // JSONP (디버깅용 · GET 에서만)
    return ContentService
      .createTextOutput(String(callback).replace(/[^\w.$]/g, '') + '(' + body + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function getPlaybookSummary_() {
  return [
    'AP파트너 교육 매뉴얼 요약',
    '1) 금지어 0건: 부동산·투자·권리금·보증금·바닥권·임대·월세·매매',
    '   → 시설·영업권 / 점포 예치금 / 점포 사용료 / 초기 인수 비용 / 점포 양도 컨설팅',
    '2) 숫자는 물건표 원본만. 없는 숫자·근처 역·매출 사유 지어내기 금지',
    '3) 블로그 2곳은 한 줄도 겹치지 않게(제목·도입 4줄·마무리), 제목과 첫 훅은 시설·영업권 금액 중심 + (점포 예치금 별도)',
    '4) 스레드: 친근한 반말 구어체, 금액은 1원까지 정확',
    '5) 답은 1~2턴 안에 결론만, 처리할 게 없으면 "대기"'
  ].join('\n');
}

/**
 * 교육서 원문. 저장소 docs/ai-delegation-playbook.md 와 같은 내용입니다.
 * (원문을 고치면 여기도 같이 고쳐 주세요.)
 */
function getPlaybook_() {
  return PLAYBOOK_TEXT_;
}

/* 교육서 원문 (저장소 docs/ai-delegation-playbook.md 와 같은 내용) */
var PLAYBOOK_TEXT_ = "# AP파트너 전담 AI 협업·교육 매뉴얼 (v1.0)\n\n이 문서는 피클(총괄 팀장)이 외부 AI(클로드·챗GPT·제미나이·Cue 등)에게 AP파트너 원고 작성·리서치·아이디어 작업을 분배할 때 **반드시 함께 전달하는 표준 규칙서**입니다.\n\n---\n\n## 1. 절대 금지어 (1건도 쓰면 안 됨)\n블로그·인스타·스레드·고객 화면(사이트) 본문 및 제목에 아래 단어를 절대 사용하지 않습니다.\n- `부동산`, `투자`, `권리금`, `보증금`, `바닥권`, `임대`, `월세`, `매매`\n\n### 대체 순화 표현 (반드시 이 표현만 사용)\n- 권리금 → **`시설·영업권`**\n- 보증금 → **`점포 예치금`**\n- 월세 → **`점포 사용료`**\n- 투자금 / 창업 비용 → **`초기 인수 비용`**\n- 부동산 / 중개 → **`점포 양도 컨설팅`**, **`현장 실사`**\n\n---\n\n## 2. 채널별 금액·표기 원칙\n- **홍보 사이트 (`apchangup.com`)**: `총 초기 인수 비용` (`시설·영업권 + 점포 예치금` 합산) 기준 표기, 고객 화면은 **`점포`** 용어 통일, 실제 **지점명·상세 주소 비공개** (`시/구 + 상권 성격`만 노출).\n- **네이버 블로그 2곳 (`에이피파트너` · `창업의 법칙`)**:\n  - 제목과 첫 훅은 **`시설·영업권` 금액만 앞세우고** `(점포 예치금 별도)`를 작게 표기.\n  - **2곳 글 완전 분리**: 제목·소제목·도입 첫 4줄·본문 전개·마무리 멘트까지 **한 줄도 겹치지 않게** 작성. (한쪽은 수익·운영 관점, 다른 쪽은 상권·계약·리스크 점검 관점 등 각도 분리)\n  - 본문 하단에 `https://apchangup.com/?id=AP-xxx` 사이트 유입 링크 **1곳** 포함.\n  - 명함 연락처(`010-2885-5553`, 카톡 `hyunyul89`) 안내 포함.\n- **인스타그램 릴스 (`@ap_artners`)**: 핵심 수치 훅 + 실사 포인트 + 해시태그 + 사이트 링크.\n- **스레드 (`@ap_artners`)**: **친근한 반말 구어체** + **숫자는 1원도 틀리지 않게 정확히** 표기.\n\n---\n\n## 3. 숫자·팩트 엄수 원칙\n- 원가·매출·경비·예상 수익·평수·좌석·배달 비중·로열티는 **원본 물건표에 적힌 숫자만** 사용.\n- 물건표에 없는 숫자·근처 역·매출 사유를 지어내지 않음.\n- 로열티·프랜차이즈 합계금 등이 총경비에 미포함된 경우 반드시 별도 명시.\n\n---\n\n## 4. 작업 분배 & 토큰 절약 규칙\n- 외부 AI에게 맡길 일: ① 블로그 2편 차별화 초안 작성, ② 스레드 반말 카피 초안, ③ 상권/브랜드 트렌드 리서치, ④ 신규 마케팅 아이디어·반박 검토.\n- 피클(총괄)이 직접 처리할 일: ① 물건표 원본 판독·수치 검증, ② 금지어 0건 최종 검수, ③ 브라우저 실행(블로그 예약·인스타·스레드·사이트 배포·서치콘솔).";

/* =============================================================================
 *  6. 설치 도우미
 * ==========================================================================*/

/**
 * 편집기에서 한 번 실행하면 스프레드시트·시트·키를 모두 만들고 로그에 안내를 남깁니다.
 */
function install() {
  var ctx = ensureSetup_();
  var url = ScriptApp.getService().getUrl();
  Logger.log('설치 완료');
  Logger.log('스프레드시트: https://docs.google.com/spreadsheets/d/' + ctx.ss.getId());
  Logger.log('웹앱 주소: ' + url);
  Logger.log('※ 위 주소가 비어 있으면 [배포] → [새 배포] → 웹 앱 → 액세스: 모든 사용자 로 배포하세요.');
  showKeys();
  return ctx.ss.getId();
}
