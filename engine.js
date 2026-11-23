/* ゲームの進行（テキサスホールデム）。通信や画面は持たない。親（iPad）だけが動かす */
(function (g) {
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const LEVELS = [[5, 10], [10, 20], [15, 30], [20, 40], [25, 50], [30, 60], [50, 100], [75, 150],
    [100, 200], [150, 300], [200, 400], [300, 600], [500, 1000], [1000, 2000]];

  function rnd(n) {
    if (g.crypto && g.crypto.getRandomValues) { const a = new Uint32Array(1); g.crypto.getRandomValues(a); return a[0] % n; }
    return Math.floor(Math.random() * n);
  }
  function newDeck() {
    const d = [];
    SUITS.forEach((s) => RANKS.forEach((r) => d.push(r + s)));
    for (let i = d.length - 1; i > 0; i--) { const j = rnd(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
    return d;
  }

  function createGame(settings) {
    return { settings: Object.assign({ stack: 1000, level: 1, blindUpMin: 0, rebuy: true, timeLimit: 60 }, settings),
      players: [], dealer: null, level: 0, levelStartedAt: 0, handNo: 0, hand: null, phase: 'lobby', log: [] };
  }
  const blinds = (G) => LEVELS[Math.min(G.level, LEVELS.length - 1)];
  const P = (G, id) => G.players.find((p) => p.id === id);
  const nm = (G, id) => (P(G, id) || {}).name || '？';
  function say(G, msg) { G.log.unshift(msg); G.log.length = Math.min(G.log.length, 30); }

  function addPlayer(G, id, name) {
    const p = P(G, id);
    if (p) { p.name = name; p.online = true; p.left = false; return p; }
    const np = { id, name, chips: G.settings.stack, online: true, left: false, sitOut: false, rebuys: 0, out: false };
    G.players.push(np);
    return np;
  }

  function startGame(G, now) {
    G.level = G.settings.level; G.levelStartedAt = now; G.startedAt = now;
    G.players.forEach((p) => { p.chips = G.settings.stack; p.rebuys = 0; p.out = false; });
    G.phase = 'between';
    return startHand(G, now);
  }

  /* ---------- 1回の勝負を始める ---------- */
  function startHand(G, now) {
    const s = G.settings;
    if (s.blindUpMin && now - G.levelStartedAt >= s.blindUpMin * 60000 && G.level < LEVELS.length - 1) {
      G.level++; G.levelStartedAt = now; say(G, `ブラインドが ${blinds(G).join('/')} に上がりました`);
    }
    const elig = G.players.filter((p) => !p.left && !p.out && !p.sitOut && p.chips > 0);
    if (elig.length < 2) return false;
    // ディーラーを左へ1つ動かす（前のディーラーがいなければ先頭）
    const order = G.players.filter((p) => elig.includes(p));
    let di = 0;
    if (G.dealer) {
      const all = G.players, from = all.findIndex((p) => p.id === G.dealer);
      for (let k = 1; k <= all.length; k++) { const c = all[(from + k) % all.length]; if (elig.includes(c)) { di = order.indexOf(c); break; } }
    }
    const ids = order.slice(di).concat(order.slice(0, di)).map((p) => p.id); // 先頭がディーラー
    G.dealer = ids[0];
    const [sbAmt, bbAmt] = blinds(G);
    const h = { ids, deck: newDeck(), board: [], hole: {}, bet: {}, contrib: {}, folded: {}, allin: {}, acted: {}, seen: {},
      street: 0, cur: bbAmt, minRaise: bbAmt, raiseCount: 0, bbAmt, toAct: null, result: null, shown: {} };
    ids.forEach((id) => { h.bet[id] = 0; h.contrib[id] = 0; });
    G.hand = h; G.phase = 'hand'; G.handNo++;
    h.sb = ids.length === 2 ? ids[0] : ids[1];
    h.bb = ids.length === 2 ? ids[1] : ids[2];
    pay(G, h.sb, Math.min(sbAmt, P(G, h.sb).chips));
    pay(G, h.bb, Math.min(bbAmt, P(G, h.bb).chips));
    for (let r = 0; r < 2; r++) ids.forEach((id) => { (h.hole[id] = h.hole[id] || []).push(h.deck.pop()); });
    say(G, `第${G.handNo}ゲーム開始（ブラインド ${sbAmt}/${bbAmt}）`);
    // プリフロップはBBの左から（2人ならディーラー＝SBから）
    h.toAct = ids.length === 2 ? nextActor(h, ids.indexOf(h.bb)) : nextActor(h, ids.indexOf(h.bb));
    if (!h.toAct) return finishRound(G);
    return true;
  }

  function pay(G, id, amt) {
    const p = P(G, id), h = G.hand;
    amt = Math.min(amt, p.chips);
    p.chips -= amt; h.bet[id] += amt; h.contrib[id] += amt;
    if (p.chips === 0) h.allin[id] = true;
  }
  const canAct = (h, id) => !h.folded[id] && !h.allin[id];
  const needs = (h, id) => canAct(h, id) && (!h.acted[id] || h.bet[id] < h.cur);
  function nextActor(h, fromIdx) {
    const n = h.ids.length;
    for (let k = 1; k <= n; k++) { const id = h.ids[(fromIdx + k) % n]; if (needs(h, id)) return id; }
    return null;
  }
  const live = (h) => h.ids.filter((id) => !h.folded[id]);

  /* ---------- 今できること（スマホに出すボタン） ---------- */
  function options(G, id) {
    const h = G.hand;
    if (!h || G.phase !== 'hand' || h.toAct !== id) return null;
    const p = P(G, id);
    const toCall = Math.min(h.cur - h.bet[id], p.chips);
    const maxTo = h.bet[id] + p.chips;
    const canRaise = p.chips > h.cur - h.bet[id] && (!h.acted[id] || h.seen[id] < h.raiseCount);
    const minTo = Math.min(maxTo, h.cur === 0 ? h.bbAmt : h.cur + h.minRaise);
    const pot = potTotal(h) + toCall;
    const clamp = (v) => Math.max(minTo, Math.min(maxTo, Math.round(v)));
    return { toCall, canCheck: h.cur - h.bet[id] <= 0, canRaise, minTo, maxTo, cur: h.cur, myBet: h.bet[id],
      halfTo: clamp(h.cur + pot / 2), potTo: clamp(h.cur + pot), step: Math.max(1, Math.floor(h.bbAmt / 2)) };
  }
  const potTotal = (h) => h.ids.reduce((a, id) => a + h.contrib[id], 0);

  /* ---------- 行動する ---------- */
  // type: fold | check | call | raise | allin。raise の amount は「この段階での合計の賭け額」
  function act(G, id, type, amount) {
    const h = G.hand, o = options(G, id);
    if (!o) return 'あなたの番ではありません';
    const p = P(G, id), name = p.name;
    if (type === 'check' && !o.canCheck) type = 'call';
    if (type === 'fold') { h.folded[id] = true; say(G, `${name} フォールド`); }
    else if (type === 'check') say(G, `${name} チェック`);
    else if (type === 'call') { pay(G, id, o.toCall); say(G, o.toCall ? `${name} コール ${o.toCall}` + (h.allin[id] ? '（オールイン）' : '') : `${name} チェック`); }
    else if (type === 'raise' || type === 'allin') {
      let to = type === 'allin' ? o.maxTo : Math.round(+amount || 0);
      if (type === 'raise') {
        if (!o.canRaise) return 'レイズはできません';
        if (to < o.minTo) return `最小 ${o.minTo} からです`;
        to = Math.min(to, o.maxTo);
      }
      if (to <= h.cur) { pay(G, id, to - h.bet[id]); say(G, `${name} オールイン ${to}`); }
      else {
        const inc = to - h.cur;
        if (inc >= h.minRaise || h.cur === 0 && to >= h.bbAmt) { h.minRaise = Math.max(inc, h.bbAmt); h.raiseCount++; }
        const was = h.cur;
        h.cur = to;
        pay(G, id, to - h.bet[id]);
        say(G, h.allin[id] ? `${name} オールイン ${to}` : was === 0 ? `${name} ${to} をベット` : `${name} ${to} にレイズ`);
      }
    } else return '分からない操作です';
    h.acted[id] = true; h.seen[id] = h.raiseCount;
    advance(G, id);
    return '';
  }
  function autoAct(G) {
    const h = G.hand; if (!h || !h.toAct) return;
    const o = options(G, h.toAct);
    act(G, h.toAct, o.canCheck ? 'check' : 'fold');
  }

  function advance(G, lastId) {
    const h = G.hand;
    if (live(h).length === 1) return endHand(G, false);
    const nxt = nextActor(h, h.ids.indexOf(lastId));
    if (nxt) { h.toAct = nxt; return; }
    finishRound(G);
  }

  // 賭けが揃った：返す分を返して、次の段階か勝負へ
  function finishRound(G) {
    const h = G.hand;
    refundUncalled(G);
    if (live(h).length === 1) return endHand(G, false);
    const active = h.ids.filter((id) => canAct(h, id));
    if (h.street === 3 || active.length <= 1) {
      while (h.board.length < 5) h.board.push(h.deck.pop());
      h.street = 3;
      return endHand(G, true);
    }
    h.street++;
    const n = h.street === 1 ? 3 : 1;
    for (let i = 0; i < n; i++) h.board.push(h.deck.pop());
    h.ids.forEach((id) => { h.bet[id] = 0; });
    h.cur = 0; h.minRaise = h.bbAmt; h.raiseCount = 0; h.acted = {}; h.seen = {};
    say(G, ['', 'フロップ', 'ターン', 'リバー'][h.street] + '：' + h.board.join(' '));
    h.toAct = nextActor(h, 0); // ディーラーの左から
    if (!h.toAct) finishRound(G);
  }

  function refundUncalled(G) {
    const h = G.hand;
    const sorted = h.ids.slice().sort((a, b) => h.bet[b] - h.bet[a]);
    const top = sorted[0], second = sorted[1];
    const diff = h.bet[top] - (second ? h.bet[second] : 0);
    if (diff > 0) {
      const p = P(G, top);
      p.chips += diff; h.bet[top] -= diff; h.contrib[top] -= diff;
      if (p.chips > 0) h.allin[top] = false;
    }
  }

  // 分けたポット：額の小さいオールインごとに区切る
  function pots(h) {
    const lv = live(h);
    const levels = [...new Set(lv.map((id) => h.contrib[id]))].filter((v) => v > 0).sort((a, b) => a - b);
    const res = []; let prev = 0;
    levels.forEach((L) => {
      const amount = h.ids.reduce((a, id) => a + Math.min(h.contrib[id], L) - Math.min(h.contrib[id], prev), 0);
      res.push({ amount, elig: lv.filter((id) => h.contrib[id] >= L) });
      prev = L;
    });
    const rest = potTotal(h) - res.reduce((a, p) => a + p.amount, 0);
    if (rest > 0 && res.length) res[res.length - 1].amount += rest;
    return res;
  }

  /* ---------- 勝負の結果 ---------- */
  function endHand(G, showdown) {
    const h = G.hand;
    h.toAct = null;
    const won = {}; const potsOut = []; const hands = {};
    const lv = live(h);
    if (!showdown) {
      const total = potTotal(h);
      won[lv[0]] = total; potsOut.push({ amount: total, winners: [lv[0]] });
      say(G, `${nm(G, lv[0])} の勝ち ＋${total}`);
    } else {
      lv.forEach((id) => { hands[id] = g.PokerEval.evaluate(h.hole[id].concat(h.board)); h.shown[id] = true; });
      const clockwise = h.ids.slice(1).concat(h.ids[0]); // ディーラーの左から時計回り
      pots(h).forEach((pt) => {
        let best = [];
        pt.elig.forEach((id) => {
          if (!best.length) best = [id];
          else { const c = g.PokerEval.compare(hands[id], hands[best[0]]); if (c > 0) best = [id]; else if (c === 0) best.push(id); }
        });
        best.sort((a, b) => clockwise.indexOf(a) - clockwise.indexOf(b));
        const share = Math.floor(pt.amount / best.length);
        let odd = pt.amount - share * best.length;
        best.forEach((id) => { won[id] = (won[id] || 0) + share + (odd > 0 ? 1 : 0); if (odd > 0) odd--; });
        potsOut.push({ amount: pt.amount, winners: best });
      });
      Object.keys(won).forEach((id) => say(G, `${nm(G, id)} の勝ち ＋${won[id]}（${hands[id].name}）`));
    }
    Object.keys(won).forEach((id) => { P(G, id).chips += won[id]; });
    const rebought = [];
    h.ids.forEach((id) => {
      const p = P(G, id);
      if (p.chips > 0) return;
      if (G.settings.rebuy) { p.chips = G.settings.stack; p.rebuys++; rebought.push(id); say(G, `${p.name} チップをもう一度もらいました`); }
      else { p.out = true; say(G, `${p.name} 脱落`); }
    });
    h.result = { showdown, won, pots: potsOut, rebought,
      hands: Object.fromEntries(Object.entries(hands).map(([id, v]) => [id, { name: v.name, detail: v.detail }])) };
    G.phase = 'between';
  }

  /* ---------- 画面に送る形 ---------- */
  function publicView(G) {
    const h = G.hand, [sb, bb] = blinds(G);
    const players = G.players.filter((p) => !p.left || (h && h.ids.includes(p.id) && G.phase === 'hand')).map((p) => {
      const inHand = h && h.ids.includes(p.id);
      return { id: p.id, name: p.name, chips: p.chips, online: p.online, sitOut: p.sitOut, out: p.out, rebuys: p.rebuys,
        inHand, bet: inHand ? h.bet[p.id] : 0, folded: inHand && !!h.folded[p.id], allin: inHand && !!h.allin[p.id],
        dealer: inHand && G.dealer === p.id, pos: inHand ? (h.sb === p.id ? 'SB' : h.bb === p.id ? 'BB' : '') : '',
        hole: inHand && h.shown[p.id] ? h.hole[p.id] : null };
    });
    const v = { phase: G.phase, handNo: G.handNo, blinds: [sb, bb], level: G.level, settings: G.settings,
      levelStartedAt: G.levelStartedAt, startedAt: G.startedAt || 0, players, log: G.log.slice(0, 6) };
    if (h) Object.assign(v, { board: h.board, street: h.street, toAct: h.toAct, pot: potTotal(h),
      pots: pots(h).map((p) => p.amount), result: h.result });
    return v;
  }
  function privateView(G, id) {
    const h = G.hand, p = P(G, id);
    const me = { id, chips: p ? p.chips : 0, sitOut: p ? p.sitOut : false };
    if (h && h.hole[id]) {
      me.hole = h.hole[id];
      me.made = g.PokerEval.evaluate(h.hole[id].concat(h.board));
      me.folded = !!h.folded[id];
    }
    me.options = options(G, id);
    return me;
  }

  g.PokerEngine = { createGame, addPlayer, startGame, startHand, act, autoAct, options, publicView, privateView, pots, LEVELS, blinds };
})(typeof window !== 'undefined' ? window : globalThis);
