/*
 * board.js — 棋盘静态几何（不随对局变化）
 * 坐标系：12 行(r0..r11) × 5 列(c0..c4) = 60 格，idx = r*5 + c
 * 山界在 r5 与 r6 之间。几何依据 docs/规则说明.md §1（Q-1/D-1/D-2 已锁定）。
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.Junqi = root.Junqi || {};
  root.Junqi.Board = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ROWS = 12, COLS = 5, N = ROWS * COLS;

  const idx = (r, c) => r * COLS + c;
  const rc = (i) => ({ r: Math.floor(i / COLS), c: i % COLS });
  const inBounds = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

  // 特殊格位（规则说明 §1.2）
  const HQ = {
    black: [idx(0, 1), idx(0, 3)],
    red:   [idx(11, 1), idx(11, 3)],
  };
  const CAMP = [
    idx(2, 1), idx(2, 3), idx(3, 2), idx(4, 1), idx(4, 3),
    idx(7, 1), idx(7, 3), idx(8, 2), idx(9, 1), idx(9, 3),
  ];
  const campSet = new Set(CAMP);
  const hqSet = new Set([...HQ.black, ...HQ.red]);

  function cellType(i) {
    if (hqSet.has(i)) return 'hq';
    if (campSet.has(i)) return 'camp';
    return 'post';
  }

  // 铁路判定（§1.3 锁定版）：横向 r1/r5/r6/r10；纵向 c0/c4(r1..r10)；中线桥单独加边
  function isRail(r, c) {
    if (r === 1 || r === 5 || r === 6 || r === 10) return true;
    if ((c === 0 || c === 4) && r >= 1 && r <= 10) return true;
    return false;
  }

  const railAdj = Array.from({ length: N }, () => []);
  const roadAdj = Array.from({ length: N }, () => []);

  const addEdge = (adj, a, b) => { adj[a].push(b); adj[b].push(a); };

  // —— 铁路边 ——
  // 横向铁路行
  for (const r of [1, 5, 6, 10]) {
    for (let c = 0; c < COLS - 1; c++) addEdge(railAdj, idx(r, c), idx(r, c + 1));
  }
  // 纵向铁路列 c0 / c4（r1..r10 连续）
  for (const c of [0, 4]) {
    for (let r = 1; r < 10; r++) addEdge(railAdj, idx(r, c), idx(r + 1, c));
  }
  // 中线桥 (5,2)-(6,2)
  addEdge(railAdj, idx(5, 2), idx(6, 2));

  // —— 公路边 ——
  // 正交相邻（自然包含山界 c0..c4 五列全通）
  const ortho = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = idx(r, c);
      for (const [dr, dc] of ortho) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc)) addEdge(roadAdj, a, idx(nr, nc));
      }
    }
  }
  // 行营斜线（仅营地与其四个斜对角之间）
  const diag = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (const camp of CAMP) {
    const { r, c } = rc(camp);
    for (const [dr, dc] of diag) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc)) addEdge(roadAdj, camp, idx(nr, nc));
    }
  }

  const dedupe = (arr) => [...new Set(arr)];
  for (let i = 0; i < N; i++) { railAdj[i] = dedupe(railAdj[i]); roadAdj[i] = dedupe(roadAdj[i]); }

  return {
    ROWS, COLS, N, idx, rc, inBounds,
    HQ, CAMP, campSet, hqSet,
    cellType, isRail,
    railAdj, roadAdj,
    RAIL_ROWS: [1, 5, 6, 10],
    RAIL_COLS: [0, 4],
    BRIDGE: [idx(5, 2), idx(6, 2)],
    HQ_LINE: 5, // 山界在 r5/r6 之间
  };
});
