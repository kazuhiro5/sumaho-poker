/* 画面：スマホ（手札と操作）と、すべてのボタンの処理 */
const PH = { peeking: false, sheet: false, armed: '', armTimer: null, amt: 0, leaveArmed: false };

UI.phoneHTML = (S, ME) => {
  const me = S.players.find((p) => p.id === myId) || { name: N.name, chips: 0 };
  const o = ME && ME.options;
  const head = `<div class="me"><span class="nm">${esc(me.name)}</span><span class="ch">${num(me.chips)}</span></div>`;
  const foot = `<div class="subrow"><span>部屋 ${esc(S.room)} ／ ${S.phase === 'lobby' ? '待機中' : `ブラインド ${S.blinds[0]}/${S.blinds[1]}`}</span>
    <span>${S.phase !== 'lobby' ? `<button data-do="sitout">${me.sitOut ? '席に戻る' : '離席する'}</button>` : ''}
    <button data-do="leave">${PH.leaveArmed ? 'もう一度で退出' : '退出する'}</button></span></div>`;

  if (S.phase === 'lobby') {
    const i = S.players.findIndex((p) => p.id === myId);
    return `<div class="hand-view">${head}<div class="waitmsg"><b>席${i + 1}に座りました</b>iPadの「スタート」を待っています<br>参加 ${S.players.length}人</div>${foot}</div>`;
  }
  if (!ME || !ME.hole) {
    const msg = me.out ? 'チップがなくなりました。見て楽しんでください' : me.sitOut ? '離席中です。「席に戻る」で次のゲームから入ります' : '次のゲームから入ります';
    return `<div class="hand-view">${head}<div class="minib">${boardHTML(S.board)}</div><div class="waitmsg"><b>${msg}</b></div>${foot}</div>`;
  }
  const r = S.result;
  if (S.phase !== 'hand' && r) {
    const ws = Object.keys(r.won);
    const myWin = r.won[myId], h = r.hands && r.hands[ws[0]], mine = r.hands && r.hands[myId];
    return `<div class="hand-view">${head}<div class="minib">${boardHTML(S.board)}</div>
      <div class="waitmsg"><b>${myWin ? `あなたの勝ち ＋${num(myWin)}` : `${ws.map((id) => esc(nameOf(S, id))).join('・')} の勝ち`}</b>
        ${h ? h.name : 'ほかの人が全員降りました'}${mine && !myWin ? `<br>あなたは ${mine.name}` : ''}
        ${r.rebought && r.rebought.includes(myId) ? '<br>チップをもう一度もらいました' : ''}</div>
      <div class="peek"><div class="cards">${ME.hole.map((c) => card(c)).join('')}</div></div>${foot}</div>`;
  }
  const faces = PH.peeking ? ME.hole.map((c) => card(c)).join('') : card('back') + card('back');
  let status;
  if (ME.folded) status = '降りました。次のゲームを待っています';
  else if (o) status = o.toCall ? `あなたの番です　コールに必要 <b>${num(o.toCall)}</b>` : 'あなたの番です';
  else if (S.toAct) status = `${esc(nameOf(S, S.toAct))} の番です`;
  else status = '';
  const dis = o ? '' : 'disabled';
  const callLabel = !o ? 'コール' : o.canCheck ? 'チェック' : `コール ${num(o.toCall)}`;
  const raiseLabel = o && o.cur === 0 ? 'ベット' : 'レイズ';
  return `<div class="hand-view ${o ? 'myturn' : ''}">${head}
    <div class="minib">${boardHTML(S.board)}</div>
    <div class="peek" id="peek">
      <div class="cards">${faces}</div>
      <div class="made">${PH.peeking && ME.made ? ME.made.name : ''}</div>
      <div class="hint">${PH.peeking ? '指を離すと隠れます' : '押している間だけ手札が見えます'}</div>
    </div>
    <div class="status">${status}${o && S.deadline ? `（残り <b data-until="${S.deadline}" data-sec="1">--</b>秒）` : ''}</div>
    <div class="acts">
      <button class="f ${PH.armed === 'fold' ? 'arm' : ''}" data-act="fold" ${dis}>${PH.armed === 'fold' ? (o && o.canCheck ? 'チェックできます。降りる？' : 'もう一度で降りる') : 'フォールド'}</button>
      <button class="k" data-act="call" ${dis}>${callLabel}</button>
      <button class="r" data-act="raise" ${o && o.canRaise ? '' : 'disabled'}>${raiseLabel}</button>
      <button class="a ${PH.armed === 'allin' ? 'arm' : ''}" data-act="allin" ${dis}>${PH.armed === 'allin' ? 'もう一度で全部' : 'オールイン'}</button>
    </div>
    ${foot}
    ${PH.sheet && o ? raiseSheetHTML(o) : ''}
  </div>`;
};
function raiseSheetHTML(o) {
  return `<div class="sheet" data-close="1"><div class="in">
    <div class="amt" id="amt">${num(PH.amt)}</div>
    <div class="sub">いくらに${o.cur === 0 ? 'ベット' : 'レイズ'}しますか（最小 ${num(o.minTo)}）</div>
    <div class="presets">
      <button data-amt="${o.minTo}">最小</button><button data-amt="${o.halfTo}">ポットの半分</button>
      <button data-amt="${o.potTo}">ポット</button><button data-amt="${o.maxTo}">全部</button>
    </div>
    <div class="pm"><button data-step="-1">−</button>
      <input type="range" id="slider" min="${o.minTo}" max="${o.maxTo}" step="1" value="${PH.amt}">
      <button data-step="1">＋</button></div>
    <button class="go" data-act="raiseGo">${num(PH.amt)} に${o.cur === 0 ? 'ベット' : 'レイズ'}</button>
    <button class="cancel" data-close="1">やめる</button>
  </div></div>`;
}

UI.myTurnAlert = () => {
  UI.beep([660, 880]);
  try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) { /* iPhoneは振動なし */ }
  PH.armed = ''; PH.sheet = false;
};

/* ---------- ボタンの処理 ---------- */
document.addEventListener('click', (e) => {
  const b = e.target.closest('button,[data-close]');
  if (!b) return;
  const d = b.dataset;
  if (d.close) { if (e.target === b) { PH.sheet = false; UI.menu = false; UI.render(); } return; }
  // 入口
  if (d.do === 'join') {
    const room = ($('#room').value || '').replace(/\D/g, '').slice(0, 4), name = ($('#name').value || '').trim().slice(0, 8);
    if (room.length !== 4) return UI.toast('部屋番号は4桁です');
    if (!name) return UI.toast('名前を入れてください');
    UI.unlockAudio(); clientJoin(room, name); return;
  }
  if (d.do === 'create') { UI.unlockAudio(); store.del('sp-host'); hostCreate(); return; }
  if (d.do === 'resume') { UI.unlockAudio(); hostCreate(JSON.parse(store.get('sp-host'))); return; }
  if (d.do === 'home') { location.href = location.pathname; return; }
  if (d.do === 'mute') { muted = !muted; store.set('sp-mute', muted ? '1' : '0'); UI.render(); return; }
  // 親（iPad）
  if (N.role === 'host') {
    const G = N.G;
    if (d.kick) { if (confirmTwice(b, '外す？')) { hostKick(d.kick); } return; }
    if (d.add) { const p = G.players.find((x) => x.id === d.add); if (p) { p.chips += G.settings.stack; p.rebuys++; p.out = false; } hostAfter(); return; }
    if (d.do === 'start') { PokerEngine.startGame(G, Date.now()); UI.beep([523, 659, 784]); hostAfter(); return; }
    if (d.do === 'menu') { UI.menu = true; UI.render(); return; }
    if (d.do === 'pause') { N.paused = !N.paused; UI.menu = false; hostAfter(); return; }
    if (d.do === 'levelup') { if (G.level < PokerEngine.LEVELS.length - 1) G.level++; G.levelStartedAt = Date.now(); UI.toast('次のゲームから ' + PokerEngine.LEVELS[G.level].join('/')); hostAfter(); return; }
    if (d.do === 'nexthand') { UI.menu = false; if (!PokerEngine.startHand(G, Date.now())) UI.toast('遊べる人が2人未満です'); hostAfter(); return; }
    if (d.do === 'end') { if (confirmTwice(b, 'もう一度で終わる')) { G.phase = 'end'; UI.menu = false; store.del('sp-host'); clearTimeout(N.timers.turn); clearTimeout(N.timers.next); hostSync(); } return; }
    return;
  }
  // 子（スマホ）
  if (d.do === 'sitout') { const me = N.S.players.find((p) => p.id === myId); clientSend({ t: 'sitout', on: !(me && me.sitOut) }); return; }
  if (d.do === 'leave') {
    if (PH.leaveArmed) { leaveRoom(); return; }
    PH.leaveArmed = true; UI.render(); setTimeout(() => { PH.leaveArmed = false; UI.render(); }, 5000); return;
  }
  const o = N.ME && N.ME.options;
  if (d.amt && o) { PH.amt = +d.amt; UI.render(); return; }
  if (d.step && o) { PH.amt = Math.min(o.maxTo, Math.max(o.minTo, PH.amt + o.step * +d.step)); UI.render(); return; }
  const act = d.act;
  if (!act || !o) return;
  clearTimeout(PH.armTimer);
  if (act === 'fold' || act === 'allin') {
    if (PH.armed === act) { PH.armed = ''; clientSend({ t: 'act', type: act }); return; }
    PH.armed = act; UI.render();
    PH.armTimer = setTimeout(() => { PH.armed = ''; UI.render(); }, 3000);
  } else if (act === 'call') { PH.armed = ''; clientSend({ t: 'act', type: o.canCheck ? 'check' : 'call' }); }
  else if (act === 'raise') { PH.armed = ''; PH.sheet = true; PH.amt = o.minTo; UI.render(); }
  else if (act === 'raiseGo') { PH.sheet = false; clientSend({ t: 'act', type: PH.amt >= o.maxTo ? 'allin' : 'raise', amount: PH.amt }); }
});
// 2回押しで決める（外す・終わる）
function confirmTwice(b, label) {
  if (b.dataset.armed) return true;
  const old = b.textContent; b.dataset.armed = '1'; b.textContent = label;
  setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = old; } }, 3000);
  return false;
}
document.addEventListener('change', (e) => {
  const k = e.target.dataset.set;
  if (!k || N.role !== 'host') return;
  N.G.settings[k] = k === 'rebuy' ? e.target.value === '1' : +e.target.value;
  N.G.players.forEach((p) => { p.chips = N.G.settings.stack; });
  hostSync();
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'slider') return;
  PH.amt = +e.target.value;
  $('#amt').textContent = num(PH.amt);
  const o = N.ME.options;
  $('.sheet .go').textContent = num(PH.amt) + ' に' + (o.cur === 0 ? 'ベット' : 'レイズ');
});
// 押している間だけ手札を見せる
function setPeek(on) { if (PH.peeking === on || !$('#peek')) return; PH.peeking = on; if (on) UI.flip(1, 0.25); UI.render(); }
document.addEventListener('pointerdown', (e) => { if (e.target.closest('#peek')) setPeek(true); });
['pointerup', 'pointercancel'].forEach((t) => document.addEventListener(t, () => setPeek(false)));
document.addEventListener('contextmenu', (e) => { if (e.target.closest('#peek')) e.preventDefault(); });

if (typeof Peer === 'undefined') UI.fail('通信の部品を読み込めませんでした。ページを読み込み直してください。');
else UI.render();
