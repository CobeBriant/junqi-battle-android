/*
 * common.js — 跨页面共享：命名空间、棋子标签、棋盘渲染器 BoardView、存储与导航。
 * 依赖（按序在 HTML 中引入）：board.js, pieces.js, engine.js
 */
(function () {
  const w = window;
  const J = (w.Junqi = w.Junqi || {});
  const B = J.Board, P = J.Pieces;

  // 棋子短名（2 字）
  J.SHORT = {
    commander: '司令', general: '军长', major: '师长', brigadier: '旅长',
    colonel: '团长', captain: '营长', lieutenant: '连长', sergeant: '排长',
    engineer: '工兵', mine: '地雷', bomb: '炸弹', flag: '军旗',
  };
  J.KIND_ORDER = [
    'commander', 'general', 'major', 'brigadier', 'colonel', 'captain',
    'lieutenant', 'sergeant', 'engineer', 'mine', 'bomb', 'flag',
  ];
  J.sideName = (s) => (s === 'black' ? '黑方' : s === 'red' ? '红方' : '—');

  // —— 存储（页面间传递对局状态）——
  const KEY_STATE = 'junqi_state';
  const KEY_MODE = 'junqi_mode';
  J.saveState = (json) => { try { sessionStorage.setItem(KEY_STATE, json); } catch (e) {} };
  J.loadState = () => { try { return sessionStorage.getItem(KEY_STATE); } catch (e) { return null; } };
  J.clearState = () => { try { sessionStorage.removeItem(KEY_STATE); } catch (e) {} };
  J.saveMode = (m) => { try { sessionStorage.setItem(KEY_MODE, m); } catch (e) {} };
  J.loadMode = () => { try { return sessionStorage.getItem(KEY_MODE); } catch (e) { return null; } };

  // —— 对局存档（跨会话持久，支持「继续上局」）——
  const KEY_SAVE = 'junqi_save_v1';
  J.saveGame = (cfg) => { try { localStorage.setItem(KEY_SAVE, JSON.stringify(cfg)); } catch (e) {} };
  J.loadGame = () => { try { const s = localStorage.getItem(KEY_SAVE); return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  J.clearGame = () => { try { localStorage.removeItem(KEY_SAVE); } catch (e) {} };
  J.hasUnfinishedGame = () => { const g = J.loadGame(); return !!(g && !g.finished); };

  J.go = (page) => { w.location.href = page; };

  // 镜像格位：黑方坐标 <-> 红方坐标（r' = 11 - r，列不变）
  J.mirrorCell = (cell) => { const { r, c } = B.rc(cell); return B.idx(11 - r, c); };

  // —— 阵型库（仅暗棋布阵使用）——
  // 约定：所有阵型均以黑方坐标存储；红方使用时镜像。
  J.Formations = (function () {
    const KEY = 'junqi_formations_v1';
    const readAll = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
    const writeAll = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} };
    const PRESETS = (J.Presets && J.Presets.PRESETS) || [];
    return {
      PRESETS,
      presetEntries(name) { const p = PRESETS.find((x) => x.name === name); return p ? p.entries.map((e) => ({ cell: e.cell, kind: e.kind })) : null; },
      listUser() { const o = readAll(); return Object.keys(o).map((k) => ({ name: k, createdAt: o[k].createdAt })); },
      saveUser(name, entriesBlack) { const o = readAll(); o[name] = { entries: entriesBlack, createdAt: Date.now() }; writeAll(o); },
      getUser(name) { const o = readAll(); return o[name] ? o[name].entries : null; },
      removeUser(name) { const o = readAll(); delete o[name]; writeAll(o); },
    };
  })();

  // —— 棋盘渲染器 ——
  // createBoardView(canvas, opts) 返回 { draw(model, opts), cellCenter, hitTest, fit }
  // opts.bottomSide: 'red'(默认，红在下) | 'black'(黑在下) —— 控制整盘上下翻转
  J.createBoardView = function (canvas, opts) {
    opts = opts || {};
    const bottomSide = opts.bottomSide || 'red';
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, cs = 0, ox = 0, oy = 0;
    const now2 = () => (w.performance && w.performance.now ? w.performance.now() : Date.now());

    const RAIL = [], ROAD = [];
    for (let i = 0; i < B.N; i++) {
      for (const j of B.railAdj[i]) if (j > i) RAIL.push([i, j]);
      for (const j of B.roadAdj[i]) if (j > i) ROAD.push([i, j]);
    }

    function fit() {
      const rect = canvas.getBoundingClientRect();
      const dpr = w.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = rect.width; H = rect.height;
      const PAD = 6;
      cs = Math.floor(Math.min((W - 2 * PAD) / B.COLS, (H - 2 * PAD) / B.ROWS));
      ox = Math.floor((W - cs * B.COLS) / 2);
      oy = Math.floor((H - cs * B.ROWS) / 2);
    }

    // 视角翻转：bottomSide='black' 时把整盘上下颠倒，使黑方在下方
    const dispRow = (r) => (bottomSide === 'black' ? B.ROWS - 1 - r : r);
    const modelRow = (dr) => (bottomSide === 'black' ? B.ROWS - 1 - dr : dr);

    function cellTL(cell) { const { r, c } = B.rc(cell); const dr = dispRow(r); return { x: ox + c * cs, y: oy + dr * cs }; }
    function cellCenter(cell) { const { x, y } = cellTL(cell); return { x: x + cs / 2, y: y + cs / 2 }; }
    function hitTest(px, py) {
      const c = Math.floor((px - ox) / cs), dr = Math.floor((py - oy) / cs);
      if (c < 0 || c >= B.COLS || dr < 0 || dr >= B.ROWS) return -1;
      return B.idx(modelRow(dr), c);
    }

    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function lineSeg(a, b) {
      const pa = cellCenter(a), pb = cellCenter(b);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    function drawRail(a, b) {
      const pa = cellCenter(a), pb = cellCenter(b);
      const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len, off = cs * 0.06;
      ctx.strokeStyle = '#aeb8c7'; ctx.lineWidth = Math.max(1, cs * 0.022);
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(pa.x + nx * off * s, pa.y + ny * off * s);
        ctx.lineTo(pb.x + nx * off * s, pb.y + ny * off * s);
        ctx.stroke();
      }
    }
    function drawCamp(c) {
      ctx.beginPath(); ctx.arc(c.x, c.y, cs * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99,102,241,.08)'; ctx.fill();
      ctx.strokeStyle = 'rgba(99,102,241,.5)'; ctx.lineWidth = Math.max(1, cs * 0.025); ctx.stroke();
      ctx.beginPath(); ctx.arc(c.x, c.y, cs * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(99,102,241,.55)'; ctx.fill();
    }
    function drawHQ(c) {
      const s = cs * 0.2;
      ctx.strokeStyle = 'rgba(239,68,68,.6)'; ctx.lineWidth = Math.max(1.5, cs * 0.035);
      ctx.strokeRect(c.x - s, c.y - s, 2 * s, 2 * s);
      ctx.fillStyle = 'rgba(239,68,68,.92)';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - cs * 0.14); ctx.lineTo(c.x + cs * 0.14, c.y - cs * 0.06); ctx.lineTo(c.x, c.y + cs * 0.02);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(239,68,68,.92)'; ctx.lineWidth = Math.max(1, cs * 0.02);
      ctx.beginPath(); ctx.moveTo(c.x, c.y - cs * 0.14); ctx.lineTo(c.x, c.y + cs * 0.14); ctx.stroke();
    }

    function drawPiece(c, piece, scale, sx) {
      scale = scale || 1;
      const R = cs * 0.36 * scale;
      ctx.save();
      ctx.translate(c.x, c.y);
      if (sx != null) ctx.scale(sx, 1);
      // 柔和投影
      ctx.save();
      ctx.shadowColor = 'rgba(15,23,42,.22)'; ctx.shadowBlur = R * 0.45; ctx.shadowOffsetY = R * 0.16;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.restore();
      let fill;
      if (piece.back) fill = '#cbd2dc';
      else if (piece.side === 'black') fill = '#2b313b';
      else fill = '#ef4444';
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = Math.max(1, R * 0.04); ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.floor(cs * 0.28 * scale)}px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(piece.back ? '?' : (J.SHORT[piece.kind] || '?'), 0, R * 0.02);
      ctx.restore();
    }

    // model: { cells: [{type, piece|null}] }  opts: { selected, targets:Set, lastCells, skipCell, float, ring, burst }
    function draw(model, opts) {
      opts = opts || {};
      ctx.clearRect(0, 0, W, H);
      // 应用底色
      ctx.fillStyle = '#eef1f6'; ctx.fillRect(0, 0, W, H);
      // 棋盘卡片（白底 + 柔和阴影 + 圆角）
      const padX = ox - cs * 0.22, padY = oy - cs * 0.22;
      const bw = cs * B.COLS + cs * 0.44, bh = cs * B.ROWS + cs * 0.44;
      ctx.save();
      ctx.shadowColor = 'rgba(20,30,60,.14)'; ctx.shadowBlur = cs * 0.22; ctx.shadowOffsetY = cs * 0.05;
      roundRect(padX, padY, bw, bh, cs * 0.16); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.restore();

      // 格位（淡色圆角块）
      for (let i = 0; i < B.N; i++) {
        const { x, y } = cellTL(i), ty = B.cellType(i);
        ctx.fillStyle = ty === 'camp' ? 'rgba(99,102,241,.06)' : ty === 'hq' ? 'rgba(239,68,68,.05)' : 'rgba(241,243,247,1)';
        roundRect(x + 1, y + 1, cs - 2, cs - 2, cs * 0.1); ctx.fill();
      }
      // 网格线（极淡）
      ctx.strokeStyle = 'rgba(15,23,42,.06)'; ctx.lineWidth = 1;
      for (let r = 0; r <= B.ROWS; r++) { const y = oy + r * cs; ctx.beginPath(); ctx.moveTo(ox, y); ctx.lineTo(ox + B.COLS * cs, y); ctx.stroke(); }
      for (let c = 0; c <= B.COLS; c++) { const x = ox + c * cs; ctx.beginPath(); ctx.moveTo(x, oy); ctx.lineTo(x, oy + B.ROWS * cs); ctx.stroke(); }

      // 公路（细灰）
      ctx.strokeStyle = 'rgba(148,163,184,.55)'; ctx.lineWidth = Math.max(1, cs * 0.018);
      for (const [a, b] of ROAD) lineSeg(a, b);
      // 铁路（双轨）
      for (const [a, b] of RAIL) drawRail(a, b);
      // 行营 & 大本营
      for (let i = 0; i < B.N; i++) {
        const ty = B.cellType(i), c = cellCenter(i);
        if (ty === 'hq') drawHQ(c);
        if (ty === 'camp') drawCamp(c);
      }
      // 上一手高亮
      if (opts.lastCells) for (const cell of opts.lastCells) {
        if (cell == null) continue;
        const { x, y } = cellTL(cell);
        ctx.fillStyle = 'rgba(79,70,229,.14)';
        roundRect(x + 1, y + 1, cs - 2, cs - 2, cs * 0.1); ctx.fill();
      }
      // 选中（脉冲光环 · 现代蓝）
      if (opts.selected != null) {
        const c = cellCenter(opts.selected);
        const pulse = 0.5 + 0.5 * Math.sin(now2() / 180);
        ctx.save();
        ctx.strokeStyle = `rgba(79,70,229,${0.65 + 0.35 * pulse})`;
        ctx.lineWidth = Math.max(2, cs * 0.05);
        ctx.beginPath(); ctx.arc(c.x, c.y, cs * (0.42 + 0.02 * pulse), 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // 合法落点（呼吸点 / 红圈）
      if (opts.targets) for (const tg of opts.targets) {
        const c = cellCenter(tg), occ = model.cells[tg] && model.cells[tg].piece;
        if (occ) {
          ctx.strokeStyle = 'rgba(239,68,68,.9)'; ctx.lineWidth = Math.max(2, cs * 0.045);
          ctx.beginPath(); ctx.arc(c.x, c.y, cs * 0.42, 0, Math.PI * 2); ctx.stroke();
        } else {
          const spp = 0.5 + 0.5 * Math.sin(now2() / 220);
          ctx.fillStyle = `rgba(22,163,74,${0.55 + 0.35 * spp})`;
          ctx.beginPath(); ctx.arc(c.x, c.y, cs * (0.13 + 0.02 * spp), 0, Math.PI * 2); ctx.fill();
        }
      }
      // 棋子
      for (let i = 0; i < B.N; i++) {
        if (opts.skipCell === i) continue;
        const piece = model.cells[i].piece;
        if (piece) drawPiece(cellCenter(i), piece);
      }
      // 浮层（移动中的棋子 / 翻棋）
      if (opts.float) drawPiece({ x: opts.float.x, y: opts.float.y },
        { kind: opts.float.kind, side: opts.float.side, back: !!opts.float.back }, opts.float.scale || 1, opts.float.sx);
      // 碰撞闪环
      if (opts.ring) {
        const rc = cellCenter(opts.ring.cell);
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - opts.ring.t);
        ctx.beginPath();
        ctx.arc(rc.x, rc.y, cs * (0.62 - 0.4 * opts.ring.t), 0, Math.PI * 2);
        ctx.strokeStyle = opts.ring.color; ctx.lineWidth = Math.max(2, cs * 0.06); ctx.stroke();
        ctx.restore();
      }
      // 粒子爆裂
      if (opts.burst) for (const p of opts.burst) {
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p.t);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - p.t * 0.4), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }

    return { draw, cellCenter, hitTest, fit, get cellSize() { return cs; } };
  };

  // 本方可布格（排除行营，按半区）
  J.ownCells = function (side) {
    const out = [];
    for (let r = 0; r < 12; r++) for (let c = 0; c < 5; c++) {
      const cell = B.idx(r, c);
      if (B.cellType(cell) === 'camp') continue;
      if (side === 'black' && r > 5) continue;
      if (side === 'red' && r < 6) continue;
      out.push(cell);
    }
    return out;
  };
})();
