/*
 * pieces.js — 棋子定义、军队生成、吃子结算（纯函数）
 * 军衔值：司令9 > 军长8 > 师长7 > 旅长6 > 团长5 > 营长4 > 连长3 > 排长2 > 工兵1
 * 地雷/炸弹/军旗 rank = null（不参与大小比较，走特殊规则）。
 */
(function (root, factory) {
  const isNode = (typeof module !== 'undefined' && module.exports);
  const deps = isNode
    ? { Board: require('./board.js') }
    : { Board: root.Junqi.Board };
  const mod = factory(deps);
  if (isNode) module.exports = mod;
  root.Junqi = root.Junqi || {};
  root.Junqi.Pieces = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (/* {Board} */) {

  const RANKS = {
    commander: 9, general: 8, major: 7, brigadier: 6, colonel: 5,
    captain: 4, lieutenant: 3, sergeant: 2, engineer: 1,
    mine: null, bomb: null, flag: null,
  };

  // 每方 25 枚（合计 50）
  const COMPOSITION = {
    commander: 1, general: 1,
    major: 2, brigadier: 2, colonel: 2, captain: 2,
    lieutenant: 3, sergeant: 3, engineer: 3,
    mine: 3, bomb: 2, flag: 1,
  };

  const IMMOVABLE = new Set(['mine', 'flag']);

  function createArmy(side) {
    const pieces = {};
    for (const kind of Object.keys(COMPOSITION)) {
      const count = COMPOSITION[kind];
      for (let i = 0; i < count; i++) {
        const id = `${side}-${kind}-${i}`;
        pieces[id] = {
          id, side, kind, rank: RANKS[kind],
          revealed: false, alive: true, cell: null, enteredHQ: false,
        };
      }
    }
    return pieces;
  }

  /**
   * 结算一次战斗（attacker 吃 defender）。
   * 返回 { outcome, attackerDies, defenderDies, flagCaptured }
   * 约定：仅表达业务结果，不修改棋子；修改由 engine 负责。
   */
  function resolveCombat(attacker, defender, rules) {
    rules = rules || { mineHitRule: 'both' };

    // 夺取军旗：任何可移动子踩到军旗即获胜（炸弹亦同）。
    if (defender.kind === 'flag') {
      return { outcome: 'flagCaptured', attackerDies: false, defenderDies: true, flagCaptured: true };
    }
    // 炸弹：与任何子（含地雷）同归于尽；军旗已在上面处理。
    if (attacker.kind === 'bomb' || defender.kind === 'bomb') {
      return { outcome: 'both', attackerDies: true, defenderDies: true, flagCaptured: false };
    }
    // 地雷：仅工兵可排除（存活），其余碰雷依 mineHitRule。
    if (defender.kind === 'mine') {
      if (attacker.kind === 'engineer') {
        return { outcome: 'attackerWins', attackerDies: false, defenderDies: true, flagCaptured: false };
      }
      if (rules.mineHitRule === 'attackerOnly') {
        return { outcome: 'attackerDies', attackerDies: true, defenderDies: false, flagCaptured: false };
      }
      return { outcome: 'both', attackerDies: true, defenderDies: true, flagCaptured: false };
    }
    // 普通子对普通子：大吃小，同级同归于尽。
    const ar = attacker.rank, dr = defender.rank;
    if (ar > dr) return { outcome: 'attackerWins', attackerDies: false, defenderDies: true, flagCaptured: false };
    if (ar < dr) return { outcome: 'defenderWins', attackerDies: true, defenderDies: false, flagCaptured: false };
    return { outcome: 'both', attackerDies: true, defenderDies: true, flagCaptured: false };
  }

  return { RANKS, COMPOSITION, IMMOVABLE, createArmy, resolveCombat };
});
