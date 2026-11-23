/* スマホ版ポーカー — 見た目だけのデモ（通信なし）。親＝iPadのテーブル、子＝スマホの手札と操作 */
const $ = (q) => document.querySelector(q);
const qs = new URLSearchParams(location.search);
const ROOM = '4821';
let view = qs.get('v') || '';
let scene = qs.get('s') || '';
let sheet = false, armed = '', armTimer = null, peeking = false;

/* ---------- デモ用のデータ ---------- */
const BOARD_FLOP = ['A♠', 'K♥', '7♦'];
const BOARD_END = ['A♠', 'K♥', '7♦', '7♣', '2♥'];
const MY = { name: 'さき', chips: 750, cards: ['A♥', 'Q♥'] };
// 席は画面の下から時計回り
const SEATS = [
  { name: 'さき', chips: 750 },
  { name: 'たく', chips: 1500, pos: 'SB' },
  { name: 'みお', chips: 2100, pos: 'BB' },
  { name: 'あき', chips: 980, dealer: true },
  { name: 'けん', chips: 1140, bet: 60 },
  { name: 'ゆう', chips: 860, folded: true },
];
const LOBBY = ['さき', 'たく', 'みお', 'あき', 'けん', 'ゆう'];

/* ---------- 部品 ---------- */
function card(code, extra = '') {
  if (!code) return `<span class="c empty ${extra}"></span>`;
  if (code === 'back') return `<span class="c back ${extra}"></span>`;
  const s = code.slice(-1), rk = code.slice(0, -1);
  const red = s === '♥' || s === '♦';
  return `<span class="c ${red ? 'r' : ''} ${extra}"><span class="rk">${rk}</span><span class="st">${s}</span></span>`;
}
const yen = (n) => n.toLocaleString('ja-JP');
function go(v, s) {
  view = v; scene = s; sheet = false; armed = '';
  const u = new URL(location.href);
  u.searchParams.set('v', v); u.searchParams.set('s', s);
  history.replaceState(null, '', u);
  render();
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 1400);
}

/* ---------- 入口 ---------- */
function homeHTML() {
  return `<div class="home">
    <h1>スマホ版ポーカー</h1>
    <p>見た目を確かめるためのデモです（通信はしません）。<br>iPadでは「テーブル」、スマホでは「手札」を開いてください。</p>
    <div class="pick">
      <button data-go="table:lobby">テーブル<small>iPad（親）で開く</small></button>
      <button data-go="hand:join">手札<small>スマホ（子）で開く</small></button>
    </div>
  </div>`;
}

/* ---------- 親画面（iPad） ---------- */
function topbar(extra = '') {
  return `<div class="topbar">
    <span class="room">部屋 ${ROOM}</span>
    <span class="pill">ブラインド 10 / 20</span>
    <span class="pill">次の上昇まで 08:12</span>
    ${extra}<span class="sp"></span>
    <button class="icon" title="音">🔊</button><button class="icon" title="メニュー">☰</button>
  </div>`;
}
function lobbyHTML() {
  const slots = [];
  for (let i = 0; i < 8; i++) slots.push(LOBBY[i] ? `<div>${i + 1}. ${LOBBY[i]}</div>` : `<div class="wait">空き</div>`);
  return `<div class="table-view">${topbar()}
    <div class="lobby">
      <div class="joinbox">
        <div class="qr" id="qr"></div>
        <div class="num">${ROOM}</div>
        <p>スマホでQRを読むか、部屋番号を入れて参加</p>
      </div>
      <div>
        <div class="plist">${slots.join('')}</div>
        <div class="settings">最初のチップ 1,000 ／ ブラインド 10/20（15分ごとに上昇）<br>チップがなくなったら：もう一度もらえる ／ 持ち時間 60秒</div>
        <button class="start" data-go="table:play">スタート（${LOBBY.length}人）</button>
      </div>
    </div></div>`;
}
function seatHTML(p, i, n, mode) {
  const a = (90 + (360 / n) * i) * Math.PI / 180; // 下から時計回り
  const x = 50 + 41 * Math.cos(a), y = 50 + 40 * Math.sin(a);
  const upper = y < 50;
  const cls = ['seat'];
  if (p.folded) cls.push('folded');
  if (mode === 'play' && i === 0) cls.push('turn');
  if (mode === 'show' && p.win) cls.push('win');
  let hole = '';
  if (mode === 'play' && !p.folded) hole = card('back') + card('back');
  if (mode === 'show' && p.show) hole = p.show.map((c) => card(c, 'flip')).join('');
  const tag = p.folded ? 'フォールド' : (p.pos || '') + (p.tag ? ' ' + p.tag : '');
  const bet = p.bet ? `<div class="bet" style="${upper ? 'top:calc(100% + 8px)' : 'bottom:calc(100% + 8px)'}">${p.bet}</div>` : '';
  const ring = cls.includes('turn')
    ? `<svg class="ring" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="2" y="2" width="96" height="96" rx="14" pathLength="100" style="--len:100"/></svg>` : '';
  return `<div class="${cls.join(' ')}" style="left:${x}%;top:${y}%">
    <div class="hole">${hole}</div>
    <div class="box">${ring}${p.dealer ? '<div class="btn-d">D</div>' : ''}
      <div class="nm">${p.name}</div><div class="ch">${yen(p.chips)}</div><div class="tag">${tag}</div>
    </div>${bet}</div>`;
}
function playHTML() {
  const board = [0, 1, 2, 3, 4].map((i) => card(BOARD_FLOP[i])).join('');
  return `<div class="table-view">${topbar()}
    <div class="stage"><div class="felt"></div>
      ${SEATS.map((p, i) => seatHTML(p, i, SEATS.length, 'play')).join('')}
      <div class="center"><div class="board">${board}</div><div class="pot">ポット 420</div></div>
    </div>
    <div class="log">けん 60をベット ／ ゆう フォールド ／ <b>さき の番（残り 30秒）</b></div>
  </div>`;
}
function showHTML() {
  const seats = SEATS.map((p) => ({ ...p, bet: 0 }));
  seats[0] = { ...seats[0], chips: 690, show: MY.cards, tag: 'ツーペア' };
  seats[4] = { ...seats[4], chips: 1680, show: ['K♠', 'K♦'], win: true, tag: 'フルハウス' };
  seats[1].folded = seats[2].folded = seats[3].folded = true;
  const board = BOARD_END.map((c, i) => card(c, i > 2 ? 'flip' : '')).join('');
  return `<div class="table-view">${topbar()}
    <div class="stage"><div class="felt"></div>
      ${seats.map((p, i) => seatHTML(p, i, seats.length, 'show')).join('')}
      <div class="banner">けん の勝ち ＋540<small>フルハウス（K 3枚＋7 2枚）</small></div>
      <div class="center"><div class="board">${board}</div><div class="pot">ポット 540<small>メイン 540</small></div></div>
    </div>
    <div class="log">次の勝負まで 5秒…</div>
  </div>`;
}

/* ---------- 子画面（スマホ） ---------- */
function joinHTML() {
  return `<div class="hand-view"><div class="join">
    <h2>部屋に入る</h2>
    <label>部屋番号<input id="room" inputmode="numeric" maxlength="4" value="${qs.get('room') || ROOM}"></label>
    <label>名前<input id="name" maxlength="8" value="${MY.name}"></label>
    <button class="go" data-go="hand:wait">参加する</button>
  </div></div>`;
}
function waitHTML() {
  return `<div class="hand-view">
    <div class="me"><span class="nm">${MY.name}</span><span class="ch">${yen(1000)}</span></div>
    <div class="waitmsg"><b>席1に座りました</b>iPadの「スタート」を待っています<br>参加 6人</div>
    <div class="subrow"><span>部屋 ${ROOM}</span><button>退出する</button></div>
  </div>`;
}
function handHTML(myTurn) {
  const board = [0, 1, 2, 3, 4].map((i) => card(BOARD_FLOP[i])).join('');
  const faces = peeking ? MY.cards.map((c) => card(c)).join('') : card('back') + card('back');
  const dis = myTurn ? '' : 'disabled';
  const st = myTurn ? `あなたの番です　コールに必要 <b>60</b>` : `けん の番です`;
  return `<div class="hand-view ${myTurn ? 'myturn' : ''}">
    <div class="me"><span class="nm">${MY.name}</span><span class="ch">${yen(MY.chips)}</span></div>
    <div class="minib">${board}</div>
    <div class="peek" id="peek">
      <div class="cards">${faces}</div>
      <div class="made">${peeking ? 'ワンペア（A）' : ''}</div>
      <div class="hint">${peeking ? '指を離すと隠れます' : '押している間だけ手札が見えます'}</div>
    </div>
    <div class="status">${st}</div>
    <div class="acts">
      <button class="f ${armed === 'fold' ? 'arm' : ''}" data-act="fold" ${dis}>${armed === 'fold' ? 'もう一度で降りる' : 'フォールド'}</button>
      <button class="k" data-act="call" ${dis}>コール 60</button>
      <button class="r" data-act="raise" ${dis}>レイズ</button>
      <button class="a ${armed === 'allin' ? 'arm' : ''}" data-act="allin" ${dis}>${armed === 'allin' ? 'もう一度で全部' : 'オールイン'}</button>
    </div>
    <div class="subrow"><span>ポット 420 ／ ブラインド 10/20</span><button>離席する</button></div>
    ${sheet ? raiseHTML() : ''}
  </div>`;
}
const RAISE = { min: 120, max: MY.chips, step: 20, half: 300, pot: 540 };
let raiseAmt = RAISE.min;
function raiseHTML() {
  return `<div class="sheet" data-close="1"><div class="in">
    <div class="amt" id="amt">${raiseAmt}</div>
    <div class="sub">いくらにレイズしますか（最小 ${RAISE.min}）</div>
    <div class="presets">
      <button data-amt="${RAISE.min}">最小</button><button data-amt="${RAISE.half}">ポットの半分</button>
      <button data-amt="${RAISE.pot}">ポット</button><button data-amt="${RAISE.max}">全部</button>
    </div>
    <div class="pm"><button data-step="-1">−</button>
      <input type="range" id="slider" min="${RAISE.min}" max="${RAISE.max}" step="${RAISE.step}" value="${raiseAmt}">
      <button data-step="1">＋</button></div>
    <button class="go" data-act="raiseGo">${raiseAmt} にレイズ</button>
    <button class="cancel" data-close="1">やめる</button>
  </div></div>`;
}
function handShowHTML() {
  return `<div class="hand-view">
    <div class="me"><span class="nm">${MY.name}</span><span class="ch">690</span></div>
    <div class="minib">${BOARD_END.map((c) => card(c)).join('')}</div>
    <div class="waitmsg"><b>けん の勝ち（フルハウス）</b>あなたはツーペア（A と 7）<br>−60　次の勝負まで 5秒…</div>
    <div class="peek"><div class="cards">${MY.cards.map((c) => card(c)).join('')}</div></div>
  </div>`;
}

/* ---------- デモの場面切り替え ---------- */
const SCENES = {
  table: [['lobby', 'ロビー'], ['play', 'ゲーム中'], ['show', 'ショーダウン']],
  hand: [['join', '参加'], ['wait', '待ち'], ['other', '相手の番'], ['turn', '自分の番'], ['show', '勝負の結果']],
};
function demoBar() {
  const d = $('#demo');
  if (!view) { d.hidden = true; return; }
  d.hidden = false;
  d.innerHTML = SCENES[view].map(([k, l]) => `<button class="${k === scene ? 'on' : ''}" data-go="${view}:${k}">${l}</button>`).join('')
    + `<button data-home="1">⟲ 入口</button>`;
}

function render() {
  const app = $('#app');
  if (view === 'table') {
    if (!SCENES.table.some(([k]) => k === scene)) scene = 'lobby';
    app.innerHTML = scene === 'lobby' ? lobbyHTML() : scene === 'play' ? playHTML() : showHTML();
    if (scene === 'lobby' && typeof QRCode !== 'undefined') {
      const url = location.origin + location.pathname + '?v=hand&s=join&room=' + ROOM;
      new QRCode($('#qr'), { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
    }
  } else if (view === 'hand') {
    if (!SCENES.hand.some(([k]) => k === scene)) scene = 'join';
    app.innerHTML = scene === 'join' ? joinHTML() : scene === 'wait' ? waitHTML()
      : scene === 'show' ? handShowHTML() : handHTML(scene === 'turn');
  } else app.innerHTML = homeHTML();
  demoBar();
}

/* ---------- 操作 ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('button,[data-close]');
  if (!b) return;
  if (b.dataset.home) { view = ''; scene = ''; history.replaceState(null, '', location.pathname); render(); return; }
  if (b.dataset.go) { const [v, s] = b.dataset.go.split(':'); go(v, s); return; }
  if (b.dataset.close && e.target === b) { sheet = false; render(); return; }
  if (b.dataset.amt) { raiseAmt = +b.dataset.amt; render(); return; }
  if (b.dataset.step) { raiseAmt = Math.min(RAISE.max, Math.max(RAISE.min, raiseAmt + RAISE.step * +b.dataset.step)); render(); return; }
  const act = b.dataset.act;
  if (!act) return;
  clearTimeout(armTimer);
  if (act === 'fold' || act === 'allin') {
    if (armed === act) { armed = ''; toast(act === 'fold' ? 'フォールドしました' : 'オールイン！'); go('hand', 'other'); return; }
    armed = act; render();
    armTimer = setTimeout(() => { armed = ''; render(); }, 3000);
  } else if (act === 'call') { toast('コールしました'); go('hand', 'other'); }
  else if (act === 'raise') { armed = ''; sheet = true; raiseAmt = RAISE.min; render(); }
  else if (act === 'raiseGo') { const a = raiseAmt; sheet = false; toast(a + ' にレイズしました'); go('hand', 'other'); }
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'slider') return;
  raiseAmt = +e.target.value;
  $('#amt').textContent = raiseAmt;
  $('.sheet .go').textContent = raiseAmt + ' にレイズ';
});
// 押している間だけ手札を見せる
function setPeek(on) {
  if (peeking === on || !$('#peek')) return;
  peeking = on; render();
}
document.addEventListener('pointerdown', (e) => { if (e.target.closest('#peek')) setPeek(true); });
['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, () => setPeek(false)));
document.addEventListener('contextmenu', (e) => { if (e.target.closest('#peek')) e.preventDefault(); });

render();
