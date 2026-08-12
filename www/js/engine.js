/*
 * engine.js — 对局状态机（纯逻辑，无 DOM 依赖，可在 Node 单测）
 * 对外 API：createGame / applyLayout / randomLayout / legalMoves /
 *           allLegalActions / applyAction / undo / viewFor / serialize / load
 * 详见 docs/ARCHITECTURE.md §4。所有业务失败以 { ok:false, reason } 返回，不抛异常。
 */
(function (root, factory) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const deps = isNode
    ? { Board: require('./board.js'), Pieces: require('./pieces.js') }
    : { Board: root.Junqi.Board, Pieces: root.Junqi.Pieces };
  const mod = factory(deps);
  if (isNode) module.exports = mod;
  root.Junqi = root.Junqi || {};
  root.Junqi.Engine = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function ({ Board, Pieces }) {
  const { idx, rc, inBounds, cellType, isRail, railAdj, roadAdj, HQ } = Board;

  const defaultRules = {
    mineHitRule: 'both',          // both | attackerOnly
    flagCaptureNeedsMines: false, // 三雷不出
    revealMode: 'result',         // result | full
    flipMoveMode: 'full',         // full | simple
    hqLockIn: true,
    maxMovesNoBattle: 300,
    aiLevel: 'normal',            // easy | normal | hard
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function mergeRules(rules, mode) {
    const r = Object.assign({}, defaultRules, rules || {});
    if (rules && typeof rules.maxMovesNoBattle === 'number') {
      // 已显式指定则保留
    } else {
      r.maxMovesNoBattle = (mode === 'flip') ? 300 : 400;
    }
    return r;
  }

  // 生成一副随机排列（Fisher-Yates）
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function createGame(opts) {
    opts = opts || {};
    const mode = opts.mode || 'flip';
    const rules = mergeRules(opts.rules, mode);
    const opponent = opts.opponent || 'human';
    const aiLevel = opts.aiLevel || rules.aiLevel || 'normal';

    const pieces = Object.assign({}, Pieces.createArmy('black'), Pieces.createArmy('red'));
    const board = new Array(Board.N).fill(null);

    const state = {
      version: 1,
      mode,
      phase: 'layout',            // flip 模式创建后直接 playing
      opponent,
      aiLevel,
      rules,
      turn: opts.first || 'black',
      board,
      pieces,
      moveCount: 0,
      movesSinceBattle: 0,
      history: [],                // 每步含 before 快照，供 undo
      lastMove: null,
      result: null,
    };

    if (mode === 'flip') {
      // 50 子随机扣放在 60 格，10 格空；全部背面（revealed=false）
      const cells = shuffle(Array.from({ length: Board.N }, (_, i) => i)).slice(0, 50);
      const ids = Object.keys(pieces);
      cells.forEach((cell, i) => {
        const id = ids[i];
        pieces[id].cell = cell;
        board[cell] = id;
      });
      state.phase = 'playing';
    }
    return state;
  }

  // —— 暗棋布阵 ——
  // layout: 数组 [{ id, cell }]，仅限该方 25 枚
  function applyLayout(state, side, layout) {
    if (state.phase !== 'layout') return { ok: false, reason: 'notLayoutPhase' };
    const errors = [];
    const myIds = new Set(Object.values(state.pieces).filter(p => p.side === side).map(p => p.id));
    const cellsUsed = new Set();

    // 先清空该方已有布子
    for (const p of Object.values(state.pieces)) {
      if (p.side === side) { p.cell = null; p.revealed = false; }
    }
    for (const { id, cell } of layout) {
      if (!myIds.has(id)) errors.push(`棋子 ${id} 不属于 ${side}`);
      if (!inBounds(...Object.values(rc(cell)))) errors.push(`格位越界 ${cell}`);
      if (cellsUsed.has(cell)) errors.push(`格位 ${cell} 重复占用`);
      cellsUsed.add(cell);
    }
    if (errors.length) return { ok: false, errors };

    const byId = {};
    for (const { id, cell } of layout) byId[id] = cell;

    // L-1..L-6 校验
    const flagId = Object.keys(byId).find(id => state.pieces[id].kind === 'flag');
    const flagCell = byId[flagId];
    if (!HQ[side].includes(flagCell)) errors.push('军旗必须放在本方大本营（L-1）');

    for (const [id, cell] of Object.entries(byId)) {
      const p = state.pieces[id];
      const { r, c } = rc(cell);
      if (cellType(cell) === 'camp') errors.push(`行营不得布子（L-4）: ${id}`);
      if (p.kind === 'mine') {
        const lastTwo = side === 'black' ? [0, 1] : [10, 11];
        if (!lastTwo.includes(r)) errors.push(`地雷只能放最后两排（L-2）: ${id}`);
      }
      if (p.kind === 'bomb') {
        const firstRow = side === 'black' ? 5 : 6;
        if (r === firstRow) errors.push(`炸弹不得放第一排（L-3）: ${id}`);
      }
    }
    if (Object.keys(byId).length !== 25) errors.push('必须 25 枚全部落位（L-5）');
    if (errors.length) return { ok: false, errors };

    for (const [id, cell] of Object.entries(byId)) {
      state.pieces[id].cell = cell;
      state.board[cell] = id;
    }
    return { ok: true };
  }

  function randomLayout(state, side) {
    const mineRows = side === 'black' ? [0, 1] : [10, 11];
    const firstRow = side === 'black' ? 5 : 6;
    const hqs = HQ[side];
    // 本方可布格（含两个大本营，共 25 格），恰好容纳 25 枚
    const ownCells = [];
    for (let r = 0; r < 12; r++) for (let c = 0; c < 5; c++) {
      const cell = idx(r, c);
      if (cellType(cell) === 'camp') continue;          // 行营不可布
      if (side === 'black' && r > 5) continue;          // 黑方仅本方 r0..r5
      if (side === 'red' && r < 6) continue;            // 红方仅本方 r6..r11
      ownCells.push(cell);
    }
    const pieces = Object.values(state.pieces).filter(p => p.side === side);

    const used = new Set();
    const pickFrom = (pred) => {
      const pool = ownCells.filter(c => pred(c) && !used.has(c));
      const cell = pool[Math.floor(Math.random() * pool.length)];
      used.add(cell); return cell;
    };
    const layout = [];
    const pushOne = (p, pred) => layout.push({ id: p.id, cell: pickFrom(pred) });

    // 先放受约束棋子，避免通用池先占满约束格导致无解
    const flag = pieces.find(p => p.kind === 'flag');
    pushOne(flag, c => hqs.includes(c));
    for (const p of pieces.filter(p => p.kind === 'mine')) pushOne(p, c => mineRows.includes(rc(c).r));
    for (const p of pieces.filter(p => p.kind === 'bomb')) pushOne(p, c => rc(c).r !== firstRow);
    for (const p of pieces.filter(p => !['flag', 'mine', 'bomb'].includes(p.kind))) pushOne(p, () => true);
    return layout;
  }

  // —— 走法生成 ——
  function generateMoves(state, piece) {
    if (!piece || !piece.alive || piece.cell == null) return [];
    if (Pieces.IMMOVABLE.has(piece.kind)) return [];          // 地雷/军旗不动
    if (state.rules.hqLockIn && piece.enteredHQ) return [];   // 大本营锁定

    const from = piece.cell;
    const side = piece.side;
    const moves = new Set();

    // 公路一步
    for (const to of roadAdj[from]) {
      const occ = state.board[to];
      if (!occ) { moves.add(to); continue; }
      const dp = state.pieces[occ];
      if (dp.side === side) continue;                        // 己方阻挡
      if (cellType(to) === 'camp') continue;                 // 行营内不可被吃
      moves.add(to);                                         // 可攻击敌子
    }

    // 铁路长驱（翻棋 simple 模式禁用）
    const allowRail = !(state.mode === 'flip' && state.rules.flipMoveMode === 'simple');
    if (allowRail && isRail(...Object.values(rc(from)))) {
      const rail = (piece.kind === 'engineer')
        ? railReachEngineer(state, from, side)
        : railReachStraight(state, from, side);
      rail.forEach(to => moves.add(to));
    }
    return [...moves];
  }

  // 非工兵：沿直线铁路滑动，不可转弯
  function railReachStraight(state, from, side) {
    const out = [];
    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of dirs) {
      let cur = from;
      while (true) {
        const { r, c } = rc(cur);
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc)) break;
        const next = idx(nr, nc);
        if (!railAdj[cur].includes(next)) break;             // 必须是真实铁路边（含中线桥）
        const occ = state.board[next];
        if (!occ) { out.push(next); cur = next; continue; }
        const dp = state.pieces[occ];
        if (dp.side !== side && cellType(next) !== 'camp') out.push(next); // 可攻击
        break;                                              // 任何棋子阻挡，停止
      }
    }
    return out;
  }

  // 工兵：沿铁路网 BFS，可转弯，路径不可有阻挡
  function railReachEngineer(state, from, side) {
    const out = [];
    const visited = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const nb of railAdj[cur]) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        const occ = state.board[nb];
        if (!occ) { out.push(nb); queue.push(nb); }
        else {
          const dp = state.pieces[occ];
          if (dp.side !== side && cellType(nb) !== 'camp') out.push(nb);
          // 占用格不再扩展
        }
      }
    }
    return out;
  }

  function legalMoves(state, pieceId) {
    const p = state.pieces[pieceId];
    if (!p || p.side !== state.turn) return [];              // 仅当前行动方
    return generateMoves(state, p);
  }

  function allLegalActions(state) {
    if (state.phase !== 'playing' || state.result) return [];
    const side = state.turn;
    const actions = [];
    for (const p of Object.values(state.pieces)) {
      if (!p.alive || p.side !== side) continue;
      if (state.mode === 'flip' && !p.revealed) {
        actions.push({ type: 'flip', pieceId: p.id });
        continue;
      }
      for (const to of generateMoves(state, p)) {
        actions.push({ type: 'move', pieceId: p.id, from: p.cell, to });
      }
    }
    return actions;
  }

  // —— 执行行动 ——
  function snapshot(state) {
    return {
      board: state.board.slice(),
      pieces: clone(state.pieces),
      turn: state.turn,
      moveCount: state.moveCount,
      movesSinceBattle: state.movesSinceBattle,
      lastMove: state.lastMove ? clone(state.lastMove) : null,
      result: state.result ? clone(state.result) : null,
    };
  }

  function applyAction(state, action) {
    if (state.phase !== 'playing') return { ok: false, reason: 'notPlaying' };
    if (state.result) return { ok: false, reason: 'gameOver' };
    const side = state.turn;
    const before = snapshot(state);

    if (action.type === 'flip') {
      const p = state.pieces[action.pieceId];
      if (!p || !p.alive || p.revealed) return { ok: false, reason: 'invalidFlip' };
      if (state.board[p.cell] !== p.id) return { ok: false, reason: 'invalidFlip' };
      p.revealed = true;
      state.moveCount++;
      state.movesSinceBattle++;
      state.lastMove = { type: 'flip', pieceId: p.id };
      state.history.push({ before, action });
      return finishTurn(state, { ok: true, move: state.lastMove, battle: null, result: null });
    }

    if (action.type === 'move') {
      const p = state.pieces[action.pieceId];
      if (!p || p.side !== side || !p.alive) return { ok: false, reason: 'notYourPiece' };
      const legal = generateMoves(state, p);
      if (!legal.includes(action.to)) return { ok: false, reason: 'illegalMove' };

      const from = p.cell;
      const to = action.to;
      const defenderId = state.board[to];
      state.board[from] = null;
      state.board[to] = p.id;
      p.cell = to;
      if (cellType(to) === 'hq' && state.rules.hqLockIn) p.enteredHQ = true;

      let battle = null;
      if (defenderId) {
        const attacker = p;
        const defender = state.pieces[defenderId];
        const res = Pieces.resolveCombat(attacker, defender, state.rules);
        battle = res;
        if (res.flagCaptured) {
          defender.alive = false; defender.cell = null;
          // 夺旗者留在 to
        } else if (res.outcome === 'attackerWins') {
          defender.alive = false; defender.cell = null;
        } else if (res.outcome === 'defenderWins') {
          attacker.alive = false; attacker.cell = null;
          state.board[to] = defenderId; // 防守方留在原地
        } else { // both
          attacker.alive = false; attacker.cell = null;
          defender.alive = false; defender.cell = null;
          state.board[to] = null;
        }
        // 司令阵亡 → 亮出该方军旗
        if (res.attackerDies && attacker.kind === 'commander') revealFlag(state, attacker.side);
        if (res.defenderDies && defender.kind === 'commander') revealFlag(state, defender.side);
        state.movesSinceBattle = 0;
      } else {
        state.movesSinceBattle++;
      }
      state.moveCount++;
      state.lastMove = { type: 'move', pieceId: p.id, from, to, battle };
      state.history.push({ before, action });
      return finishTurn(state, { ok: true, move: state.lastMove, battle, result: state.result });
    }
    return { ok: false, reason: 'unknownAction' };
  }

  function revealFlag(state, side) {
    const flag = Object.values(state.pieces).find(p => p.side === side && p.kind === 'flag');
    if (flag) flag.revealed = true;
  }

  function finishTurn(state, ret) {
    // 判定终局
    if (!state.result) {
      if (ret.battle && ret.battle.flagCaptured) {
        state.result = { winner: state.turn, reason: 'flag' };
      } else {
        const opp = state.turn === 'black' ? 'red' : 'black';
        const oppActions = allLegalActionsFor(state, opp);
        if (oppActions.length === 0) {
          state.result = { winner: state.turn, reason: 'nomove' };
        } else if (state.movesSinceBattle >= state.rules.maxMovesNoBattle) {
          state.result = { winner: null, reason: 'draw' };
        }
      }
    }
    if (!state.result) state.turn = state.turn === 'black' ? 'red' : 'black';
    ret.result = state.result;
    return ret;
  }

  // 在不切换 turn 的前提下为指定方生成行动（用于 nomove 判定）
  function allLegalActionsFor(state, side) {
    const saved = state.turn;
    state.turn = side;
    const acts = allLegalActions(state);
    state.turn = saved;
    return acts;
  }

  function undo(state) {
    const last = state.history.pop();
    if (!last) return { ok: false, reason: 'nothingToUndo' };
    const b = last.before;
    state.board = b.board.slice();
    state.pieces = clone(b.pieces);
    state.turn = b.turn;
    state.moveCount = b.moveCount;
    state.movesSinceBattle = b.movesSinceBattle;
    state.lastMove = b.lastMove ? clone(b.lastMove) : null;
    state.result = b.result ? clone(b.result) : null;
    return { ok: true };
  }

  function viewFor(state, side) {
    const view = {
      version: state.version, mode: state.mode, phase: state.phase,
      opponent: state.opponent, aiLevel: state.aiLevel, rules: state.rules,
      turn: state.turn, moveCount: state.moveCount,
      movesSinceBattle: state.movesSinceBattle, lastMove: state.lastMove,
      result: state.result,
      board: state.board.slice(),
      pieces: {},
    };
    for (const [id, p] of Object.entries(state.pieces)) {
      const vp = Object.assign({}, p);
      const hide = (p.side !== side) && !p.revealed;
      if (hide) { vp.kind = null; vp.rank = null; }
      if (state.mode === 'flip' && !p.revealed) { vp.side = null; } // 背面子对双方均隐藏阵营
      view.pieces[id] = vp;
    }
    return view;
  }

  function serialize(state) {
    return JSON.stringify({
      version: state.version, mode: state.mode, phase: state.phase,
      opponent: state.opponent, aiLevel: state.aiLevel, rules: state.rules,
      turn: state.turn, board: state.board, pieces: state.pieces,
      moveCount: state.moveCount, movesSinceBattle: state.movesSinceBattle,
      history: state.history, lastMove: state.lastMove, result: state.result,
    });
  }

  function load(json) {
    const o = (typeof json === 'string') ? JSON.parse(json) : json;
    return Object.assign({
      version: 1, phase: 'playing', opponent: 'human', aiLevel: 'normal',
      history: [], lastMove: null, result: null,
    }, o);
  }

  // —— 测试辅助（非对外契约，仅供单测构造局面）——
  function _place(state, pieceId, cell, revealed) {
    const p = state.pieces[pieceId];
    if (p.cell != null) state.board[p.cell] = null;
    p.cell = cell; p.revealed = revealed !== false;
    state.board[cell] = pieceId;
    return state;
  }
  function _beginPlay(state) { state.phase = 'playing'; return state; }
  function _setTurn(state, side) { state.turn = side; return state; }

  return {
    defaultRules, createGame, applyLayout, randomLayout,
    legalMoves, allLegalActions, applyAction, undo,
    viewFor, serialize, load,
    generateMoves, resolveCombat: Pieces.resolveCombat,
    _place, _beginPlay, _setTurn,
  };
});
