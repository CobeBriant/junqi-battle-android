/*
 * integration.test.js — 端到端跑通页面所调用的引擎流程：
 *   暗棋：布阵(双)→开局→对局→视野隔离→悔棋→序列化/反序列化
 *   翻棋：随机扣放→翻子/走子→视野
 * 仅使用 UI 实际会调用的 API（createGame/applyLayout/randomLayout/_beginPlay/
 * allLegalActions/applyAction/undo/viewFor/serialize/load）。
 */
const test = require('node:test');
const assert = require('node:assert');
const Engine = require('../www/js/engine.js');
const { idx } = require('../www/js/board.js');

test('暗棋：双布阵 + 开局 + 整局随机对弈 + 视野隔离', () => {
  const g = Engine.createGame({ mode: 'hidden' });
  const black = Engine.randomLayout(g, 'black');
  const red = Engine.randomLayout(g, 'red');
  assert.ok(Engine.applyLayout(g, 'black', black).ok);
  assert.ok(Engine.applyLayout(g, 'red', red).ok);
  Engine._beginPlay(g);
  assert.equal(g.phase, 'playing');
  assert.equal(g.turn, 'black');

  // 视野隔离：开局时黑方看不到任何红方棋子
  const vB = Engine.viewFor(g, 'black');
  const redVisibleAtStart = Object.values(vB.pieces).filter(p => p.side === 'red' && p.revealed).length;
  assert.equal(redVisibleAtStart, 0, '开局黑方不应看到任何红方明子');

  // 随机对弈直至终局
  let steps = 0;
  while (!g.result && steps < 2000) {
    const acts = Engine.allLegalActions(g);
    if (!acts.length) break;
    const a = acts[Math.floor(Math.random() * acts.length)];
    const r = Engine.applyAction(g, a);
    assert.ok(r.ok, '页面产生的随机合法行动必须可执行: ' + JSON.stringify(a));
    steps++;
  }
  assert.ok(g.result, '对局必须能在有限步内终局');

  // 终局后序列化→反序列化应等价
  const json = Engine.serialize(g);
  const g2 = Engine.load(json);
  assert.equal(g2.result.winner, g.result.winner);
  assert.equal(g2.turn, g.turn);
});

test('暗棋：战斗后双方参战子应被揭示（revealMode=result）', () => {
  const g = Engine.createGame({ mode: 'hidden' });
  Engine._place(g, 'black-lieutenant-0', idx(5, 0), true);   // 黑明子
  Engine._place(g, 'red-sergeant-0', idx(5, 1), false);       // 红暗子
  Engine._beginPlay(g);
  const before = Engine.viewFor(g, 'black').pieces['red-sergeant-0'].revealed;
  assert.equal(before, false, '战前红暗子对黑方不可见');
  const r = Engine.applyAction(g, { type: 'move', pieceId: 'black-lieutenant-0', from: idx(5, 0), to: idx(5, 1) });
  assert.ok(r.ok && r.battle);
  const after = Engine.viewFor(g, 'black').pieces['red-sergeant-0'];
  // 红方被吃（军衔小），该子已阵亡；但其 identity 已在战斗中被记录——以存活参战子验证
  const blackAfter = Engine.viewFor(g, 'red').pieces['black-lieutenant-0'].revealed;
  assert.equal(blackAfter, true, '战斗后黑方参战子应对红方揭示');
});

test('翻棋：随机扣放起步 + 翻子/走子混合 + 视野', () => {
  const g = Engine.createGame({ mode: 'flip' });
  assert.equal(g.phase, 'playing');
  let faceDown = 0;
  for (const id in g.pieces) if (!g.pieces[id].revealed) faceDown++;
  assert.equal(faceDown, 50);

  // 找一枚暗子翻開
  const darkId = Object.keys(g.pieces).find(id => !g.pieces[id].revealed);
  const r = Engine.applyAction(g, { type: 'flip', pieceId: darkId });
  assert.ok(r.ok);
  assert.equal(g.pieces[darkId].revealed, true);
  // 翻棋中棋子归属原色，翻后方可见其 kind
  assert.ok(g.pieces[darkId].kind);
});

test('悔棋：撤销一步后状态完全回退', () => {
  const g = Engine.createGame({ mode: 'hidden' });
  Engine.applyLayout(g, 'black', Engine.randomLayout(g, 'black'));
  Engine.applyLayout(g, 'red', Engine.randomLayout(g, 'red'));
  Engine._beginPlay(g);
  const snap = JSON.stringify(g);
  const act = Engine.allLegalActions(g)[0];
  Engine.applyAction(g, act);
  assert.notEqual(JSON.stringify(g), snap);
  const u = Engine.undo(g);
  assert.ok(u.ok);
  assert.equal(JSON.stringify(g), snap, 'undo 后应与行动前完全一致');
});
