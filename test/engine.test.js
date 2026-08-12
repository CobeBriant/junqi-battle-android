const test = require('node:test');
const assert = require('node:assert');

const Board = require('../www/js/board.js');
const Pieces = require('../www/js/pieces.js');
const Engine = require('../www/js/engine.js');
const { idx } = Board;

function emptyHidden() {
  const s = Engine.createGame({ mode: 'hidden' });
  Engine._beginPlay(s);
  return s;
}
function mk(kind, side) { return { id: side + '-' + kind + '-x', side, kind, rank: Pieces.RANKS[kind], revealed: false, alive: true, cell: null }; }

// ——————————————————— 1. 棋盘几何 ———————————————————
test('铁路判定：横向行与纵向列正确', () => {
  assert.equal(Board.isRail(1, 2), true);
  assert.equal(Board.isRail(5, 0), true);
  assert.equal(Board.isRail(6, 4), true);
  assert.equal(Board.isRail(10, 3), true);
  assert.equal(Board.isRail(2, 2), false);  // 行营 (3,2) 不在铁路
  assert.equal(Board.isRail(3, 2), false);
});

test('中线桥 (5,2)-(6,2) 是铁路边', () => {
  const a = idx(5, 2), b = idx(6, 2);
  assert.ok(Board.railAdj[a].includes(b));
  assert.ok(Board.railAdj[b].includes(a));
});

test('山界公路五列全通（含 c1/c3）', () => {
  for (let c = 0; c < 5; c++) {
    assert.ok(Board.roadAdj[idx(5, c)].includes(idx(6, c)), `c${c} 应跨山界`);
  }
});

test('行营斜线仅营地有，且四向', () => {
  const camp = idx(3, 2);
  const diag = [[2, 1], [2, 3], [4, 1], [4, 3]].map(([r, c]) => idx(r, c));
  for (const d of diag) {
    assert.ok(Board.roadAdj[camp].includes(d), `营地应连斜向 ${d}`);
  }
  // 非营地的普通格不应有斜向公路
  const plain = idx(2, 2);
  for (const [r, c] of [[1, 1], [1, 3], [3, 1], [3, 3]]) {
    assert.ok(!Board.roadAdj[plain].includes(idx(r, c)), `普通格不应斜连 ${r},${c}`);
  }
});

// ——————————————————— 2. 吃子结算 ———————————————————
test('吃子表：大吃小 / 同级同归 / 工兵挖雷 / 炸弹 / 夺旗', () => {
  const R = Pieces.resolveCombat;
  assert.equal(R(mk('commander', 'black'), mk('colonel', 'red'), {}).outcome, 'attackerWins');
  assert.equal(R(mk('engineer', 'black'), mk('engineer', 'red'), {}).outcome, 'both');
  assert.equal(R(mk('engineer', 'black'), mk('mine', 'red'), {}).outcome, 'attackerWins'); // 工兵挖雷存活
  assert.equal(R(mk('lieutenant', 'black'), mk('mine', 'red'), {}).outcome, 'both');        // 默认双亡
  assert.equal(R(mk('lieutenant', 'black'), mk('mine', 'red'), { mineHitRule: 'attackerOnly' }).outcome, 'attackerDies');
  assert.equal(R(mk('bomb', 'black'), mk('commander', 'red'), {}).outcome, 'both');
  assert.equal(R(mk('bomb', 'black'), mk('mine', 'red'), {}).outcome, 'both');
  assert.equal(R(mk('sergeant', 'black'), mk('flag', 'red'), {}).flagCaptured, true);
});

// ——————————————————— 3. 走法 ———————————————————
test('公路一步：非铁路格的四向', () => {
  const s = emptyHidden();
  Engine._place(s, 'black-lieutenant-0', idx(2, 2), true);
  const mv = Engine.generateMoves(s, s.pieces['black-lieutenant-0']);
  assert.deepEqual(mv.sort((a, b) => a - b), [idx(1, 2), idx(2, 1), idx(2, 3), idx(3, 2)].sort((a, b) => a - b));
});

test('铁路直行：横向可达且被阻挡', () => {
  const s = emptyHidden();
  Engine._place(s, 'black-commander-0', idx(5, 0), true);
  let mv = Engine.generateMoves(s, s.pieces['black-commander-0']);
  assert.ok(mv.includes(idx(5, 4)), '空路应可长驱到 (5,4)');
  // 在 (5,2) 放敌子阻挡
  Engine._place(s, 'red-lieutenant-0', idx(5, 2), true);
  mv = Engine.generateMoves(s, s.pieces['black-commander-0']);
  assert.ok(mv.includes(idx(5, 1)), '可吃到阻挡子 (5,2)');
  assert.ok(!mv.includes(idx(5, 3)), '阻挡后不可越过 (5,3)');
  assert.ok(!mv.includes(idx(5, 4)), '阻挡后不可达 (5,4)');
});

test('工兵可转弯，非工兵不可（中线桥示例）', () => {
  // 非工兵：从 (5,0) 向下过桥到 (6,0)，但不能沿 r6 转去 (6,4)
  const s1 = emptyHidden();
  Engine._place(s1, 'black-commander-0', idx(5, 0), true);
  let mv = Engine.generateMoves(s1, s1.pieces['black-commander-0']);
  assert.ok(mv.includes(idx(6, 0)), '非工兵可过桥到 (6,0)');
  assert.ok(!mv.includes(idx(6, 4)), '非工兵不可过桥后转弯至 (6,4)');

  // 工兵：应能转弯到达 (6,4)
  const s2 = emptyHidden();
  Engine._place(s2, 'black-engineer-0', idx(5, 0), true);
  mv = Engine.generateMoves(s2, s2.pieces['black-engineer-0']);
  assert.ok(mv.includes(idx(6, 4)), '工兵可过桥转弯至 (6,4)');
});

test('行营保护：不可吃营内敌子，但可进空格营', () => {
  const s = emptyHidden();
  // 黑子 (2,2) 想动到营 (3,2)
  Engine._place(s, 'black-lieutenant-0', idx(2, 2), true);
  Engine._place(s, 'red-lieutenant-0', idx(3, 2), true); // 敌子在营内
  let mv = Engine.generateMoves(s, s.pieces['black-lieutenant-0']);
  assert.ok(!mv.includes(idx(3, 2)), '不能攻击营内敌子');

  // 营地空着时，斜向可进营
  const s2 = emptyHidden();
  Engine._place(s2, 'black-lieutenant-0', idx(2, 1), true);
  mv = Engine.generateMoves(s2, s2.pieces['black-lieutenant-0']);
  assert.ok(mv.includes(idx(3, 2)), '可斜进空格营');
});

test('大本营锁定：进入后不可再移动', () => {
  const s = emptyHidden();
  Engine._place(s, 'black-lieutenant-0', idx(1, 1), true);
  s.pieces['black-lieutenant-0'].enteredHQ = true;
  assert.deepEqual(Engine.generateMoves(s, s.pieces['black-lieutenant-0']), []);
});

test('地雷/军旗不可动', () => {
  const s = emptyHidden();
  Engine._place(s, 'black-mine-0', idx(2, 2), true);
  Engine._place(s, 'black-flag-0', idx(0, 1), true);
  assert.deepEqual(Engine.generateMoves(s, s.pieces['black-mine-0']), []);
  assert.deepEqual(Engine.generateMoves(s, s.pieces['black-flag-0']), []);
});

// ——————————————————— 4. 胜负 ———————————————————
test('夺旗即胜', () => {
  const s = emptyHidden();
  Engine._place(s, 'red-flag-0', idx(11, 1), true);     // 红军旗在红大本营
  Engine._place(s, 'black-lieutenant-0', idx(10, 1), true);
  Engine._setTurn(s, 'black');
  const r = Engine.applyAction(s, { type: 'move', pieceId: 'black-lieutenant-0', from: idx(10, 1), to: idx(11, 1) });
  assert.equal(r.ok, true);
  assert.equal(s.result.winner, 'black');
  assert.equal(s.result.reason, 'flag');
});

test('对方无合法行动则负', () => {
  const s = emptyHidden();
  // 红方只剩军旗（不可动）
  for (const p of Object.values(s.pieces)) if (p.side === 'red' && p.kind !== 'flag') { p.alive = false; }
  Engine._place(s, 'red-flag-0', idx(11, 1), true);
  Engine._place(s, 'black-lieutenant-0', idx(10, 1), true);
  Engine._setTurn(s, 'black');
  const r = Engine.applyAction(s, { type: 'move', pieceId: 'black-lieutenant-0', from: idx(10, 1), to: idx(10, 2) });
  assert.equal(r.ok, true);
  assert.equal(s.result.winner, 'black');
  assert.equal(s.result.reason, 'nomove');
});

// ——————————————————— 5. 视野隔离 ———————————————————
test('viewFor 隐藏对方未揭示棋子', () => {
  const s = emptyHidden();
  Engine._place(s, 'black-lieutenant-0', idx(5, 0), false);  // 己方暗子（暗棋模式下仍应对所有者可见）
  Engine._place(s, 'red-lieutenant-0', idx(5, 4), false);    // 敌方背面
  const vB = Engine.viewFor(s, 'black');
  assert.equal(vB.pieces['black-lieutenant-0'].kind, 'lieutenant', '所有者可见己方暗子');
  assert.equal(vB.pieces['red-lieutenant-0'].kind, null, '敌方背面子应隐藏 kind');
  assert.equal(vB.pieces['red-lieutenant-0'].rank, null);
  const vR = Engine.viewFor(s, 'red');
  assert.equal(vR.pieces['black-lieutenant-0'].kind, null, '对方视角下己方暗子应隐藏');
});

test('翻棋背面子对双方均隐藏阵营', () => {
  const s = Engine.createGame({ mode: 'flip' });
  const id = Object.keys(s.pieces).find(id => !s.pieces[id].revealed);
  const v = Engine.viewFor(s, 'black');
  assert.equal(v.pieces[id].side, null, '翻棋背面子 side 应为 null');
});

// ——————————————————— 6. 悔棋 ———————————————————
test('undo 恢复上一步', () => {
  const s = emptyHidden();
  Engine._place(s, 'black-lieutenant-0', idx(5, 0), true);
  Engine._place(s, 'red-lieutenant-0', idx(5, 4), true);
  Engine._setTurn(s, 'black');
  Engine.applyAction(s, { type: 'move', pieceId: 'black-lieutenant-0', from: idx(5, 0), to: idx(5, 1) });
  assert.equal(s.board[idx(5, 1)], 'black-lieutenant-0');
  assert.equal(s.board[idx(5, 0)], null);
  Engine.undo(s);
  assert.equal(s.board[idx(5, 0)], 'black-lieutenant-0');
  assert.equal(s.board[idx(5, 1)], null);
  assert.equal(s.turn, 'black');
});

// ——————————————————— 7. 翻棋初始化 ———————————————————
test('翻棋：50 子随机扣放，10 格空，全部背面', () => {
  const s = Engine.createGame({ mode: 'flip' });
  let nulls = 0, faceDown = 0, alive = 0;
  for (const c of s.board) if (c == null) nulls++;            // 棋盘上 10 格空
  for (const id in s.pieces) { if (!s.pieces[id].revealed) faceDown++; if (s.pieces[id].alive) alive++; }
  assert.equal(Object.keys(s.pieces).length, 50);
  assert.equal(nulls, 10);
  assert.equal(faceDown, 50);
  assert.equal(alive, 50);
  assert.equal(s.phase, 'playing');
});

// ——————————————————— 8. 暗棋布阵校验 ———————————————————
test('布阵校验 L-1..L-6', () => {
  const s = Engine.createGame({ mode: 'hidden' });
  // 非法：军旗不在大本营
  const bad = Engine.randomLayout(s, 'black');
  const flag = bad.find(x => s.pieces[x.id].kind === 'flag');
  flag.cell = idx(7, 0); // 放到对方半场（必不在合法布局内），触发 L-1：军旗须在大本营
  const r1 = Engine.applyLayout(s, 'black', bad);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some(e => e.includes('军旗')), '应报军旗不在大本营');
});
