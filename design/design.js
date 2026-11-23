/* デザイン比較のデモ（通信なし）。1＝今のデザイン／2＝チップ版／3＝リアル版。テーブル（iPad）と手札（スマホ）を切り替える */
const qs = new URLSearchParams(location.search);
let D = qs.get('d') || '1';
let V = qs.get('v') || (innerWidth < 700 ? 'hand' : 'table');
const $ = (q) => document.querySelector(q);
const num = (n) => Number(n).toLocaleString('ja-JP');

/* ---------- デモ用のデータ ---------- */
const BOARD = ['A♠', 'K♥', '7♦'];
const SEATS = [
  { name: 'さき', chips: 750, turn: true },
  { name: 'たく', chips: 1500, pos: 'SB' },
  { name: 'みお', chips: 2100, pos: 'BB' },
  { name: 'あき', chips: 980, dealer: true },
  { name: 'けん', chips: 1140, bet: 60 },
  { name: 'ゆう', chips: 860, folded: true },
];
const POT = 420;

/* ---------- 部品 ---------- */
function card(code) {
  if (!code) return '<span class="c empty"></span>';
  if (code === 'back') return '<span class="c back"></span>';
  const s = code.slice(-1), rk = code.slice(0, -1);
  return `<span class="c ${s === '♥' || s === '♦' ? 'r' : ''}"><span class="rk">${rk}</span><span class="st">${s}</span></span>`;
}
// チップの額と色（白1・赤5・青10・緑25・黒100・紫500・黄1000）
const DENOMS = [[1000, 'k1000'], [500, 'k500'], [100, 'k100'], [25, 'k25'], [10, 'k10'], [5, 'k5'], [1, 'k1']];
// 額を、大きい額のチップから順に分ける。1列の枚数と列の数に上限をつける
function chipCols(amount, perCol = 8, maxCols = 3) {
  const cols = [];
  let rest = amount;
  for (const [v, cls] of DENOMS) {
    let n = Math.floor(rest / v);
    if (!n) continue;
    rest -= n * v;
    while (n > 0 && cols.length < maxCols) { const k = Math.min(n, perCol); cols.push({ cls, k }); n -= k; }
  }
  return cols.slice(0, maxCols);
}
function stackHTML(amount, size = 'm', label = true) {
  if (D === '1') return `<span class="numbadge">${num(amount)}</span>`;
  const cols = chipCols(amount, size === 's' ? 5 : 8, size === 'l' ? 4 : 3);
  const colHTML = cols.map(({ cls, k }) => `<span class="col" style="--n:${k}">${Array.from({ length: k }, (_, i) =>
    `<i class="chip ${cls}" style="--i:${i}"></i>`).join('')}</span>`).join('');
  return `<span class="stack ${size}"><span class="cols">${colHTML}</span>${label ? `<b class="amt">${num(amount)}</b>` : ''}</span>`;
}

/* ---------- iPad：テーブル ---------- */
function seatHTML(p, i, n) {
  const a = (90 + (360 / n) * i) * Math.PI / 180;
  const x = 50 + 41 * Math.cos(a), y = 50 + 40 * Math.sin(a);
  const cls = ['seat'];
  if (p.folded) cls.push('folded');
  if (p.turn) cls.push('turn');
  const hole = p.folded ? '' : card('back') + card('back');
  const tag = p.folded ? 'フォールド' : p.pos || '';
  const ring = p.turn ? `<svg class="ring" viewBox="0 0 100 100" preserveAspectRatio="none"><rect x="2" y="2" width="96" height="96" rx="14" pathLength="100" style="--len:100;animation-duration:60s;animation-delay:-38s"/></svg>` : '';
  const bet = p.bet ? `<div class="bet ${D !== '1' ? 'betstack' : ''}" style="${y < 50 ? 'top' : 'bottom'}:calc(100% + 8px)">${D === '1' ? num(p.bet) : stackHTML(p.bet, 's')}</div>` : '';
  const chips = D === '1' ? `<div class="ch">${num(p.chips)}</div>` : `<div class="ch">${stackHTML(p.chips, 'm')}</div>`;
  return `<div class="${cls.join(' ')}" style="left:${x}%;top:${y}%">
    <div class="hole">${hole}</div>
    <div class="box">${ring}${p.dealer ? '<div class="btn-d">D</div>' : ''}
      <div class="nm">${p.name}</div>${chips}<div class="tag">${tag}</div>
    </div>${bet}</div>`;
}
function tableHTML() {
  const board = [0, 1, 2, 3, 4].map((i) => card(BOARD[i])).join('');
  const pot = D === '1' ? `<div class="pot">ポット ${num(POT)}</div>` : `<div class="pot potstack">${stackHTML(POT, 'l', false)}<span>ポット <b>${num(POT)}</b></span></div>`;
  return `<div class="table-view">
    <div class="corner-l"><span class="pill big">ブラインド 10 / 20</span></div>
    <div class="corner-r"><button class="icon">☰</button></div>
    <div class="stage"><div class="felt"><div class="feltmark">${D === '3' ? 'TEXAS HOLD’EM' : ''}</div></div>
      ${SEATS.map((p, i) => seatHTML(p, i, SEATS.length)).join('')}
      <div class="center"><div class="board">${board}</div>${pot}</div>
    </div>
    <div class="ginfo"><b>第12ゲーム</b><span class="lbl">前回</span><span class="plus">みお ＋240</span><span class="minus">たく −120</span><span class="minus">ゆう −120</span></div>
    <div class="ctimer turn hurry"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="44"/><circle class="fg" cx="50" cy="50" r="44" pathLength="100" style="stroke-dashoffset:88"/></svg><b>7</b><small></small></div>
  </div>`;
}

/* ---------- スマホ：手札と操作 ---------- */
let peeking = false;
function handHTML() {
  const faces = peeking ? card('A♥') + card('Q♥') : card('back') + card('back');
  const side = D === '1'
    ? `<div class="side"><div><small>ポット</small><b>${num(POT)}</b></div><div class="mine"><small>手元のチップ</small><b>750</b></div></div>`
    : `<div class="side chipside"><div><small>ポット</small>${stackHTML(POT, 'm')}</div><div class="mine"><small>手元のチップ</small>${stackHTML(750, 'm')}</div></div>`;
  return `<div class="hand-view myturn">
    <div class="me"><span class="bl">ブラインド 10 / 20</span><span class="who"><span class="nm">さき</span><button class="mbtn">☰</button></span></div>
    <div class="peek" id="peek"><div class="cards">${faces}</div>
      <div class="made">${peeking ? 'ワンペア' : ''}</div><div class="hint">${peeking ? '指を離すと隠れます' : '押している間だけ手札が見えます'}</div></div>
    <div class="status">あなたの番です　コールに必要 <b>60</b></div>
    <div class="play"><div class="acts">
      <button class="k">コール 60</button><button class="r">レイズ</button><button class="a">オールイン</button><button class="f">フォールド</button>
    </div>${side}</div>
  </div>`;
}

/* ---------- 切り替え ---------- */
const NAMES = { 1: '1. 今のデザイン', 2: '2. チップ版', 3: '3. リアル版' };
function render() {
  document.body.className = 'd' + D;
  $('#app').innerHTML = V === 'table' ? tableHTML() : handHTML();
  $('#pick').innerHTML = ['1', '2', '3'].map((k) => `<button class="${k === D ? 'on' : ''}" data-d="${k}">${NAMES[k]}</button>`).join('')
    + `<span class="sep"></span><button class="${V === 'table' ? 'on' : ''}" data-v="table">iPad</button><button class="${V === 'hand' ? 'on' : ''}" data-v="hand">スマホ</button>`;
  const u = new URL(location.href); u.searchParams.set('d', D); u.searchParams.set('v', V); history.replaceState(null, '', u);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.d) { D = b.dataset.d; render(); }
  if (b.dataset.v) { V = b.dataset.v; render(); }
});
document.addEventListener('pointerdown', (e) => { if (e.target.closest('#peek')) { peeking = true; render(); } });
['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, () => { if (peeking) { peeking = false; render(); } }));
render();
