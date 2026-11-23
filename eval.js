/* 役の判定：7枚（手札2＋場5）から一番強い5枚の役を出す。カードは 'A♠' のような文字列 */
(function (g) {
  const RANKS = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
  const NAMES = ['ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート', 'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ', 'ロイヤルストレートフラッシュ'];
  const LABEL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J' };
  const lb = (v) => LABEL[v] || String(v);

  function parse(c) { return { v: RANKS[c.slice(0, -1)], s: c.slice(-1) }; }

  // 並んだ数字の中から一番高いストレートの頭を返す（A-2-3-4-5は5）。なければ0
  function straightHigh(vals) {
    const set = new Set(vals);
    if (set.has(14)) set.add(1);
    for (let h = 14; h >= 5; h--) {
      let ok = true;
      for (let k = 0; k < 5; k++) if (!set.has(h - k)) { ok = false; break; }
      if (ok) return h;
    }
    return 0;
  }

  // 戻り値：{ cat: 0〜9, key: [比べる数字…], name: '役の名前', detail: '説明' }
  function evaluate(cards) {
    const cs = cards.map(parse);
    const bySuit = {};
    cs.forEach((c) => { (bySuit[c.s] = bySuit[c.s] || []).push(c.v); });
    const flushSuit = Object.keys(bySuit).find((s) => bySuit[s].length >= 5);
    if (flushSuit) {
      const sh = straightHigh(bySuit[flushSuit]);
      if (sh) return sh === 14
        ? { cat: 9, key: [14], name: NAMES[9], detail: '' }
        : { cat: 8, key: [sh], name: NAMES[8], detail: lb(sh) + 'が一番上' };
    }
    const count = {};
    cs.forEach((c) => { count[c.v] = (count[c.v] || 0) + 1; });
    // 枚数の多い順→数字の高い順
    const groups = Object.keys(count).map(Number).sort((a, b) => count[b] - count[a] || b - a);
    const vals = cs.map((c) => c.v).sort((a, b) => b - a);
    const kick = (ex, n) => vals.filter((v) => !ex.includes(v)).filter((v, i, a) => a.indexOf(v) === i).slice(0, n);

    if (count[groups[0]] === 4) {
      const q = groups[0];
      return { cat: 7, key: [q, ...kick([q], 1)], name: NAMES[7], detail: lb(q) + 'が4枚' };
    }
    const trips = groups.filter((v) => count[v] === 3);
    const pairs = groups.filter((v) => count[v] === 2);
    if (trips.length && (trips.length > 1 || pairs.length)) {
      const t = trips[0];
      const p = Math.max(trips[1] || 0, pairs[0] || 0);
      return { cat: 6, key: [t, p], name: NAMES[6], detail: `${lb(t)} 3枚＋${lb(p)} 2枚` };
    }
    if (flushSuit) {
      const f = bySuit[flushSuit].sort((a, b) => b - a).slice(0, 5);
      return { cat: 5, key: f, name: NAMES[5], detail: lb(f[0]) + 'が一番上' };
    }
    const sh = straightHigh(vals);
    if (sh) return { cat: 4, key: [sh], name: NAMES[4], detail: lb(sh) + 'が一番上' };
    if (trips.length) {
      const t = trips[0];
      return { cat: 3, key: [t, ...kick([t], 2)], name: NAMES[3], detail: lb(t) + 'が3枚' };
    }
    if (pairs.length >= 2) {
      const [a, b] = pairs;
      return { cat: 2, key: [a, b, ...kick([a, b], 1)], name: NAMES[2], detail: `${lb(a)} と ${lb(b)}` };
    }
    if (pairs.length === 1) {
      const p = pairs[0];
      return { cat: 1, key: [p, ...kick([p], 3)], name: NAMES[1], detail: lb(p) };
    }
    return { cat: 0, key: vals.slice(0, 5), name: NAMES[0], detail: lb(vals[0]) + 'が一番上' };
  }

  // a が強ければ正、弱ければ負、同じなら0
  function compare(a, b) {
    if (a.cat !== b.cat) return a.cat - b.cat;
    for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
      const d = (a.key[i] || 0) - (b.key[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  g.PokerEval = { evaluate, compare, NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
