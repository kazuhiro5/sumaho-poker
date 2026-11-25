/* 通信：iPad（親）が部屋になり、スマホ（子）がPeerJSでつながる。せーので一致の作りを流用 */
const PREFIX = 'sumaho-poker-v1-';
const MAX_PLAYERS = 9;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても遊べる */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } },
};
// 端末の秘密の番号。推測されないよう、暗号用の乱数で作る
const rid = () => {
  try { const a = new Uint32Array(3); crypto.getRandomValues(a); return Array.from(a, (x) => x.toString(36)).join('').slice(0, 20); }
  catch (e) { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
};
// タブを閉じても同じ人として戻れるよう、localStorageに置く
const myId = store.get('sp-id') || (() => { const v = rid(); store.set('sp-id', v); return v; })();

const N = {
  role: null,        // 'host' | 'client'
  peer: null, room: '', G: null, conns: new Map(), hostConn: null,
  S: null, ME: null, // 子：親から届いた最新の状態と、自分だけの情報
  deadline: 0, paused: false, turnKey: '', timers: {}, retry: 0, status: '',
  pending: new Map(), // ゲームの途中に来た、まだ席のない人（iPadが「入れる」を押すまで待つ）
};

/* ---------- 親（iPad） ---------- */
function hostCreate(resume, tries = 0) {
  N.status = 'connecting'; N.connMsg = resume ? `前の部屋（${resume.room}）を取り戻しています…` + (tries ? `（${tries}回目）` : '') : ''; UI.render();
  const room = resume ? resume.room : String(Math.floor(1000 + Math.random() * 9000));
  N.peer = new Peer(PREFIX + room);
  N.peer.on('open', () => {
    // 仲介サーバーにつなぎ直した時も 'open' が来る。その時はゲームを作り直さない
    if (N.G) { N.status = ''; return; }
    N.role = 'host'; N.room = room; N.status = '';
    N.G = resume ? resume.G : PokerEngine.createGame({});
    N.G.players.forEach((p) => { p.online = false; if (!p.key) p.key = p.id; }); // 古い保存データは id がそのまま秘密の番号
    N.paused = resume ? true : false; // 続きから始めた時は、親が「再開」を押すまで止める
    keepAwake(); hostSync(); guardBack();
  });
  N.peer.on('connection', (c) => {
    c.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'join') {
        c.pid = String(m.id || '').slice(0, 24);
        if (!c.pid) return;
      }
      // 席が決まった接続（N.connsに入っているもの）からの操作だけを受け付ける
      if (c.pid && (m.t === 'join' || N.conns.get(c.pid) === c)) hostHandle(c.pid, m, c);
    });
    c.on('close', () => {
      const w = c.pid && N.pending.get(c.pid);
      if (w && w.c === c) { N.pending.delete(c.pid); hostAfter(); return; }
      if (!c.pid || N.conns.get(c.pid) !== c) return;
      N.conns.delete(c.pid);
      const p = PokerEngine.byKey(N.G, c.pid);
      if (p) p.online = false;
      hostAfter();
    });
  });
  N.peer.on('disconnected', () => { try { N.peer.reconnect(); } catch (e) { /* noop */ } });
  N.peer.on('error', (e) => {
    if (e.type === 'unavailable-id' && !N.G && !resume) { N.peer.destroy(); hostCreate(); return; }
    // 続きから：前のページが部屋番号をまだ持っている（仲介サーバーが離したことに気づくまで少しかかる）。3秒おきに取り直す
    if (e.type === 'unavailable-id' && !N.G && resume && tries < 25) {
      try { N.peer.destroy(); } catch (x) { /* noop */ }
      setTimeout(() => hostCreate(resume, tries + 1), 3000); return;
    }
    if (e.type === 'unavailable-id' && !N.G && resume) { UI.fail(`前の部屋（${resume.room}）を取り戻せませんでした。少し待ってからもう一度「前のゲームを続ける」を押してください。`); return; }
    if (!N.G) UI.fail('部屋を作れませんでした（' + e.type + '）。通信環境を確かめて、もう一度お試しください。');
  });
}

// pid は端末の秘密の番号（key）。ゲームの中の番号（p.id）とは別
function hostAccept(pid, name, c) {
  const old = N.conns.get(pid);
  if (old && old !== c) { try { old.close(); } catch (e) { /* noop */ } }
  N.conns.set(pid, c);
  PokerEngine.addPlayer(N.G, pid, name);
}
function hostHandle(pid, m, c) {
  const G = N.G, p = PokerEngine.byKey(G, pid);
  if (m.t === 'join') {
    const name = String(m.name || '').trim().slice(0, 8) || '名なし';
    if ((G.banned || []).includes(pid)) { c.send({ t: 'banned' }); setTimeout(() => { try { c.close(); } catch (e) { /* noop */ } }, 300); return; }
    if (!p && G.players.filter((x) => !x.left).length >= MAX_PLAYERS) { c.send({ t: 'full' }); return; }
    // 始まった後に来た新しい人は、iPadが「入れる」を押すまで待ってもらう（知らない人が勝手に入らないように）
    if (!p && G.phase !== 'lobby') {
      const was = N.pending.get(pid);
      if (was && was.c !== c) { try { was.c.close(); } catch (e) { /* noop */ } }
      N.pending.set(pid, { name, c });
      c.send({ t: 'pending' });
      hostAfter(); return;
    }
    hostAccept(pid, name, c);
  } else if (!p) return;
  else if (m.t === 'act') {
    if (N.paused) { if (c) c.send({ t: 'err', msg: '一時停止中です' }); return; }
    const err = PokerEngine.act(G, p.id, m.type, m.amount);
    if (err && c) c.send({ t: 'err', msg: err });
  } else if (m.t === 'sitout') {
    p.sitOut = !!m.on;
    if (p.sitOut && G.hand && G.hand.toAct === p.id) PokerEngine.autoAct(G);
  } else if (m.t === 'leave') {
    hostRemove(pid);
    if (c) setTimeout(() => { try { c.close(); } catch (e) { /* noop */ } }, 200);
  }
  hostAfter();
}

function hostRemove(pid) {
  const G = N.G, p = PokerEngine.byKey(G, pid);
  if (!p) return;
  const id = p.id;
  if (G.phase === 'lobby') G.players = G.players.filter((x) => x !== p);
  else {
    p.left = true; p.online = false;
    if (G.hand && G.hand.toAct === id) PokerEngine.autoAct(G);
    else if (G.hand && G.phase === 'hand' && G.hand.ids.includes(id)) G.hand.folded[id] = true;
  }
  N.conns.delete(pid);
}

// iPadの画面のボタンには p.id（画面用の番号）が入っている。秘密の番号に直す
const keyOf = (id) => { const p = N.G.players.find((x) => x.id === id); return p ? p.key || p.id : ''; };
// BAN：部屋から出して、この部屋には入り直せなくする（端末の秘密の番号で見分ける）
function hostBan(id) {
  const pid = keyOf(id); if (!pid) return;
  N.G.banned = (N.G.banned || []).concat(pid);
  const c = N.conns.get(pid);
  if (c) { try { c.send({ t: 'banned' }); setTimeout(() => c.close(), 300); } catch (e) { /* noop */ } }
  hostRemove(pid); hostAfter();
}
function hostKick(id) {
  const pid = keyOf(id); if (!pid) return;
  const c = N.conns.get(pid);
  if (c) { try { c.send({ t: 'kicked' }); setTimeout(() => c.close(), 300); } catch (e) { /* noop */ } }
  hostRemove(pid); hostAfter();
}
// 途中参加の希望：入れる／断る（n は画面に出した順番。秘密の番号は画面に出さない）
function hostAdmit(n, ok) {
  const entry = [...N.pending][n]; if (!entry) return;
  const [pid, w] = entry;
  N.pending.delete(pid);
  if (ok && N.G.players.filter((x) => !x.left).length < MAX_PLAYERS) { hostAccept(pid, w.name, w.c); hostAfter(); return; }
  try { w.c.send({ t: ok ? 'full' : 'denied' }); setTimeout(() => { try { w.c.close(); } catch (e) { /* noop */ } }, 300); } catch (e) { /* noop */ }
  hostAfter();
}

// 一時停止：手番の残り時間を覚えておき、再開した時にその分だけ戻す
function setPaused(on) {
  if (on && !N.paused) {
    N.pauseLeft = N.deadline ? Math.max(0, N.deadline - Date.now()) : 0;
    N.paused = true;
  } else if (!on && N.paused) {
    N.paused = false;
    if (N.pauseLeft) N.deadline = Date.now() + N.pauseLeft;
    N.pauseLeft = 0;
  }
  hostAfter();
}

// 状態が変わった後：手番の時間・次の勝負・送信
function hostAfter() {
  const G = N.G;
  clearTimeout(N.timers.turn); clearTimeout(N.timers.next);
  if (G.phase === 'hand' && G.hand.toAct) {
    const key = G.handNo + ':' + G.hand.street + ':' + G.hand.toAct + ':' + G.hand.raiseCount + ':' + G.log.length;
    if (key !== N.turnKey) { N.turnKey = key; N.deadline = G.settings.timeLimit ? Date.now() + G.settings.timeLimit * 1000 : 0; }
    const p = G.players.find((x) => x.id === G.hand.toAct);
    let wait = N.deadline ? N.deadline - Date.now() : 0;
    if (!p.online || p.sitOut || p.left) wait = Math.min(wait || 10000, p.online ? 1500 : 10000);
    if (!N.paused && wait) N.timers.turn = setTimeout(() => { PokerEngine.autoAct(N.G); hostAfter(); }, Math.max(0, wait));
  } else N.deadline = 0;
  if (G.phase === 'waiting' && !N.paused) {
    const ready = G.players.filter((x) => !x.left && !x.out && !x.sitOut && x.chips > 0).length >= 2;
    if (ready) N.timers.next = setTimeout(() => { if (N.G.phase === 'waiting' && PokerEngine.startHand(N.G, Date.now())) hostAfter(); }, 2000);
  }
  if (G.phase === 'between' && !N.paused) {
    const wait = G.hand && G.hand.result && G.hand.result.showdown ? 8000 : 5000;
    N.nextAt = Date.now() + wait;
    N.timers.next = setTimeout(() => {
      if (!PokerEngine.startHand(N.G, Date.now())) N.G.phase = 'waiting';
      hostAfter();
    }, wait);
  }
  hostSync();
}

function hostView() {
  const v = PokerEngine.publicView(N.G);
  v.pending = [...N.pending.values()].map((w) => w.name);
  v.room = N.room; v.deadline = N.deadline; v.paused = N.paused; v.nextAt = N.nextAt || 0; v.now = Date.now();
  return v;
}
function hostSync() {
  const v = hostView();
  const pub = Object.assign({}, v); delete pub.pending; // 途中参加の希望はiPadだけに出す
  N.conns.forEach((c, pid) => {
    if (c.open) { try { c.send({ t: 'state', s: pub, me: PokerEngine.privateView(N.G, pid) }); } catch (e) { /* noop */ } }
  });
  N.S = v;
  if (N.G.phase !== 'lobby') store.set('sp-host', JSON.stringify({ room: N.room, G: N.G, at: Date.now() }));
  UI.render();
}

let wakeLock = null;
async function keepAwake() {
  try {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* 対応していない端末では何もしない */ }
}
document.addEventListener('visibilitychange', () => { if (N.role) keepAwake(); });

/* ---------- 子（スマホ） ---------- */
function clientJoin(room, name) {
  N.room = room; N.name = name; N.status = 'connecting'; UI.render();
  store.set('sp-name', name);
  N.peer = new Peer();
  N.peer.on('open', () => connectHost());
  N.peer.on('disconnected', () => { try { N.peer.reconnect(); } catch (e) { /* noop */ } });
  N.peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') {
      if (N.S) retryLater(); else UI.fail(`部屋「${room}」が見つかりません。番号と、iPadの画面が開いているかを確かめてください。`);
    } else if (!N.S) UI.fail('つながりませんでした（' + e.type + '）。同じWi-Fiにつないで、もう一度お試しください。');
  });
}
function connectHost() {
  const c = N.peer.connect(PREFIX + N.room, { reliable: true });
  N.hostConn = c;
  c.on('open', () => {
    N.retry = 0; UI.banner('');
    c.send({ t: 'join', id: myId, name: N.name });
    keepAwake();
  });
  c.on('data', (m) => {
    if (!m) return;
    if (m.t === 'state') {
      const wasTurn = N.ME && N.ME.options;
      N.S = m.s; N.ME = m.me; N.status = ''; N.role = 'client';
      N.S.skew = Date.now() - N.S.now; // 親と子の時計のずれ
      if (!wasTurn && N.ME.options && !N.S.paused) UI.myTurnAlert();
      const sit = !!(N.ME && N.ME.sitOut);
      if (N.lastSit !== undefined && N.lastSit !== sit) UI.toast(sit ? '離席しました（次のゲームから休みます）' : '席に戻りました（次のゲームから入ります）');
      N.lastSit = sit;
      UI.render();
    } else if (m.t === 'err') UI.toast(m.msg);
    else if (m.t === 'full') UI.fail('部屋がいっぱいです（最大' + MAX_PLAYERS + '人）。');
    else if (m.t === 'banned') { N.hostConn = null; UI.fail('この部屋には入れません（BANされました）。'); }
    else if (m.t === 'kicked') { N.hostConn = null; UI.fail('iPadの操作で部屋から外されました。'); }
    else if (m.t === 'closed') { N.hostConn = null; UI.fail('部屋が終わりました。'); }
    else if (m.t === 'pending') { N.status = 'pending'; UI.render(); }
    else if (m.t === 'denied') { N.hostConn = null; UI.fail('iPadで参加が断られました。'); }
  });
  c.on('close', () => { if (N.hostConn === c && N.status !== 'error') retryLater(); });
}
function retryLater() {
  // iPadが前の部屋を取り戻すのに約1分かかるため、約2分待つ
  if (N.retry++ < 60) { UI.banner('iPadにつなぎ直しています…'); setTimeout(connectHost, 2000); }
  else UI.fail('iPadとの接続が切れました。iPadの画面が開いているか確かめて、入り直してください。');
}
function clientSend(m) {
  if (N.hostConn && N.hostConn.open) N.hostConn.send(m);
  else UI.toast('つながっていません');
}

function leaveRoom() {
  N.leaving = true;
  if (N.role === 'host') {
    N.conns.forEach((c) => { try { if (c.open) c.send({ t: 'closed' }); } catch (e) { /* noop */ } });
    store.del('sp-host');
  } else clientSend({ t: 'leave' });
  setTimeout(() => { try { N.peer.destroy(); } catch (e) { /* noop */ } location.href = location.pathname; }, 300);
}

// ページを離れる時に部屋番号を仲介サーバーへ返す（返さないと、続きから始める時に「使用中」になる）
window.addEventListener('pagehide', () => { try { if (N.peer && !N.peer.destroyed) N.peer.destroy(); } catch (e) { /* noop */ } });

// ゲーム中のiPadで「戻る」を押してもページから出ない（間違えて戻るのを防ぐ）
function guardBack() {
  if (N.role !== 'host' || N.guarded) return;
  N.guarded = true;
  history.pushState({ stay: 1 }, '', location.href);
  window.addEventListener('popstate', () => {
    if (N.role !== 'host' || !N.G || N.G.phase === 'end' || N.leaving) return;
    history.pushState({ stay: 1 }, '', location.href);
    UI.toast('ゲーム中は戻れません。終わる時は ☰ の「ゲームを終了する」を使ってください');
  });
}
