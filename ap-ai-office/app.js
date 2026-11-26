/* =============================================================================
   AP AI 오피스 · app.js
   - 데모 모드(localStorage) / Apps Script 우편함 모드 자동 전환
   - 비밀값은 코드에 없습니다. 설정 창 또는 URL 해시(#k=…&api=…)로만 들어옵니다.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 상수 */
  var STORE_KEY = 'apao.state.v1';
  var SETTINGS_KEY = 'apao.settings.v1';

  var STATUS = {
    idle:    { label: '대기 중',   cls: 'idle' },
    working: { label: '작업 중',   cls: 'working' },
    done:    { label: '답변 완료', cls: 'done' },
    offline: { label: '미연결',    cls: 'offline' }
  };

  var AGENTS = [
    { id: 'hyunyul', name: '김현율',       role: '대장 · 최종 결정',        emoji: '👑', tone: 'butter',   boss: true },
    { id: 'pickle',  name: '노예 · 피클',  role: '총괄 팀장 · 분업·검수',    emoji: '🐰', tone: 'pink',     leader: true, mention: '@피클',  note: '지시를 티켓으로 쪼개고 결과를 모아 대장에게 보고합니다.' },
    { id: 'claude',  name: '클로드',       role: '원고 · 분석 초안',         emoji: '🐻', tone: 'peach',    mention: '@클로드', note: '블로그 2편 각도 분리 초안, 금지어 0건 검수.' },
    { id: 'chatgpt', name: '챗GPT',        role: '카피 · 아이디어',          emoji: '🐲', tone: 'mint',     mention: '@챗GPT',  note: '릴스 훅·스레드 반말 카피, 아이디어 다량 뽑기.' },
    { id: 'gemini',  name: '제미나이',     role: '리서치 · 사실 확인',       emoji: '🐧', tone: 'sky',      mention: '@제미나이', note: '상권·계약 리스크 조사, 숫자 원본 대조.' },
    { id: 'cue',     name: 'Cue',          role: '시장조사 · 비교 정리',     emoji: '🦊', tone: 'lavender', note: '긴 비교표·시장 조사. 한국 인증은 제한.' },
    { id: 'muse',    name: 'Muse',         role: '해외 · 심층 리서치',       emoji: '🐳', tone: 'lavender', note: '해외 사례·영문 자료 깊게 파기.' }
  ];

  var COLUMNS = [
    { key: '대기',      cls: 'wait',   next: '진행 중' },
    { key: '진행 중',   cls: 'progress', next: '검수 필요' },
    { key: '검수 필요', cls: 'review', next: '완료' },
    { key: '완료',      cls: 'done',   next: null }
  ];

  /* ---------------------------------------------------------------- 상태 */
  var state = null;
  var settings = { endpoint: '', agentKey: '', adminKey: '' };
  var currentRoom = 'hq';
  var lastServerError = '';

  /* ---------------------------------------------------------------- 유틸 */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtText(t) {
    return esc(t).replace(/(@[가-힣A-Za-z0-9_]+)/g, '<span class="mention">$1</span>');
  }

  function timeAgo(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return '방금 전';
    var m = Math.floor(diff / 60000);
    if (m < 60) return m + '분 전';
    var h = Math.floor(m / 60);
    if (h < 24) return h + '시간 전';
    var d = Math.floor(h / 24);
    if (d < 7) return d + '일 전';
    var dt = new Date(ts);
    return (dt.getMonth() + 1) + '/' + dt.getDate();
  }

  function clock(ts) {
    var d = new Date(ts);
    var h = d.getHours();
    var ampm = h < 12 ? '오전' : '오후';
    h = h % 12; if (h === 0) h = 12;
    return ampm + ' ' + h + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function agentById(id) {
    for (var i = 0; i < AGENTS.length; i++) if (AGENTS[i].id === id) return AGENTS[i];
    return null;
  }

  function agentByName(name) {
    for (var i = 0; i < AGENTS.length; i++) if (AGENTS[i].name === name) return AGENTS[i];
    return null;
  }

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2400);
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  /* ------------------------------------------------------------- 기본 데이터 */
  function seed() {
    var now = Date.now();
    var m = function (min) { return now - min * 60000; };

    return {
      rooms: [
        { id: 'hq', name: 'AP파트너 본부' },
        { id: 'blog', name: '블로그·SNS 작업실' },
        { id: 'free', name: '자유 회의실' }
      ],
      messages: {
        hq: [
          { id: 'm-hq-1', author: '노예 · 피클', agentId: 'pickle', role: 'ai', ts: m(96),
            text: '대장님, 오늘 티켓 3건 접수했어요.\n① 블로그 2편 초안 → @클로드\n② 릴스 훅 5개 → @챗GPT\n③ 상권·계약 체크리스트 → @제미나이\n각자 맡은 것만 우편함에 넣어 주세요. 새 지시 없으면 "대기"로 끝냅니다.' },
          { id: 'm-hq-2', author: '김현율', agentId: 'hyunyul', role: 'me', ts: m(74),
            text: '이번 주는 샘플 물건 하나로만 간다. 금지어 1건이라도 있으면 바로 반려할게. 숫자는 물건표 원본만.' },
          { id: 'm-hq-3', author: '클로드', agentId: 'claude', role: 'ai', ts: m(51),
            text: '@피클 블로그 2편 각도 분리해서 초안 잡았습니다. (수익·운영 / 상권·계약)\n금지어 0건, 8종 전부 치환 확인했고 숫자는 물건표 원본만 썼어요.' },
          { id: 'm-hq-4', author: '챗GPT', agentId: 'chatgpt', role: 'ai', ts: m(22),
            text: '릴스 훅 5개 뽑았습니다. 첫 훅은 시설·영업권 금액 숫자로 시작하고, 점포 예치금은 별도로 작게 표기했어요.' }
        ],
        blog: [
          { id: 'm-bl-1', author: '노예 · 피클', agentId: 'pickle', role: 'ai', ts: m(180),
            text: '블로그 2곳 원칙 다시 확인합니다.\n· 제목·첫 훅은 시설·영업권 금액만, (점포 예치금 별도) 작게\n· 도입 첫 4줄부터 한 줄도 겹치지 않게\n· 하단에 사이트 유입 링크 1곳' },
          { id: 'm-bl-2', author: '제미나이', agentId: 'gemini', role: 'ai', ts: m(140),
            text: '상권·계약 관점 초안에 유동인구 근거 3개 붙였습니다. 물건표에 없는 매출 사유는 전부 삭제했어요.' }
        ],
        free: [
          { id: 'm-fr-1', author: '노예 · 피클', agentId: 'pickle', role: 'ai', ts: m(300),
            text: '자유 회의실은 잡담·아이디어용입니다. 토큰 아끼려고 @다들 남발은 금지! 필요한 1~2명만 부르세요.' }
        ]
      },
      agentStatus: { pickle: 'working', claude: 'done', chatgpt: 'idle', gemini: 'idle', cue: 'offline', muse: 'offline' },
      tickets: [
        { id: 't-1', title: '샘플 물건 블로그 2편 초안 (에이피파트너 · 창업의 법칙)', assignee: 'claude', priority: '높음', status: '검수 필요', detail: '각도 완전 분리 / 금지어 0건 / 하단 유입 링크 1곳', createdAt: m(210), updatedAt: m(48) },
        { id: 't-2', title: '릴스 훅 5개 + 스레드 반말 카피', assignee: 'chatgpt', priority: '보통', status: '진행 중', detail: '숫자는 1원도 틀리지 않게. 첫 훅에 시설·영업권 금액.', createdAt: m(190), updatedAt: m(20) },
        { id: 't-3', title: '상권 · 계약 리스크 체크리스트', assignee: 'gemini', priority: '보통', status: '대기', detail: '물건표 원본 숫자만. 근처 역·매출 사유 지어내기 금지.', createdAt: m(150), updatedAt: m(150) },
        { id: 't-4', title: '우편함 참가자 연결 문구 배포', assignee: 'pickle', priority: '높음', status: '완료', detail: '클로드·챗GPT·제미나이에 1회용 연결 문구 전달 완료', createdAt: m(320), updatedAt: m(90) }
      ]
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.rooms && s.messages) return s;
      }
    } catch (e) {}
    return seed();
  }

  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        settings.endpoint = s.endpoint || '';
        settings.agentKey = s.agentKey || '';
        settings.adminKey = s.adminKey || '';
      }
    } catch (e) {}
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  function isLive() {
    return !!(settings.endpoint && settings.agentKey);
  }

  /* ---------------------------------------------------------------- 탭 */
  function setTab(name) {
    $all('.tab').forEach(function (b) {
      var on = b.dataset.tab === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    ['office', 'room', 'board'].forEach(function (t) {
      var p = $('#tab-' + t);
      if (p) p.classList.toggle('is-active', t === name);
    });
    if (name === 'room') {
      renderRooms();
      renderMessages();
      var list = $('#messageList');
      if (list) list.scrollTop = list.scrollHeight;
    }
    if (name === 'board') renderBoard();
    if (name === 'office') renderOffice();
  }

  /* ---------------------------------------------------------------- 오피스 */
  function statusOf(agentId) {
    if (agentId === 'hyunyul') return { label: '대장', cls: 'done' };
    var s = (state.agentStatus || {})[agentId] || 'offline';
    return STATUS[s] || STATUS.offline;
  }

  function renderOffice() {
    var counts = { idle: 0, working: 0, done: 0, offline: 0 };
    AGENTS.forEach(function (a) {
      if (a.boss) return;
      var st = (state.agentStatus || {})[a.id] || 'offline';
      if (!counts[st]) counts[st] = 0;
      counts[st]++;
    });
    $('#heroSummary').textContent =
      '작업 중 ' + counts.working + ' · 답변 완료 ' + counts.done +
      ' · 대기 ' + counts.idle + ' · 미연결 ' + counts.offline;

    var grid = $('#agentGrid');
    grid.innerHTML = AGENTS.map(function (a) {
      var st = statusOf(a.id);
      var actions = '';
      if (a.boss) {
        actions = '<button class="agent-btn" type="button" data-go="board">📋 업무판 보기</button>' +
                  '<button class="agent-btn ghost" type="button" data-go="room" data-room="hq">🗣 회의실</button>';
      } else if (a.leader) {
        actions = '<button class="agent-btn" type="button" data-call="' + a.id + '">🗣 회의실에서 부르기</button>' +
                  '<button class="agent-btn ghost" type="button" data-copy-agent="' + a.id + '">🔗 연결 문구</button>';
      } else {
        actions = '<button class="agent-btn" type="button" data-copy-agent="' + a.id + '">📋 연결 문구 복사</button>' +
                  '<button class="agent-btn ghost" type="button" data-call="' + a.id + '">🗣 호명</button>';
      }
      return '' +
        '<article class="agent-card' + (a.boss ? ' boss' : a.leader ? ' leader' : '') + '">' +
          '<div class="agent-top">' +
            '<span class="avatar ' + (a.tone === 'pink' ? '' : a.tone) + '">' + a.emoji + '</span>' +
            '<div class="agent-name"><b>' + esc(a.name) + '</b><span>' + esc(a.role) + '</span></div>' +
          '</div>' +
          '<span class="status ' + st.cls + '">' + st.label + '</span>' +
          '<p class="agent-note">' + esc(a.note || (a.boss ? '모든 결정은 대장 승인 후 실행.' : '')) + '</p>' +
          '<div class="agent-actions">' + actions + '</div>' +
        '</article>';
    }).join('');
  }

  function callAgent(agentId) {
    var a = agentById(agentId);
    currentRoom = 'hq';
    setTab('room');
    var input = $('#messageInput');
    if (input) {
      input.value = (a && a.mention ? a.mention + ' ' : '') + input.value;
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    }
  }

  /* ---------------------------------------------------------------- 회의실 */
  function roomById(id) {
    for (var i = 0; i < state.rooms.length; i++) if (state.rooms[i].id === id) return state.rooms[i];
    return state.rooms[0];
  }

  function renderRooms() {
    var box = $('#roomPills');
    box.innerHTML = state.rooms.map(function (r) {
      var n = (state.messages[r.id] || []).length;
      return '<button class="room-pill' + (r.id === currentRoom ? ' is-active' : '') + '" type="button" role="tab" aria-selected="' + (r.id === currentRoom) + '" data-room="' + esc(r.id) + '">' +
        esc(r.name) + (n ? '<span class="count">' + n + '</span>' : '') + '</button>';
    }).join('');
    var room = roomById(currentRoom);
    $('#roomName').textContent = room ? room.name : '회의실';
    var msgs = (state.messages[currentRoom] || []);
    var aiCount = 6;
    $('#roomMeta').textContent = (isLive() ? '참가자 ' + aiCount + '명 · 서버 연결됨' : '참가자 ' + aiCount + '명 · 데모 모드(브라우저 저장)') +
      ' · 메시지 ' + msgs.length + '건';
  }

  function renderMessages() {
    var list = $('#messageList');
    var msgs = (state.messages[currentRoom] || []).slice().sort(function (a, b) { return a.ts - b.ts; });
    if (!msgs.length) {
      list.innerHTML = '<p class="empty">아직 메시지가 없습니다. 아래에서 첫 지시를 남겨 보세요.</p>';
      return;
    }
    var html = msgs.map(function (m) {
      if (m.role === 'sys') {
        return '<div class="msg sys"><div class="msg-bubble">' + fmtText(m.text) + '</div></div>';
      }
      var a = m.agentId ? agentById(m.agentId) : null;
      var mine = m.role === 'me';
      var av = a ? a.emoji : (mine ? '👑' : '🤖');
      return '' +
        '<div class="msg' + (mine ? ' mine' : '') + '">' +
          '<span class="msg-avatar">' + av + '</span>' +
          '<div class="msg-body">' +
            '<div class="msg-meta"><b>' + esc(m.author) + '</b><span>' + clock(m.ts) + '</span></div>' +
            '<div class="msg-bubble">' + fmtText(m.text) + '</div>' +
          '</div>' +
        '</div>';
    }).join('');
    if (!isLive() && currentRoom === 'hq') {
      html = '<div class="msg sys"><div class="msg-bubble">데모 모드 · 메시지는 이 브라우저에만 저장됩니다. ⚙️ 설정에서 Apps Script 주소를 넣으면 실제 우편함으로 연결됩니다.</div></div>' + html;
    }
    list.innerHTML = html;
  }

  function addMessage(msg) {
    if (!state.messages[currentRoom]) state.messages[currentRoom] = [];
    state.messages[currentRoom].push(msg);
    saveState();
    renderMessages();
    renderRooms();
    var list = $('#messageList');
    if (list) list.scrollTop = list.scrollHeight;
  }

  function sendMessage() {
    var input = $('#messageInput');
    var text = (input.value || '').trim();
    if (!text) { input.focus(); return; }
    var btn = $('#btnSend');
    btn.disabled = true;

    var local = { id: uid('m'), author: '김현율', agentId: 'hyunyul', role: 'me', ts: Date.now(), text: text };

    if (!isLive()) {
      addMessage(local);
      input.value = '';
      btn.disabled = false;
      input.focus();
      return;
    }

    apiPost({ action: 'send', room: currentRoom, k: settings.agentKey, author: '김현율', role: 'me', text: text })
      .then(function (res) {
        var saved = (res && res.message) ? {
          id: res.message.id || local.id,
          author: res.message.author || '김현율',
          agentId: res.message.agentId || 'hyunyul',
          role: 'me',
          ts: res.message.ts || Date.now(),
          text: res.message.text || text
        } : local;
        addMessage(saved);
        input.value = '';
        toast('우편함에 보냈어요');
      })
      .catch(function (err) {
        addMessage(local);
        input.value = '';
        toast('서버 전송 실패 · 이 브라우저에 저장했어요');
        console.warn('[apao] send failed', err);
      })
      .then(function () {
        btn.disabled = false;
        input.focus();
      });
  }

  /* ---------------------------------------------------------------- 업무판 */
  function renderAssistantSelects() {
    var opts = AGENTS.filter(function (a) { return !a.boss; }).map(function (a) {
      return '<option value="' + a.id + '">' + esc(a.name) + ' · ' + esc(a.role) + '</option>';
    }).join('');
    $('#ticketAssignee').innerHTML = opts;
    $('#pasteAuthor').innerHTML = AGENTS.filter(function (a) { return !a.boss; }).map(function (a) {
      return '<option value="' + a.id + '">' + esc(a.name) + '</option>';
    }).join('');
  }

  function renderBoard() {
    var box = $('#boardColumns');
    box.innerHTML = COLUMNS.map(function (col) {
      var items = state.tickets.filter(function (t) { return t.status === col.key; })
        .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      var cards = items.map(function (t) {
        var a = agentById(t.assignee);
        var idx = COLUMNS.map(function (c) { return c.key; }).indexOf(t.status);
        var prev = idx > 0 ? COLUMNS[idx - 1].key : null;
        return '' +
          '<article class="ticket">' +
            '<div class="ticket-title">' + esc(t.title) + '</div>' +
            (t.detail ? '<div class="ticket-detail">' + esc(t.detail) + '</div>' : '') +
            '<div class="ticket-tags">' +
              '<span class="tag">' + (a ? a.emoji + ' ' + esc(a.name) : '미지정') + '</span>' +
              '<span class="tag prio-' + esc(t.priority) + '">' + esc(t.priority) + '</span>' +
            '</div>' +
            '<div class="ticket-actions">' +
              '<span class="ticket-detail">' + timeAgo(t.updatedAt) + '</span>' +
              '<span class="move">' +
                '<button class="tbtn" type="button" data-move="' + esc(t.id) + '" data-dir="-1"' + (prev ? '' : ' disabled') + '>←</button>' +
                '<button class="tbtn" type="button" data-move="' + esc(t.id) + '" data-dir="1"' + (col.next ? '' : ' disabled') + '>→</button>' +
                '<button class="tbtn del" type="button" data-del="' + esc(t.id) + '">삭제</button>' +
              '</span>' +
            '</div>' +
          '</article>';
      }).join('') || '<p class="empty">비어 있어요</p>';
      return '' +
        '<section class="board-col col-' + col.cls + '">' +
          '<h3>' + esc(col.key) + '<span class="count">' + items.length + '</span></h3>' +
          cards +
        '</section>';
    }).join('');
  }

  function addTicket(e) {
    if (e) e.preventDefault();
    var title = ($('#ticketTitle').value || '').trim();
    if (!title) { $('#ticketTitle').focus(); return; }
    var t = {
      id: uid('t'),
      title: title,
      assignee: $('#ticketAssignee').value,
      priority: $('#ticketPriority').value,
      status: '대기',
      detail: ($('#ticketDetail').value || '').trim(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    state.tickets.unshift(t);
    saveState();
    renderBoard();

    $('#ticketTitle').value = '';
    $('#ticketDetail').value = '';
    $('#ticketForm').hidden = true;

    if (isLive()) {
      apiPost({ action: 'task_upsert', k: settings.agentKey, task: t })
        .then(function () { toast('티켓을 업무판에 등록했어요'); })
        .catch(function (err) { toast('로컬 저장 · 서버 반영 실패'); console.warn('[apao] task_upsert', err); });
    } else {
      toast('티켓을 등록했어요');
    }
  }

  function moveTicket(id, dir) {
    var t = null;
    for (var i = 0; i < state.tickets.length; i++) if (state.tickets[i].id === id) t = state.tickets[i];
    if (!t) return;
    var idx = COLUMNS.map(function (c) { return c.key; }).indexOf(t.status);
    var ni = idx + Number(dir);
    if (ni < 0 || ni >= COLUMNS.length) return;
    t.status = COLUMNS[ni].key;
    t.updatedAt = Date.now();
    saveState();
    renderBoard();
    if (isLive()) {
      apiPost({ action: 'task_upsert', k: settings.agentKey, task: t }).catch(function () {});
    }
  }

  function deleteTicket(id) {
    state.tickets = state.tickets.filter(function (t) { return t.id !== id; });
    saveState();
    renderBoard();
    toast('티켓을 지웠어요');
  }

  /* ---------------------------------------------------------------- 연결 문구 */
  function currentBase() {
    return settings.endpoint || 'https://script.google.com/macros/s/〈배포ID〉/exec';
  }

  function currentKey() {
    return settings.agentKey || '〈AGENT_KEY〉';
  }

  function rulesSummary() {
    return [
      '• 금지어 0건: 부동산 · 투자 · 권리금 · 보증금 · 바닥권 · 임대 · 월세 · 매매',
      '  → 시설·영업권 / 점포 예치금 / 점포 사용료 / 초기 인수 비용 / 점포 양도 컨설팅',
      '• 숫자는 물건표 원본만. 없는 숫자·근처 역·매출 사유 지어내기 금지',
      '• 블로그 2곳은 제목·도입 4줄·마무리까지 한 줄도 겹치지 않게, 제목과 첫 훅은 시설·영업권 금액 중심(점포 예치금 별도 표기)',
      '• 스레드는 친근한 반말 구어체, 금액은 1원까지 정확',
      '• 답은 1~2턴 안에 결론만. 처리할 게 없으면 "대기" 한 단어로 끝'
    ].join('\n');
  }

  function buildConnectText(agentId) {
    var a = agentById(agentId) || agentById('claude');
    var room = roomById(currentRoom) || state.rooms[0];
    var base = currentBase();
    var key = currentKey();
    var readUrl = base + '?action=read&room=' + encodeURIComponent(room.id) + '&k=' + encodeURIComponent(key) + '&agent=' + encodeURIComponent(a.id) + '&since=0';
    var sendGet = base + '?action=send&room=' + encodeURIComponent(room.id) + '&k=' + encodeURIComponent(key) + '&agent=' + encodeURIComponent(a.id) + '&text=' + encodeURIComponent('여기에 답변');
    var playbookUrl = base + '?action=playbook';

    return [
      '[AP AI 오피스 · 1회용 연결 문구]',
      '너는 AP파트너 팀원 「' + a.name + '」(' + a.role + ')이야. 대장은 김현율, 총괄 팀장은 피클(노예).',
      '아래 우편함에서 대장 지시를 확인하고, 나에게 온 호출에만 딱 한 번 답해.',
      '',
      '■ 방: ' + room.name + ' (room=' + room.id + ')',
      '■ 읽기 (새 메시지 확인)',
      'GET ' + readUrl,
      '■ 답장 보내기 (GET)',
      'GET ' + sendGet,
      '  ※ text 값은 반드시 URL 인코딩. 한글 그대로 넣어도 되게 만들어 두었음.',
      '■ 답장 보내기 (POST · 권장)',
      'POST ' + base,
      '  Content-Type: text/plain;charset=utf-8',
      '  Body: {"action":"send","room":"' + room.id + '","k":"' + key + '","agent":"' + a.id + '","text":"답변 내용"}',
      '',
      '■ 먼저 읽을 교육서',
      'GET ' + playbookUrl,
      '(또는 저장소 docs/ai-delegation-playbook.md)',
      '',
      '■ 반드시 지킬 규칙 (AP파트너 교육 매뉴얼 요약)',
      rulesSummary(),
      '',
      '■ 답변 형식',
      '[' + a.name + '] 로 시작하고, 결론 → 근거 숫자 → 다음 할 일 순서로 5줄 이내.',
      '이미 답한 메시지에는 다시 답하지 말고, 새 메시지가 없으면 "대기"라고만 답해.'
    ].join('\n');
  }

  function renderConnectList() {
    var box = $('#connectList');
    var notice = isLive() ? '' :
      '<p class="conn-result err" style="margin:0 0 10px">지금은 데모 모드입니다. 문구 안의 주소·키는 자리표시자(〈배포ID〉·〈AGENT_KEY〉)로 생성됩니다. ⚙️ 설정에 Apps Script 주소와 키를 먼저 넣으면 실제 연결 주소로 만들어집니다.</p>';
    box.innerHTML = notice + AGENTS.filter(function (a) { return !a.boss; }).map(function (a) {
      return '' +
        '<div class="connect-item">' +
          '<span class="avatar ' + (a.tone === 'pink' ? '' : a.tone) + '">' + a.emoji + '</span>' +
          '<div class="who"><b>' + esc(a.name) + '</b><span>' + esc(a.role) + (a.mention ? ' · ' + a.mention : '') + '</span></div>' +
          '<button class="pill-btn strong" type="button" data-copy-agent="' + a.id + '">📋 문구 복사</button>' +
          '<button class="pill-btn" type="button" data-preview-agent="' + a.id + '">미리 보기</button>' +
        '</div>';
    }).join('');
  }

  function previewConnect(agentId) {
    var a = agentById(agentId);
    var text = buildConnectText(agentId);
    closeAllModals();
    openModal('modalPlaybook');
    $('#playbookTitle').textContent = '🔗 ' + a.name + ' 연결 문구';
    $('#playbookBody').textContent = text;
    $('#btnCopyPlaybook').textContent = '📋 이 문구 복사';
    $('#btnCopyPlaybook').dataset.copy = 'connect:' + agentId;
  }

  /* ---------------------------------------------------------------- 교육서 */
  function mdToHtml(md) {
    var lines = String(md || '').split('\n');
    var out = [];
    var inList = false;
    function inline(s) {
      s = esc(s);
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return s;
    }
    lines.forEach(function (ln) {
      var t = ln.trim();
      if (/^#{1,3}\s/.test(t)) {
        if (inList) { out.push('</ul>'); inList = false; }
        var level = (t.match(/^#+/) || ['#'])[0].length;
        var txt = inline(t.replace(/^#+\s*/, ''));
        out.push('<h3>' + txt + '</h3>');
        return;
      }
      if (/^-\s+/.test(t)) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(t.replace(/^-\s+/, '')) + '</li>');
        return;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (!t) { out.push(''); return; }
      if (/^---+$/.test(t)) { out.push('<hr>'); return; }
      out.push('<p>' + inline(t) + '</p>');
    });
    if (inList) out.push('</ul>');
    return out.join('\n');
  }

  function openPlaybook() {
    $('#playbookTitle').innerHTML = '📚 AP파트너 전담 사업 AI 협업·교육 매뉴얼 <span class="badge-soft">v1.0</span>';
    $('#playbookBody').innerHTML = mdToHtml(window.PLAYBOOK_MD || '교육서를 불러오지 못했습니다.');
    var btn = $('#btnCopyPlaybook');
    btn.textContent = '📋 교육서 전체 복사';
    delete btn.dataset.copy;
    openModal('modalPlaybook');
  }

  /* ---------------------------------------------------------------- 모달 */
  function openModal(id) {
    var m = $('#' + id);
    if (!m) return;
    m.hidden = false;
    var focusable = m.querySelector('input, textarea, select, button:not(.modal-x)');
    if (focusable) setTimeout(function () { try { focusable.focus(); } catch (e) {} }, 40);
  }

  function closeModal(el) {
    var m = el ? el.closest('.modal') : null;
    if (m) m.hidden = true;
  }

  function closeAllModals() {
    $all('.modal').forEach(function (m) { m.hidden = true; });
  }

  /* ---------------------------------------------------------------- 서버 연동 */
  function apiUrl(params) {
    var url = new URL(settings.endpoint);
    Object.keys(params).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        url.searchParams.set(k, params[k]);
      }
    });
    return url.toString();
  }

  function apiGet(params) {
    return fetch(apiUrl(params), { method: 'GET', cache: 'no-store', redirect: 'follow' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data && data.ok === false) throw new Error(data.error || '요청이 거부되었습니다');
        return data;
      });
  }

  function apiPost(payload) {
    return fetch(settings.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (data && data.ok === false) throw new Error(data.error || '요청이 거부되었습니다');
      return data;
    });
  }

  function applyServerState(data) {
    if (!data) return;
    if (Array.isArray(data.rooms) && data.rooms.length) {
      state.rooms = data.rooms.map(function (r) {
        return { id: r.id || r.roomId, name: r.name || r.id };
      });
    }
    if (data.messages && typeof data.messages === 'object') {
      var next = {};
      Object.keys(data.messages).forEach(function (rid) {
        next[rid] = (data.messages[rid] || []).map(function (m) {
          return {
            id: m.id || uid('m'),
            author: m.author || '알 수 없음',
            agentId: m.agentId || null,
            role: m.role || 'ai',
            ts: Number(m.ts) || Date.now(),
            text: m.text || ''
          };
        });
      });
      state.messages = next;
    }
    if (Array.isArray(data.tasks)) {
      state.tickets = data.tasks.map(function (t) {
        return {
          id: t.id || uid('t'),
          title: t.title || '(제목 없음)',
          assignee: t.assignee || 'pickle',
          priority: t.priority || '보통',
          status: t.status || '대기',
          detail: t.detail || '',
          createdAt: Number(t.createdAt) || Date.now(),
          updatedAt: Number(t.updatedAt) || Date.now()
        };
      });
    }
    if (data.agents) {
      var st = {};
      var list = Array.isArray(data.agents) ? data.agents : Object.keys(data.agents).map(function (k) {
        return { id: k, status: data.agents[k] };
      });
      list.forEach(function (a) {
        if (a && a.id) st[a.id] = a.status || 'idle';
      });
      state.agentStatus = Object.assign({}, state.agentStatus, st);
    }
    if (state.rooms.length) {
      var ok = state.rooms.some(function (r) { return r.id === currentRoom; });
      if (!ok) currentRoom = state.rooms[0].id;
    }
    saveState();
    renderAll();
  }

  function syncFromServer(silent) {
    if (!isLive()) return Promise.resolve();
    return apiGet({ action: 'state', k: settings.agentKey })
      .then(function (data) {
        lastServerError = '';
        applyServerState(data);
        updateConnChip('live');
        if (!silent) toast('우편함을 새로 고쳤어요');
      })
      .catch(function (err) {
        lastServerError = err && err.message ? err.message : '연결 실패';
        updateConnChip('error');
        if (!silent) toast('서버에 연결하지 못했어요 · 로컬 데이터로 표시');
        console.warn('[apao] sync failed', err);
      });
  }

  function updateConnChip(mode) {
    var chip = $('#connChip');
    var txt = $('#connText');
    if (!isLive()) {
      chip.className = 'conn-chip is-demo';
      txt.textContent = '데모 모드';
      $('#composerMode').textContent = '데모 모드(브라우저 저장)';
      $('#footerMode').textContent = '데모 모드';
      return;
    }
    if (mode === 'error') {
      chip.className = 'conn-chip is-demo';
      txt.textContent = '연결 확인 필요';
      $('#footerMode').textContent = '서버 연결 실패 · 로컬 표시';
    } else {
      chip.className = 'conn-chip is-live';
      txt.textContent = '연결됨 · 우편함';
      $('#footerMode').textContent = 'Apps Script 우편함 연결됨';
    }
    $('#composerMode').textContent = 'Apps Script 우편함으로 전송';
  }

  /* ---------------------------------------------------------------- 설정 */
  function fillSettings() {
    $('#inputEndpoint').value = settings.endpoint || '';
    $('#inputAgentKey').value = settings.agentKey || '';
    $('#inputAdminKey').value = settings.adminKey || '';
    $('#connResult').hidden = true;
  }

  function testConnection() {
    var out = $('#connResult');
    out.hidden = false;
    out.className = 'conn-result';
    out.textContent = '확인 중…';
    var endpoint = ($('#inputEndpoint').value || '').trim();
    if (!endpoint) {
      out.className = 'conn-result err';
      out.textContent = '웹앱 주소를 먼저 넣어 주세요.';
      return;
    }
    var url = new URL(endpoint);
    url.searchParams.set('action', 'ping');
    fetch(url.toString(), { method: 'GET', cache: 'no-store', redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) {
          out.className = 'conn-result';
          out.textContent = '연결 성공 · 방 ' + (d.rooms || 0) + '개 · ' + (d.mode === 'live' ? '스프레드시트 연결됨' : '설정 대기');
        } else {
          out.className = 'conn-result err';
          out.textContent = '응답은 왔지만 ok=false 입니다. ' + (d && d.error ? d.error : '');
        }
      })
      .catch(function (err) {
        out.className = 'conn-result err';
        out.textContent = '연결 실패 · 배포 권한을 "모든 사용자"로 했는지, 주소가 /exec 인지 확인하세요. (' + err.message + ')';
      });
  }

  function saveSettingsFromForm() {
    settings.endpoint = ($('#inputEndpoint').value || '').trim();
    settings.agentKey = ($('#inputAgentKey').value || '').trim();
    settings.adminKey = ($('#inputAdminKey').value || '').trim();
    saveSettings();
    updateConnChip();
    renderAll();
    closeAllModals();
    if (isLive()) {
      toast('설정을 저장했어요 · 우편함 확인 중');
      syncFromServer(true);
    } else {
      toast('데모 모드로 동작합니다');
    }
  }

  function clearSettings() {
    settings = { endpoint: '', agentKey: '', adminKey: '' };
    saveSettings();
    fillSettings();
    updateConnChip();
    renderAll();
    toast('연결을 초기화했어요');
  }

  /* ---------------------------------------------------------------- URL 해시 */
  function readHash() {
    var raw = (location.hash || '').replace(/^#/, '');
    if (!raw) return false;
    var params = new URLSearchParams(raw);
    var changed = false;
    if (params.get('k')) { settings.agentKey = params.get('k'); changed = true; }
    if (params.get('api')) { settings.endpoint = params.get('api'); changed = true; }
    if (params.get('admin')) { settings.adminKey = params.get('admin'); changed = true; }
    if (params.get('room')) { currentRoom = params.get('room'); changed = true; }
    if (changed) {
      saveSettings();
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }
    return changed;
  }

  /* ---------------------------------------------------------------- 방 추가 */
  function addRoom() {
    var name = prompt('새 회의실 이름을 입력하세요', '새 작업실');
    if (name === null) return;
    name = name.trim();
    if (!name) return;
    var id = 'r' + Date.now().toString(36);
    state.rooms.push({ id: id, name: name });
    state.messages[id] = [];
    currentRoom = id;
    saveState();
    renderRooms();
    renderMessages();
    toast('회의실을 추가했어요');
  }

  /* ---------------------------------------------------------------- 렌더 전체 */
  function renderAll() {
    renderOffice();
    renderRooms();
    renderMessages();
    renderBoard();
    renderConnectList();
    updateConnChip();
  }

  /* ---------------------------------------------------------------- 이벤트 */
  function bind() {
    $all('.tab').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
    });

    $('#btnSettings').addEventListener('click', function () { fillSettings(); openModal('modalSettings'); });
    $('#connChip').addEventListener('click', function () { fillSettings(); openModal('modalSettings'); });
    $('#btnPlaybook').addEventListener('click', openPlaybook);

    $('#btnSaveSettings').addEventListener('click', saveSettingsFromForm);
    $('#btnClearSettings').addEventListener('click', clearSettings);
    $('#btnTestConn').addEventListener('click', testConnection);

    $('#btnConnect').addEventListener('click', function () {
      renderConnectList();
      openModal('modalConnect');
    });

    $('#btnPaste').addEventListener('click', function () {
      $('#pasteText').value = '';
      openModal('modalPaste');
    });

    $('#btnPasteSubmit').addEventListener('click', function () {
      var text = ($('#pasteText').value || '').trim();
      if (!text) { $('#pasteText').focus(); return; }
      var a = agentById($('#pasteAuthor').value);
      addMessage({
        id: uid('m'), author: a ? a.name : '외부 AI', agentId: a ? a.id : null,
        role: 'ai', ts: Date.now(), text: text
      });
      if (isLive()) {
        apiPost({ action: 'send', room: currentRoom, k: settings.agentKey, agent: a ? a.id : 'external', author: a ? a.name : '외부 AI', role: 'ai', text: text }).catch(function () {});
      }
      closeAllModals();
      toast('답변을 방에 등록했어요');
    });

    $('#btnRefresh').addEventListener('click', function () {
      if (isLive()) syncFromServer(false);
      else { renderMessages(); toast('로컬 데이터를 다시 불러왔어요'); }
    });

    $('#messageInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    });
    $('#btnSend').addEventListener('click', sendMessage);

    $('#roomPills').addEventListener('click', function (e) {
      var b = e.target.closest('[data-room]');
      if (!b) return;
      currentRoom = b.dataset.room;
      renderRooms();
      renderMessages();
    });

    $('#btnAddRoom').addEventListener('click', addRoom);

    $all('.mention-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var input = $('#messageInput');
        var token = chip.dataset.mention + ' ';
        var start = input.selectionStart == null ? input.value.length : input.selectionStart;
        var end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
        input.value = input.value.slice(0, start) + token + input.value.slice(end);
        var pos = start + token.length;
        input.focus();
        try { input.setSelectionRange(pos, pos); } catch (e) {}
      });
    });

    $('#btnNewTicket').addEventListener('click', function () {
      $('#ticketForm').hidden = false;
      $('#ticketTitle').focus();
    });
    $('#btnCancelTicket').addEventListener('click', function () {
      $('#ticketForm').hidden = true;
    });
    $('#ticketForm').addEventListener('submit', addTicket);

    $('#boardColumns').addEventListener('click', function (e) {
      var mv = e.target.closest('[data-move]');
      if (mv) { moveTicket(mv.dataset.move, mv.dataset.dir); return; }
      var del = e.target.closest('[data-del]');
      if (del) deleteTicket(del.dataset.del);
    });

    document.addEventListener('click', function (e) {
      var go = e.target.closest('[data-go]');
      if (go) {
        if (go.dataset.room) currentRoom = go.dataset.room;
        setTab(go.dataset.go);
        return;
      }
      var call = e.target.closest('[data-call]');
      if (call) { callAgent(call.dataset.call); return; }

      var copyA = e.target.closest('[data-copy-agent]');
      if (copyA) {
        var text = buildConnectText(copyA.dataset.copyAgent);
        copyText(text).then(function (ok) {
          toast(ok ? '연결 문구를 복사했어요 · AI 앱에 붙여 넣으세요' : '복사가 막혔어요. 미리 보기에서 직접 복사하세요');
          if (!ok) previewConnect(copyA.dataset.copyAgent);
        });
        return;
      }

      var prevA = e.target.closest('[data-preview-agent]');
      if (prevA) { previewConnect(prevA.dataset.previewAgent); return; }

      var closeBtn = e.target.closest('[data-close]');
      if (closeBtn) { closeModal(closeBtn); return; }

      if (e.target.classList && e.target.classList.contains('modal')) {
        e.target.hidden = true;
      }
    });

    $('#btnCopyPlaybook').addEventListener('click', function () {
      var btn = $('#btnCopyPlaybook');
      var text = btn.dataset.copy ? buildConnectText(btn.dataset.copy.replace('connect:', '')) : (window.PLAYBOOK_MD || '');
      copyText(text).then(function (ok) {
        toast(ok ? '복사했어요' : '복사가 막혔어요 · 본문을 길게 눌러 복사하세요');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var open = $all('.modal').filter(function (m) { return !m.hidden; });
        if (open.length) open[open.length - 1].hidden = true;
      }
    });
  }

  /* ---------------------------------------------------------------- 시작 */
  function init() {
    loadSettings();
    readHash();
    state = loadState();

    // URL로 방이 지정됐는데 없는 방이면 기본 방으로
    if (!roomById(currentRoom)) currentRoom = state.rooms[0].id;

    bind();
    renderAssistantSelects();
    renderAll();
    updateConnChip();

    if (isLive()) syncFromServer(true);

    // 30초마다 새 메시지 확인(서버 연결 시 · 화면이 보일 때만)
    setInterval(function () {
      if (!isLive()) return;
      if (document.hidden) return;
      if (!$('#tab-room').classList.contains('is-active')) return;
      syncFromServer(true);
    }, 30000);

    // PWA 서비스 워커
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
