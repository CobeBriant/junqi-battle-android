/*
 * presets.js — 内置阵型预设（仅暗棋布阵使用）。
 * 坐标约定：以黑方半区为基准（行 0..5，行 0 为大本营所在后排）。
 * 红方使用时由 J.mirrorCell 镜像到己方半区。
 * 依赖（按序引入）：board.js（提供 Junqi.Board.idx）。可在 Node 中 require 进行单测。
 */
(function (root, factory) {
  const Board = (root.Junqi && root.Junqi.Board) || (typeof require !== 'undefined' ? require('./board.js') : null);
  const mod = factory(Board);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root.Junqi) root.Junqi.Presets = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Board) {
  const ent = (r, c, kind) => ({ cell: Board.idx(r, c), kind });

  // 三种预设：均衡 / 进攻 / 防守。每种 25 枚，落点均合法（避开行营、军旗入大本营、地雷在后两排、炸弹不在第一排）。
  const PRESETS = [
    {
      name: '均衡', desc: '攻守平衡 · 大子居中',
      entries: [
        ent(0, 0, 'commander'), ent(0, 1, 'flag'), ent(0, 2, 'engineer'), ent(0, 3, 'mine'), ent(0, 4, 'major'),
        ent(1, 0, 'mine'), ent(1, 1, 'bomb'), ent(1, 2, 'general'), ent(1, 3, 'lieutenant'), ent(1, 4, 'mine'),
        ent(2, 0, 'sergeant'), ent(2, 2, 'brigadier'), ent(2, 4, 'engineer'),
        ent(3, 0, 'lieutenant'), ent(3, 1, 'colonel'), ent(3, 3, 'bomb'), ent(3, 4, 'captain'),
        ent(4, 0, 'sergeant'), ent(4, 2, 'major'), ent(4, 4, 'engineer'),
        ent(5, 0, 'lieutenant'), ent(5, 1, 'brigadier'), ent(5, 2, 'sergeant'), ent(5, 3, 'captain'), ent(5, 4, 'colonel'),
      ],
    },
    {
      name: '进攻', desc: '大子压前 · 抢攻',
      entries: [
        ent(0, 0, 'bomb'), ent(0, 1, 'flag'), ent(0, 2, 'mine'), ent(0, 3, 'mine'), ent(0, 4, 'bomb'),
        ent(1, 0, 'mine'), ent(1, 1, 'engineer'), ent(1, 2, 'sergeant'), ent(1, 3, 'sergeant'), ent(1, 4, 'engineer'),
        ent(2, 0, 'lieutenant'), ent(2, 2, 'lieutenant'), ent(2, 4, 'brigadier'),
        ent(3, 0, 'major'), ent(3, 1, 'captain'), ent(3, 3, 'engineer'), ent(3, 4, 'major'),
        ent(4, 0, 'brigadier'), ent(4, 2, 'colonel'), ent(4, 4, 'sergeant'),
        ent(5, 0, 'commander'), ent(5, 1, 'general'), ent(5, 2, 'colonel'), ent(5, 3, 'captain'), ent(5, 4, 'lieutenant'),
      ],
    },
    {
      name: '防守', desc: '军旗深藏 · 雷阵护旗',
      entries: [
        ent(0, 0, 'bomb'), ent(0, 1, 'flag'), ent(0, 2, 'mine'), ent(0, 3, 'mine'), ent(0, 4, 'bomb'),
        ent(1, 0, 'mine'), ent(1, 1, 'commander'), ent(1, 2, 'general'), ent(1, 3, 'sergeant'), ent(1, 4, 'lieutenant'),
        ent(2, 0, 'major'), ent(2, 2, 'brigadier'), ent(2, 4, 'engineer'),
        ent(3, 0, 'lieutenant'), ent(3, 1, 'colonel'), ent(3, 3, 'engineer'), ent(3, 4, 'captain'),
        ent(4, 0, 'sergeant'), ent(4, 2, 'major'), ent(4, 4, 'engineer'),
        ent(5, 0, 'lieutenant'), ent(5, 1, 'brigadier'), ent(5, 2, 'sergeant'), ent(5, 3, 'captain'), ent(5, 4, 'colonel'),
      ],
    },
  ];

  return { PRESETS };
});
