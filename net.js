/* 通信：iPad（親）が部屋になり、スマホ（子）がPeerJSでつながる。せーので一致の作りを流用 */
const PREFIX = 'sumaho-poker-v1-';
const MAX_PLAYERS = 9;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても遊べる */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } },
};
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
// タブを閉じても同じ人として戻れるよう、localStorageに置く
const myId = store.get('sp-id') || (() => { const v = rid(); store.set('sp-id', v); return v; })();

const N = {
  role: null,        // 'host' | 'client'
  peer: null, room: '', G: null, conns: new Map(), hostConn: null,
  S: null, ME: null, // 子：親から届いた最新の状態と、自分だけの情報
  deadline: 0, paused: false, turnKey: '', timers: {}, retry: 0, status: '',
};

/* ---------- 親（iPad） ---------- */
function hostCreate(resume) {
  N.status = 'connecting'; UI.render();
  const room = resume ? resume.room : String(Math.floor(1000 + Math.random() * 9000));
  N.peer = new Peer(PREFIX + room);
  N.peer.on('open', () => {
    // 仲介サーバーにつなぎ直した時も 'open' が来る。その時はゲームを作り直さない
    if (N.G) { N.status = ''; return; }
    N.role = 'host'; N.room = room; N.status = '';
    N.G = resume ? resume.G : PokerEngine.createGame({});
    N.G.players.forEach((p) => { p.online = false; });
    N.paused = resume ? true : false; // 続きから始めた時は、親が「再開」を押すまで止める
    keepAwake(); hostSync();
  });
  N.peer.on('connection', (c) => {
    c.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'join') {
        c.pid = String(m.id || '').slice(0, 24);
        const old = N.conns.get(c.pid);
        if (old && old !== c) { try { old.close(); } catch (e) { /* noop */ } }
        N.conns.set(c.pid, c);
      }
      if (c.pid) hostHandle(c.pid, m, c);
    });
    c.on('close', () => {
      if (!c.pid || N.conns.get(c.pid) !== c) return;
      N.conns.delete(c.pid);
      const p = N.G.players.find((x) => x.id === c.pid);
      if (p) p.online = false;
      hostAfter();
    });
  });
  N.peer.on('disconnected', () => { try { N.peer.reconnect(); } catch (e) { /* noop */ } });
  N.peer.on('error', (e) => {
    if (e.type === 'unavailable-id' && !N.G && !resume) { N.peer.destroy(); hostCreate(); return; }
    if (!N.G) UI.fail('部屋を作れませんでした（' + e.type + '）。通信環境を確かめて、もう一度お試しください。');
  });
}

function hostHandle(pid, m, c) {
  const G = N.G, p = G.players.find((x) => x.id === pid);
  if (m.t === 'join') {
    const name = String(m.name || '').trim().slice(0, 8) || '名なし';
    if (!p && G.players.filter((x) => !x.left).length >= MAX_PLAYERS) { c.send({ t: 'full' }); return; }
    PokerEngine.addPlayer(G, pid, name);
  } else if (!p) return;
  else if (m.t === 'act') {
    const err = PokerEngine.act(G, pid, m.type, m.amount);
    if (err && c) c.send({ t: 'err', msg: err });
  } else if (m.t === 'sitout') {
    p.sitOut = !!m.on;
    if (p.sitOut && G.hand && G.hand.toAct === pid) PokerEngine.autoAct(G);
  } else if (m.t === 'leave') {
    hostRemove(pid);
    if (c) setTimeout(() => { try { c.close(); } catch (e) { /* noop */ } }, 200);
  }
  hostAfter();
}

function hostRemove(pid) {
  const G = N.G, p = G.players.find((x) => x.id === pid);
  if (!p) return;
  if (G.phase === 'lobby') G.players = G.players.filter((x) => x.id !== pid);
  else {
    p.left = true; p.online = false;
    if (G.hand && G.hand.toAct === pid) PokerEngine.autoAct(G);
    else if (G.hand && G.phase === 'hand' && G.hand.ids.includes(pid)) G.hand.folded[pid] = true;
  }
  N.conns.delete(pid);
}

function hostKick(pid) {
  const c = N.conns.get(pid);
  if (c) { try { c.send({ t: 'kicked' }); setTimeout(() => c.close(), 300); } catch (e) { /* noop */ } }
  hostRemove(pid); hostAfter();
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
  v.room = N.room; v.deadline = N.deadline; v.paused = N.paused; v.nextAt = N.nextAt || 0; v.now = Date.now();
  return v;
}
function hostSync() {
  const v = hostView();
  N.conns.forEach((c, pid) => {
    if (c.open) { try { c.send({ t: 'state', s: v, me: PokerEngine.privateView(N.G, pid) }); } catch (e) { /* noop */ } }
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
      if (!wasTurn && N.ME.options) UI.myTurnAlert();
      // 勝った人のスマホだけ「でれれん」
      const r = N.S.result;
      if (N.S.phase === 'between' && r && r.won && r.won[myId] && UI.resultSeen !== N.S.handNo) { UI.resultSeen = N.S.handNo; UI.jingle(0.3); }
      UI.render();
    } else if (m.t === 'err') UI.toast(m.msg);
    else if (m.t === 'full') UI.fail('部屋がいっぱいです（最大' + MAX_PLAYERS + '人）。');
    else if (m.t === 'kicked') { N.hostConn = null; UI.fail('iPadの操作で部屋から外されました。'); }
    else if (m.t === 'closed') { N.hostConn = null; UI.fail('部屋が終わりました。'); }
  });
  c.on('close', () => { if (N.hostConn === c && N.status !== 'error') retryLater(); });
}
function retryLater() {
  if (N.retry++ < 30) { UI.banner('iPadにつなぎ直しています…'); setTimeout(connectHost, 2000); }
  else UI.fail('iPadとの接続が切れました。iPadの画面が開いているか確かめて、入り直してください。');
}
function clientSend(m) {
  if (N.hostConn && N.hostConn.open) N.hostConn.send(m);
  else UI.toast('つながっていません');
}

function leaveRoom() {
  if (N.role === 'host') {
    N.conns.forEach((c) => { try { if (c.open) c.send({ t: 'closed' }); } catch (e) { /* noop */ } });
    store.del('sp-host');
  } else clientSend({ t: 'leave' });
  setTimeout(() => { try { N.peer.destroy(); } catch (e) { /* noop */ } location.href = location.pathname; }, 300);
}
