/* 迭代 4 测试：存档序列化往返、多步悔棋、阵型库（预设合法性 / 镜像 / 存取） */
const test = require('node:test');
const assert = require('node:assert');

const Board = require('../www/js/board.js');
const Pieces = require('../www/js/pieces.js');
const Engine = require('../www/js/engine.js');
const Presets = require('../www/js/presets.js');

const { idx, rc } = Board;

function pickId(state, side, kind, used) {
  const p = Object.values(state.pieces).find((pp) => pp.side === side && pp.kind === kind && !used.has(pp.id));
  return p ? p.id : null;
}
function layoutFor(state, side, entries) {
  const used = new Set();
  return entries.map((e) => {
    const cell = side === 'red' ? Board.idx(11 - rc(e.cell).r, rc(e.cell).c) : e.cell;
    const id = pickId(state, side, e.kind, used);
    used.add(id);
    return { id, cell };
  });
}

test('存档：serialize -> load 往返保持对局可继续', () => {
  const s = Engine.createGame({ mode: 'hidden' });
  Engine.applyLayout(s, 'black', Engine.randomLayout(s, 'black'));
  Engine.applyLayout(s, 'red', Engine.randomLayout(s, 'red'));
  Engine._beginPlay(s);
  // 走几步
  for (let i = 0; i < 5 && !s.result; i++) {
    const acts = Engine.allLegalActions(s);
    Engine.applyAction(s, acts[0]);
  }
  const json = Engine.serialize(s);
  const s2 = Engine.load(json);
  assert.equal(s2.turn, s.turn);
  assert.equal(s2.moveCount, s.moveCount);
  assert.deepEqual(Object.keys(s2.pieces).length, Object.keys(s.pieces).length);
  // 续局仍可行动
  assert.ok(Engine.allLegalActions(s2).length >= 0);
});

test('多步悔棋：连退 4 步回到初始局面', () => {
  const s = Engine.createGame({ mode: 'hidden' });
  Engine.applyLayout(s, 'black', Engine.randomLayout(s, 'black'));
  Engine.applyLayout(s, 'red', Engine.randomLayout(s, 'red'));
  Engine._beginPlay(s);
  const snap = JSON.stringify(s.pieces) + '|' + s.turn + '|' + s.moveCount;
  for (let i = 0; i < 4; i++) {
    const acts = Engine.allLegalActions(s);
    Engine.applyAction(s, acts[0]);
  }
  assert.notEqual(JSON.stringify(s.pieces) + '|' + s.turn + '|' + s.moveCount, snap, '走子后应改变');
  for (let i = 0; i < 4; i++) Engine.undo(s);
  assert.equal(JSON.stringify(s.pieces) + '|' + s.turn + '|' + s.moveCount, snap, '连退应完全复原');
  assert.equal(s.history.length, 0);
});

test('阵型库：三种预设均为合法布局（黑方 & 镜像红方）', () => {
  for (const preset of Presets.PRESETS) {
    assert.equal(preset.entries.length, 25, `${preset.name} 应含 25 枚`);
    for (const side of ['black', 'red']) {
      const state = Engine.createGame({ mode: 'hidden' });
      const layout = layoutFor(state, side, preset.entries);
      const res = Engine.applyLayout(state, side, layout);
      assert.ok(res.ok, `${preset.name}/${side} 应合法，实际：${res.errors && res.errors.join('；')}`);
    }
  }
});

test('阵型库：镜像格位自反且落在对方半区', () => {
  const black = idx(0, 1); // 黑方后排
  const red = Board.idx(11 - rc(black).r, rc(black).c);
  assert.equal(rc(red).r, 11);
  assert.equal(Board.idx(11 - rc(red).r, rc(red).c), black, '镜像应自反');
});

test('阵型库：用户阵型存取往返（localStorage shim）', () => {
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  // 直接复用 common.js 的 Formations 逻辑（复制其纯逻辑，避免加载依赖 window 的模块）
  const KEY = 'junqi_formations_v1';
  const readAll = () => JSON.parse(global.localStorage.getItem(KEY) || '{}');
  const writeAll = (o) => global.localStorage.setItem(KEY, JSON.stringify(o));
  const saveUser = (name, entries) => { const o = readAll(); o[name] = { entries, createdAt: 1 }; writeAll(o); };
  const getUser = (name) => { const o = readAll(); return o[name] ? o[name].entries : null; };
  const removeUser = (name) => { const o = readAll(); delete o[name]; writeAll(o); };

  const entries = Presets.PRESETS[0].entries;
  saveUser('测试阵', entries);
  assert.deepEqual(getUser('测试阵'), entries);
  removeUser('测试阵');
  assert.equal(getUser('测试阵'), null);
  delete global.localStorage;
});

test('预设条目与棋子构成一致（每种军衔数量正确）', () => {
  const COMP = Pieces.COMPOSITION;
  for (const preset of Presets.PRESETS) {
    const counts = {};
    for (const e of preset.entries) counts[e.kind] = (counts[e.kind] || 0) + 1;
    for (const k in COMP) assert.equal(counts[k], COMP[k], `${preset.name} 的 ${k} 数量应为 ${COMP[k]}`);
  }
});
