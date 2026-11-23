/* 画面：共通の部品・入口・iPad（テーブル） */
const $ = (q) => document.querySelector(q);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('ja-JP');
const qs = new URLSearchParams(location.search);

const UI = { err: '', menu: false, handSeen: -1, boardSeen: 0, seen: new Set() };

function card(code, extra = '') {
  if (!code) return `<span class="c empty ${extra}"></span>`;
  if (code === 'back') return `<span class="c back ${extra}"></span>`;
  const s = code.slice(-1), rk = code.slice(0, -1);
  return `<span class="c ${s === '♥' || s === '♦' ? 'r' : ''} ${extra}"><span class="rk">${rk}</span><span class="st">${s}</span></span>`;
}
const boardHTML = (b) => [0, 1, 2, 3, 4].map((i) => card((b || [])[i])).join('');
const nameOf = (S, id) => ((S.players || []).find((p) => p.id === id) || {}).name || '？';
function mmss(ms) { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }

UI.fail = (msg) => { N.status = 'error'; UI.err = msg; UI.render(); };
UI.banner = (msg) => { const b = $('#banner'); b.textContent = msg; b.hidden = !msg; };
UI.toast = (msg) => {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 1600);
};

/* ---------- 音（その場で作る短い音） ---------- */
let actx = null;
let muted = store.get('sp-mute') === '1';
UI.unlockAudio = () => {
  try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { /* noop */ }
};
UI.beep = (freqs, dur = 0.12, vol = 0.15) => {
  if (muted || !actx) return;
  freqs.forEach((f, i) => {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * dur;
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.6);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur * 1.8);
  });
};

// カードがめくれる「ペラッ」：短いノイズを、高い音から少し下げながら鳴らす
UI.flip = (count = 1, vol = 0.5) => {
  if (muted || !actx) return;
  for (let i = 0; i < count; i++) {
    const t = actx.currentTime + i * 0.13, len = 0.09;
    const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * len), actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / d.length, 2);
    const src = actx.createBufferSource(); src.buffer = buf;
    const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(4200, t); bp.frequency.exponentialRampToValueAtTime(1600, t + len);
    const g = actx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(bp).connect(g).connect(actx.destination); src.start(t);
  }
};

// 勝敗がついた時の「でれれん」：ド・ミ・ソと上がり、最後を和音で伸ばす
UI.jingle = (delay = 0) => {
  if (muted || !actx) return;
  const notes = [[[523], 0.09], [[659], 0.09], [[784, 988, 1319], 0.5]];
  let t = actx.currentTime + delay;
  notes.forEach(([fs, len]) => {
    fs.forEach((f) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + len + 0.05);
    });
    t += len === 0.5 ? len : 0.11;
  });
};

/* ---------- 入口 ---------- */
function homeHTML() {
  const saved = (() => { try { return JSON.parse(store.get('sp-host') || 'null'); } catch (e) { return null; } })();
  const resume = saved && Date.now() - saved.at < 12 * 3600 * 1000
    ? `<button class="sub" data-do="resume">前のゲームを続ける（部屋 ${esc(saved.room)}）</button>` : '';
  const room = qs.get('room') || '';
  return `<div class="home">
    <h1>スマホ版ポーカー</h1>
    <p>iPadがテーブル、みんなのスマホが手札。<br>同じWi-Fiにつないで遊んでください。</p>
    <div class="pick">
      <div class="panel">
        <h2>スマホで参加</h2>
        <label>部屋番号<input id="room" inputmode="numeric" maxlength="4" value="${esc(room)}" placeholder="4桁"></label>
        <label>名前<input id="name" maxlength="8" value="${esc(store.get('sp-name') || '')}" placeholder="8文字まで"></label>
        <button class="go" data-do="join">参加する</button>
      </div>
      ${room ? '' : `<div class="panel">
        <h2>iPadでテーブルを作る</h2>
        <p>この端末がテーブルになります。iPadは遊ぶ人には入りません。</p>
        <button class="go host" data-do="create">部屋を作る</button>${resume}
      </div>`}
    </div>
  </div>`;
}

/* ---------- iPad：上の帯 ---------- */
// 今のゲームのブラインドと、次のゲームからのブラインド
const nowBlinds = (S) => S.handBlinds || S.blinds;
const blindsChanged = (S) => S.handBlinds && S.phase !== 'lobby' && S.handBlinds.join() !== S.blinds.join();
// 左上：ブラインド ／ 右上：部屋番号・☰・🔊（上の帯をやめてテーブルを広くした）
function topbarHTML(S) {
  const nextUp = S.settings.blindUpMin && S.phase !== 'lobby' && !S.paused
    ? `<span class="pill">次の上昇まで <b data-until="${S.levelStartedAt + S.settings.blindUpMin * 60000}">--:--</b></span>` : '';
  const left = S.phase === 'lobby' ? '' : `<div class="corner-l">
    <span class="pill big">ブラインド ${nowBlinds(S).join(' / ')}</span>
    ${blindsChanged(S) ? `<span class="pill warn">→ 次から ${S.blinds.join(' / ')}</span>` : ''}${nextUp}
    ${S.paused && !UI.menu ? '<button class="pill warn" data-do="resume-game">⏸ 一時停止中　▶ 再開する</button>' : ''}
  </div>`;
  // 部屋番号と音のオン・オフはメニューの中だけ（2026-11-23 オーナー）
  return `${left}${S.phase !== 'lobby' ? '<div class="corner-r"><button class="icon" data-do="menu">☰</button></div>' : ''}`;
}
// 右下の丸いタイマー：手番は残り10秒から、次のゲームまでは最初から。線が減っていき、中に秒数
function timerHTML(S) {
  if (S.paused) return '';
  let until = 0, total = 10, kind = '';
  if (S.phase === 'hand' && S.deadline) { until = S.deadline; total = S.settings.timeLimit || 60; kind = 'turn'; }
  if (S.phase === 'between' && S.nextAt) { until = S.nextAt; total = Math.round((S.nextAt - S.now) / 1000) || 8; kind = 'next'; }
  if (!until) return '';
  return `<div class="ctimer ${kind}" data-timer="${until}" data-total="${total}" hidden>
    <svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44" pathLength="100"/></svg>
    <b>--</b><small>${kind === 'next' ? '次のゲーム' : ''}</small></div>`;
}
// 左下：何ゲーム目か＋直前のゲームの増減
function gameInfoHTML(S) {
  if (S.phase === 'between' && S.result) UI.lastResult = { no: S.handNo, net: S.result.net || {} };
  const lr = UI.lastResult;
  let res = '';
  if (lr && lr.net) {
    const ids = Object.keys(lr.net).sort((a, b) => lr.net[b] - lr.net[a]);
    res = ids.map((id) => `<span class="${lr.net[id] > 0 ? 'plus' : 'minus'}">${esc(nameOf(S, id))} ${lr.net[id] > 0 ? '＋' : '−'}${num(Math.abs(lr.net[id]))}</span>`).join('');
    res = `<span class="lbl">${lr.no === S.handNo ? '結果' : '前回'}</span>${res}`;
  }
  return `<div class="ginfo"><b>第${S.handNo}ゲーム</b>${res}${S.paused ? '<span class="lbl">⏸ 一時停止中（スマホの操作も止まっています）</span>' : ''}</div>`;
}

/* ---------- iPad：ロビー ---------- */
const OPT = {
  stack: [[500, '500'], [1000, '1,000'], [2000, '2,000'], [5000, '5,000']],
  level: [[0, '5 / 10'], [1, '10 / 20'], [4, '25 / 50'], [6, '50 / 100']],
  blindUpMin: [[0, '上げない'], [10, '10分ごと'], [15, '15分ごと'], [20, '20分ごと']],
  rebuy: [[1, 'もう一度もらえる'], [0, '脱落']],
  timeLimit: [[0, 'なし'], [30, '30秒'], [60, '60秒']],
};
const OPT_LABEL = { stack: '最初のチップ', level: 'ブラインド', blindUpMin: 'ブラインドを上げる', rebuy: 'チップがなくなったら', timeLimit: '1手の持ち時間' };
function lobbyHTML(S) {
  const ps = S.players;
  const slots = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = ps[i];
    slots.push(p ? `<div class="${p.online ? '' : 'off'}">${i + 1}. ${esc(p.name)}${p.online ? '' : '（切断）'}<button class="x" data-kick="${p.id}">×</button></div>` : `<div class="wait">空き</div>`);
  }
  const set = N.G.settings;
  const sel = (k) => `<label>${OPT_LABEL[k]}<select data-set="${k}">${OPT[k].map(([v, l]) =>
    `<option value="${v}" ${String(+set[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  return `<div class="table-view">${topbarHTML(S)}
    <div class="lobby">
      <div class="joinbox">
        <div class="qr" id="qr"></div>
        <div class="num">${esc(S.room)}</div>
        <p>スマホでQRを読むか、部屋番号を入れて参加</p>
      </div>
      <div>
        <div class="plist">${slots.join('')}</div>
        <div class="settings">${Object.keys(OPT).map(sel).join('')}</div>
        <button class="start" data-do="start" ${ps.length < 2 ? 'disabled' : ''}>${ps.length < 2 ? '2人以上で始められます' : `スタート（${ps.length}人）`}</button>
      </div>
    </div></div>`;
}

/* ---------- iPad：テーブル ---------- */
function seatHTML(S, p, i, n) {
  const a = (90 + (360 / n) * i) * Math.PI / 180; // 下から時計回り
  const x = 50 + 41 * Math.cos(a), y = 50 + 40 * Math.sin(a);
  const r = S.result;
  const win = r && r.won && r.won[p.id];
  const cls = ['seat'];
  if (p.folded || p.out || (!p.inHand && S.phase === 'hand')) cls.push('folded');
  if (S.toAct === p.id && S.phase === 'hand') cls.push('turn');
  if (win && S.phase === 'between') cls.push('win');
  let hole = '';
  if (p.inHand && !p.folded) hole = p.hole ? p.hole.map((c) => card(c, UI.seen.has(p.id) ? '' : 'flip')).join('') : card('back') + card('back');
  const made = r && r.hands && r.hands[p.id];
  const tag = p.out ? '脱落' : !p.online ? '切断中' : p.sitOut ? '離席' : p.folded ? 'フォールド' : p.allin ? 'オールイン'
    : made && S.phase === 'between' ? made.name : p.pos;
  const bet = p.bet && S.phase === 'hand' ? `<div class="bet" style="${y < 50 ? 'top' : 'bottom'}:calc(100% + 8px)">${num(p.bet)}</div>` : '';
  const winTag = win && S.phase === 'between' ? `<div class="bet" style="${y < 50 ? 'top' : 'bottom'}:calc(100% + 8px)">＋${num(win)}</div>` : '';
  let ring = '';
  if (cls.includes('turn') && S.deadline) {
    const T = S.settings.timeLimit, left = (S.deadline - S.now) / 1000;
    ring = `<svg class="ring" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="2" y="2" width="96" height="96" rx="14" pathLength="100"
      style="--len:100;animation-duration:${T}s;animation-delay:${-(T - left)}s;animation-iteration-count:1;animation-fill-mode:forwards;${S.paused ? 'animation-play-state:paused' : ''}"/></svg>`;
  }
  return `<div class="${cls.join(' ')}" style="left:${x}%;top:${y}%">
    <div class="hole" ${p.hole ? 'style="--w:48px"' : ''}>${hole}</div>
    <div class="box">${ring}${p.dealer ? '<div class="btn-d">D</div>' : ''}
      <div class="nm">${esc(p.name)}</div><div class="ch">${num(p.chips)}</div><div class="tag">${tag || ''}</div>
    </div>${bet || winTag}</div>`;
}
function tableHTML(S) {
  const seats = S.players.filter((p) => !p.left || p.inHand);
  const b = S.board || [];
  let center = `<div class="board">${[0, 1, 2, 3, 4].map((i) => card(b[i], b[i] && i >= UI.boardSeen ? 'flip' : '')).join('')}</div>`;
  const pots = (S.pots || []).filter((v) => v > 0);
  const potText = pots.length > 1 ? `<small>${pots.map((v, i) => (i ? 'サイド' + i : 'メイン') + ' ' + num(v)).join(' ／ ')}</small>` : '';
  center += `<div class="pot">ポット ${num(S.pot)}${potText}</div>`;
  let banner = '';
  const r = S.result;
  if (S.phase === 'between' && r) {
    const ws = Object.keys(r.won);
    const h = r.hands && r.hands[ws[0]];
    banner = `<div class="banner">${ws.map((id) => esc(nameOf(S, id))).join('・')} の勝ち ＋${num(r.won[ws[0]])}
      <small>${h ? `${h.name}${h.detail ? '（' + h.detail + '）' : ''}` : 'ほかの人が全員降りました'}</small></div>`;
  }
  if (S.phase === 'waiting') banner = `<div class="banner">遊べる人が2人未満です<small>参加者が来たら「次のゲーム」を押してください</small></div>`;
  return `<div class="table-view">${topbarHTML(S)}
    <div class="stage"><div class="felt"></div>
      ${seats.map((p, i) => seatHTML(S, p, i, seats.length)).join('')}
      ${banner}<div class="center">${center}</div>
    </div>
    ${gameInfoHTML(S)}${timerHTML(S)}
    ${UI.menu ? menuHTML(S) : ''}
  </div>`;
}
function menuHTML(S) {
  const rows = S.players.filter((p) => !p.left).map((p) => `<div class="mrow"><span>${esc(p.name)}　${num(p.chips)}${p.rebuys ? `（もらい直し${p.rebuys}回）` : ''}</span>
    <span><button data-add="${p.id}">＋${num(S.settings.stack)}</button><button data-kick="${p.id}">外す</button></span></div>`).join('');
  const L = PokerEngine.LEVELS, lv = N.G.level;
  return `<div class="sheet"><div class="in wide">
    <div class="mhead"><h3>メニュー</h3><span>部屋 <b>${esc(S.room)}</b>　⏸ 一時停止中</span>
      <button class="icon" data-do="mute">${muted ? '🔇 音なし' : '🔊 音あり'}</button></div>
    <h3>ブラインド</h3>
    <div class="blindctl">
      <button data-do="leveldown" ${lv <= 0 ? 'disabled' : ''}>◀ 下げる</button>
      <div><small>今のゲーム</small><b>${nowBlinds(S).join(' / ')}</b></div>
      <div class="${blindsChanged(S) ? 'chg' : ''}"><small>次のゲームから</small><b>${L[lv].join(' / ')}</b></div>
      <button data-do="levelup" ${lv >= L.length - 1 ? 'disabled' : ''}>上げる ▶</button>
    </div>
    <div class="mbtns">
      ${S.phase === 'waiting' ? '<button data-do="nexthand">次のゲーム</button>' : ''}
      <button data-do="end" class="danger">ここで終わる</button>
    </div>
    <h3>プレイヤー</h3>${rows}
    <div class="mclose"><button class="go" data-do="close-resume">再開して閉じる</button>
      <button class="cancel" data-do="close-stay">止めたまま閉じる</button></div>
  </div></div>`;
}
function resultHTML(S, forHost) {
  const rows = S.players.slice().map((p) => ({ ...p, net: p.chips - S.settings.stack * (1 + (p.rebuys || 0)) }))
    .sort((a, b) => b.net - a.net);
  return `<div class="${forHost ? 'table-view' : 'hand-view'}"><div class="final">
    <h2>最終結果</h2>
    <table>${rows.map((p, i) => `<tr><td>${i + 1}位</td><td>${esc(p.name)}</td><td>${num(p.chips)}</td>
      <td class="${p.net >= 0 ? 'plus' : 'minus'}">${p.net >= 0 ? '+' : ''}${num(p.net)}</td></tr>`).join('')}</table>
    <p>${S.handNo}ゲーム遊びました。増減は、もらい直したチップを差し引いた数字です。</p>
    <button class="go" data-do="home">最初の画面へ</button>
  </div></div>`;
}

/* ---------- 描画 ---------- */
UI.render = () => {
  const app = $('#app');
  if (N.status === 'error') { app.innerHTML = `<div class="home"><h1>うまくいきませんでした</h1><p>${esc(UI.err)}</p><button class="go" data-do="home">最初の画面へ</button></div>`; return; }
  if (N.status === 'connecting') { app.innerHTML = `<div class="home"><h1>つないでいます…</h1>${N.connMsg ? `<p>${esc(N.connMsg)}</p>` : ''}</div>`; return; }
  const S = N.S;
  if (!N.role || !S) { app.innerHTML = homeHTML(); return; }
  if (N.role === 'host') {
    if (S.phase === 'end') app.innerHTML = resultHTML(S, true);
    else if (S.phase === 'lobby') {
      app.innerHTML = lobbyHTML(S);
      if (typeof QRCode !== 'undefined') new QRCode($('#qr'), { text: location.origin + location.pathname + '?room=' + S.room, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
    } else {
      // 新しく表になったカードだけ、めくる動きと「ペラッ」を出す
      if (S.handNo !== UI.handSeen) { UI.handSeen = S.handNo; UI.boardSeen = 0; UI.seen = new Set(); }
      const nb = (S.board || []).length - UI.boardSeen;
      const newShown = S.players.filter((p) => p.hole && !UI.seen.has(p.id)).length;
      app.innerHTML = tableHTML(S);
      const flips = Math.min(8, Math.max(0, nb) + newShown * 2);
      if (flips > 0) UI.flip(flips);
      if (S.phase === 'between' && S.result && UI.resultSeen !== S.handNo) { UI.resultSeen = S.handNo; UI.jingle(flips * 0.13 + 0.15); }
      UI.boardSeen = (S.board || []).length;
      S.players.forEach((p) => { if (p.hole) UI.seen.add(p.id); });
    }
  } else app.innerHTML = S.phase === 'end' ? resultHTML(S, false) : UI.phoneHTML(S, N.ME);
  UI.tick();
};
// 残り時間の数字だけを1秒ごとに書き換える（画面全体は描き直さない）
UI.tick = () => {
  const skew = N.role === 'client' && N.S ? N.S.skew || 0 : 0;
  document.querySelectorAll('[data-until]').forEach((el) => {
    const ms = +el.dataset.until - (Date.now() - skew);
    el.textContent = el.dataset.sec ? Math.max(0, Math.ceil(ms / 1000)) : mmss(ms);
  });
  document.querySelectorAll('[data-timer]').forEach((el) => {
    const ms = +el.dataset.timer - (Date.now() - skew), total = +el.dataset.total * 1000;
    el.hidden = ms > total || ms <= 0;
    if (el.hidden) return;
    // 手番は残り10秒から数字を出す（それまでは線だけ）。次のゲームまでは最初から数字
    const late = ms <= 10000;
    el.querySelector('b').textContent = el.classList.contains('turn') && !late ? '' : Math.ceil(ms / 1000);
    el.querySelector('.fg').style.strokeDashoffset = String(100 - (ms / total) * 100);
    el.classList.toggle('hurry', el.classList.contains('turn') && late);
  });
};
setInterval(UI.tick, 100);
