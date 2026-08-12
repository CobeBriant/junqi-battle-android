/*
 * ai.test.js — AI 决策测试
 * 运行：node --test
 */
const test = require('node:test');
const assert = require('node:assert');
const Board = require('../www/js/board.js');
const Engine = require('../www/js/engine.js');
const AI = require('../www/js/ai.js');

function freshHidden() {
  const s = Engine.createGame({ mode: 'hidden' });
  Engine.applyLayout(s, 'black', Engine.randomLayout(s, 'black'));
  Engine.applyLayout(s, 'red', Engine.randomLayout(s, 'red'));
  Engine._beginPlay(s);
  return s;
}
function freshFlip() { return Engine.createGame({ mode: 'flip' }); }

function isLegal(s, a) {
  return Engine.allLegalActions(s).some(x =>
    x.type === a.type && x.pieceId === a.pieceId &&
    (x.from === a.from || x.from === undefined) && x.to === a.to);
}

test('chooseAction 在两种玩法、三档难度下均返回合法行动', () => {
  for (const make of [freshFlip, freshHidden]) {
    const s = make();
    for (const lv of ['easy', 'normal', 'hard']) {
      const a = AI.chooseAction(s, 'black', lv);
      assert.ok(a, `应返回行动 ${lv}`);
      assert.ok(isLegal(s, a), `行动应合法 ${lv}: ${JSON.stringify(a)}`);
    }
  }
});

test('全暗敌子场景下 AI 不崩溃且返回合法行动（信息隔离）', () => {
  const s = freshHidden();
  for (const id in s.pieces) if (s.pieces[id].side === 'red') s.pieces[id].revealed = false;
  const a = AI.chooseAction(s, 'black', 'hard');
  assert.ok(a, 'hard 在敌全暗时仍应出招');
  assert.ok(isLegal(s, a), '行动应合法');
});

test('normal 不把已知弱子送进已知强子（不送子）', () => {
  const s = freshHidden();
  // 清空盘面，手工布置一个清晰局面
  for (const id in s.pieces) { s.pieces[id].cell = null; s.pieces[id].revealed = false; s.board.fill(null); }
  Engine._place(s, 'black-general-0', Board.idx(5, 2), true);   // 军长(rank8)，已揭示
  Engine._place(s, 'red-commander-0', Board.idx(5, 3), true);   // 司令(rank9)，已揭示，相邻
  // 给黑方一个安全的普通走法（向前一步到空格）
  Engine._place(s, 'black-lieutenant-0', Board.idx(5, 1), true);
  Engine._setTurn(s, 'black');

  const a = AI.chooseAction(s, 'black', 'normal');
  assert.ok(a, '应返回行动');
  assert.ok(isLegal(s, a), '行动应合法');
  assert.notEqual(a.to, Board.idx(5, 3), '不应把军长送进司令');
});

test('normal 在可白吃已知弱子时倾向吃子', () => {
  const s = freshHidden();
  for (const id in s.pieces) { s.pieces[id].cell = null; s.pieces[id].revealed = false; s.board.fill(null); }
  Engine._place(s, 'black-commander-0', Board.idx(5, 2), true);  // 司令
  Engine._place(s, 'red-sergeant-0', Board.idx(5, 3), true);     // 工兵(rank2)，相邻
  Engine._setTurn(s, 'black');
  const a = AI.chooseAction(s, 'black', 'normal');
  assert.equal(a.to, Board.idx(5, 3), '应吃掉相邻的已知弱子');
});

// —— 整局自对弈：必然终局、无异常 ——
function playGame(blackLevel, redLevel, mode) {
  const s = mode === 'flip' ? Engine.createGame({ mode: 'flip' }) : freshHidden();
  let plies = 0;
  while (!s.result && plies < 4000) {
    const side = s.turn;
    const lvl = side === 'black' ? blackLevel : redLevel;
    const a = AI.chooseAction(s, side, lvl);
    if (!a) break;
    const r = Engine.applyAction(s, a);
    if (!r.ok) throw new Error('AI 产生非法行动: ' + JSON.stringify(a));
    plies++;
  }
  return s.result ? (s.result.winner || 'draw') : 'timeout';
}

test('随机自对弈 200 局（翻棋+暗棋）必然终局、无异常', () => {
  let terminated = 0, bad = 0;
  for (let i = 0; i < 200; i++) {
    const mode = i % 2 ? 'hidden' : 'flip';
    let outcome;
    try { outcome = playGame('easy', 'easy', mode); }
    catch (e) { bad++; console.error('自对弈异常', e.message); continue; }
    if (outcome !== 'timeout') terminated++;
  }
  assert.equal(bad, 0, '不应有异常');
  assert.equal(terminated, 200, '所有对局应终局（无死循环）');
});

test('普通档对随机档胜率应显著高于随机（≥0.65，目标>0.9）', () => {
  let normalWins = 0, games = 40;
  for (let i = 0; i < games; i++) {
    const mode = i % 2 ? 'hidden' : 'flip';
    // 红=normal，黑=easy；统计 normal 侧（红）胜场
    const o = playGame('easy', 'normal', mode);
    if (o === 'red') normalWins++;
  }
  const rate = normalWins / games;
  console.log(`normal(红) 胜率 ${(rate * 100).toFixed(1)}% (${normalWins}/${games})`);
  assert.ok(rate >= 0.65, `胜率应≥0.65，实际 ${rate.toFixed(2)}`);
});
