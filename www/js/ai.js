/*
 * ai.js — 走子决策（纯逻辑，无 DOM 依赖，可在 Node 单测）
 * 只消费 engine.viewFor(side) 等价的信息：敌方未揭示棋子对 AI 不可见其 kind。
 * 对外 API：chooseAction(state, side, level) -> action | null
 *           evaluate(state, side) -> number（供测试与搜索复用）
 * level: 'easy' | 'normal' | 'hard'
 */
(function (root, factory) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const deps = isNode
    ? { Engine: require('./engine.js'), Board: require('./board.js'), Pieces: require('./pieces.js') }
    : { Engine: root.Junqi.Engine, Board: root.Junqi.Board, Pieces: root.Junqi.Pieces };
  const mod = factory(deps);
  if (isNode) module.exports = mod;
  root.Junqi = root.Junqi || {};
  root.Junqi.AI = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function ({ Engine, Board, Pieces }) {
  const { rc, cellType } = Board;

  // —— 子力价值（key 必须与 Pieces.COMPOSITION 完全一致）——
  const VALUE = {
    flag: 1000, commander: 100, general: 80, major: 60, brigadier: 45,
    colonel: 35, captain: 25, lieutenant: 18, sergeant: 12, engineer: 30,
    bomb: 70, mine: 50,
  };
  // 敌暗子平均价值（按编制加权，含军旗但仅 1 枚，权重极小）
  let ENEMY_HIDDEN_AVG = 40, ENEMY_AVG_RANK = 5;
  (function initAvg() {
    let v = 0, n = 0, r = 0;
    for (const k in Pieces.COMPOSITION) {
      const c = Pieces.COMPOSITION[k];
      v += (VALUE[k] || 0) * c; n += c; r += (Pieces.RANKS[k] || 0) * c;
    }
    if (n) { ENEMY_HIDDEN_AVG = v / n; ENEMY_AVG_RANK = r / n; }
  })();

  // 克隆用于搜索：只拷贝对模拟必要的字段，且不带 history（模拟态不需要悔棋链），
  // 避免把随对局线性增长的 history 也做一次深拷贝（否则长局会 OOM）。
  function cloneState(s) {
    return {
      version: s.version, mode: s.mode, phase: s.phase, opponent: s.opponent,
      aiLevel: s.aiLevel, rules: s.rules, turn: s.turn,
      board: s.board.slice(),
      pieces: JSON.parse(JSON.stringify(s.pieces)),
      moveCount: s.moveCount, movesSinceBattle: s.movesSinceBattle,
      lastMove: s.lastMove ? JSON.parse(JSON.stringify(s.lastMove)) : null,
      result: s.result ? JSON.parse(JSON.stringify(s.result)) : null,
      history: [],
    };
  }
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // 仅用「AI 视角可见信息」评估局面（与 viewFor(side) 一致：敌暗子 kind 不可见）
  // side 未知敌子一律按 ENEMY_HIDDEN_AVG 估算，绝不读取真实 kind。
  function evaluate(state, side) {
    if (state.result) {
      if (state.result.winner === side) return 1e9;
      if (state.result.winner) return -1e9;
      return -50; // 平局略负：宁可求胜
    }
    const opp = side === 'black' ? 'red' : 'black';
    let s = 0;
    for (const id in state.pieces) {
      const p = state.pieces[id];
      if (!p.alive || p.cell == null) continue;
      const known = (p.side === side) || p.revealed; // 己方恒可知；敌子仅揭示后可知
      if (p.side === side) {
        s += VALUE[p.kind] + positionBonus(p);
      } else if (p.side === opp) {
        // 敌子：仅当其已揭示才计入真实价值，否则按平均估算
        s -= known ? VALUE[p.kind] : ENEMY_HIDDEN_AVG;
      } else {
        // 翻棋模式：背面子阵营未知，按半值估算（中立）
        s -= ENEMY_HIDDEN_AVG * 0.5;
      }
    }
    return s;
  }

  function positionBonus(p) {
    let b = 0;
    if (cellType(p.cell) === 'camp') b += 6;            // 占行营更安全
    const adv = p.side === 'black' ? rc(p.cell).r : (11 - rc(p.cell).r);
    b += Math.min(adv, 6) * 0.6;                        // 向前推进
    return b;
  }

  // 对未知敌子的战斗期望收益（不读取真实 kind，仅基于我方 kind + 平均敌力）
  function expectVsUnknown(attackerKind) {
    const myRank = Pieces.RANKS[attackerKind] || 0;
    let pWin;
    if (attackerKind === 'engineer') pWin = 0.45;       // 工兵可排雷但多数吃亏
    else if (attackerKind === 'bomb') pWin = 0.5;       // 炸弹同归，胜负各半
    else pWin = clamp(0.5 + (myRank - ENEMY_AVG_RANK) / 20, 0.15, 0.85);
    const myVal = VALUE[attackerKind];
    return pWin * ENEMY_HIDDEN_AVG - (1 - pWin) * myVal;
  }

  // 已知敌子 kind 的战斗期望收益（我方 kind 已知，敌 kind 已知）
  function expectVsKnown(attackerKind, defenderKind, rules) {
    const r = Pieces.resolveCombat({ kind: attackerKind }, { kind: defenderKind }, rules);
    if (r.flagCaptured) return VALUE.flag;
    if (r.outcome === 'attackerWins') return VALUE[defenderKind];
    if (r.outcome === 'defenderWins') return -VALUE[attackerKind];
    return -VALUE[attackerKind] * 0.5;                  // 同归于尽
  }

  // 单个行动的「即时收益」，只用 AI 视角可见信息（敌暗子 kind 不可见）
  function actionBonus(orig, a, side, res) {
    if (a.type === 'flip') {
      let revealed = 0;
      for (const id in orig.pieces) if (orig.pieces[id].revealed && orig.pieces[id].side === side) revealed++;
      return revealed < 12 ? 8 : 2;                     // 前期多翻、后期少翻
    }
    if (a.type === 'move' && res && res.battle) {
      const atk = orig.pieces[a.pieceId];               // 我方棋子，kind 可知
      const defId = orig.board[a.to];
      const def = defId ? orig.pieces[defId] : null;
      const defRevealed = def && def.revealed;
      const defKind = (def && defRevealed) ? def.kind : null;
      return defKind ? expectVsKnown(atk.kind, defKind, orig.rules) : expectVsUnknown(atk.kind);
    }
    return 0;
  }

  function scoreMove(state, side, a) {
    const sim = cloneState(state);
    const r = Engine.applyAction(sim, a);
    if (!r.ok) return { a, score: -1e9 };
    const sc = evaluate(sim, side) + actionBonus(state, a, side, r);
    return { a, score: sc, sim, res: r };
  }

  // easy：纯随机；normal：1 层启发式；hard：top-K 的 2 层搜索
  function chooseAction(state, side, level) {
    level = level || 'normal';
    const actions = Engine.allLegalActions(state);
    if (actions.length === 0) return null;
    if (level === 'easy') return actions[Math.floor(Math.random() * actions.length)];

    const scored = actions.map((a) => scoreMove(state, side, a));
    scored.sort((x, y) => y.score - x.score);

    if (level === 'normal') {
      // 在并列最优中带轻微随机，避免完全确定性
      const top = scored.filter((x) => x.score >= scored[0].score - 1).map((x) => x.a);
      return top[Math.floor(Math.random() * top.length)];
    }

    // hard：对 top-K 做一层对手反制搜索
    const t0 = Date.now();
    const K = Math.min(6, scored.length);
    const opp = side === 'black' ? 'red' : 'black';
    let best = null, bestScore = -1e18;
    for (let i = 0; i < K; i++) {
      const cand = scored[i];
      let val;
      if (cand.sim.result) {
        val = cand.sim.result.winner === side ? 1e9 : -1e9;
      } else if (cand.sim.turn === side) {
        val = evaluate(cand.sim, side);                // 对手无棋（罕见）
      } else {
        // 对手反制：在对手自身视野下选最优（含其可见信息；对手未知我暗子按平均估算）
        let worst = 1e9;
        const replies = Engine.allLegalActions(cand.sim);
        for (const rep of replies) {
          const s2 = cloneState(cand.sim);
          Engine.applyAction(s2, rep);
          const e2 = evaluate(s2, side);               // 仍从 side 视角评估我方面面
          if (e2 < worst) worst = e2;
          if (worst < -1e8) break;                      // 已被将死，无需继续
        }
        val = worst;
      }
      if (val > bestScore) { bestScore = val; best = cand.a; }
      if (Date.now() - t0 > 1200) break;               // 时间上限，避免卡顿
    }
    return best || scored[0].a;
  }

  return { chooseAction, evaluate, VALUE, ENEMY_HIDDEN_AVG };
});
