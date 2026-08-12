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
  // createBoardView(canvas) 返回 { draw(model, opts), cellCenter, hitTest, fit }
  J.createBoardView = function (canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, cs = 0, ox = 0, oy = 0;

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

    function cellTL(cell) { const { r, c } = B.rc(cell); return { x: ox + c * cs, y: oy + r * cs }; }
    function cellCenter(cell) { const { x, y } = cellTL(cell); return { x: x + cs / 2, y: y + cs / 2 }; }
    function hitTest(px, py) {
      const c = Math.floor((px - ox) / cs), r = Math.floor((py - oy) / cs);
      if (!B.inBounds(r, c)) return -1;
      return B.idx(r, c);
    }

    function drawPiece(c, piece) {
      const radius = cs * 0.36;
      if (piece.back) {
        ctx.beginPath(); ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#54657a'; ctx.fill();
        ctx.strokeStyle = '#2c3845'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#dde6f0';
        ctx.font = `${Math.floor(cs * 0.3)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('軍', c.x, c.y + 1);
        return;
      }
      ctx.beginPath(); ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = piece.side === 'black' ? '#2c2c2c' : '#b3302a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.floor(cs * 0.25)}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(J.SHORT[piece.kind] || '?', c.x, c.y + 1);
    }

    // model: { cells: [{type, piece|null}] }  opts: { selected, targets:Set, lastCells:[] }
    function draw(model, opts) {
      opts = opts || {};
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#e8d9b5'; ctx.fillRect(0, 0, W, H);

      // 格位底色
      for (let i = 0; i < B.N; i++) {
        const { x, y } = cellTL(i);
        const t = B.cellType(i);
        ctx.fillStyle = t === 'camp' ? '#cfe0a8' : t === 'hq' ? '#d8b7a0' : '#f3ead0';
        ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
      }
      // 公路（细）
      ctx.strokeStyle = 'rgba(90,70,40,.30)'; ctx.lineWidth = 1;
      for (const [a, b] of ROAD) {
        const pa = cellCenter(a), pb = cellCenter(b);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
      // 铁路（粗）
      ctx.strokeStyle = '#7a5230'; ctx.lineWidth = Math.max(2, cs * 0.06);
      for (const [a, b] of RAIL) {
        const pa = cellCenter(a), pb = cellCenter(b);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
      }
      // 行营圆 & 大本营标记
      for (let i = 0; i < B.N; i++) {
        const t = B.cellType(i), c = cellCenter(i);
        if (t === 'hq') {
          ctx.strokeStyle = '#8b3a2f'; ctx.lineWidth = 2;
          const s = cs * 0.18; ctx.strokeRect(c.x - s, c.y - s, 2 * s, 2 * s);
        }
        if (t === 'camp') {
          ctx.beginPath(); ctx.arc(c.x, c.y, cs * 0.34, 0, Math.PI * 2);
          ctx.fillStyle = '#b9cf86'; ctx.fill();
          ctx.strokeStyle = '#6f8a3a'; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
      // 上一手高亮
      if (opts.lastCells) for (const cell of opts.lastCells) {
        if (cell == null) continue;
        const { x, y } = cellTL(cell);
        ctx.fillStyle = 'rgba(79,140,255,.28)';
        ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2);
      }
      // 选中格环
      if (opts.selected != null) {
        const { x, y } = cellTL(opts.selected);
        ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 3;
        ctx.strokeRect(x + 2, y + 2, cs - 4, cs - 4);
      }
      // 合法落点
      if (opts.targets) for (const t of opts.targets) {
        const c = cellCenter(t);
        if (model.cells[t] && model.cells[t].piece) {
          ctx.strokeStyle = '#e0573e'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(c.x, c.y, cs * 0.4, 0, Math.PI * 2); ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(63,174,90,.85)';
          ctx.beginPath(); ctx.arc(c.x, c.y, cs * 0.13, 0, Math.PI * 2); ctx.fill();
        }
      }
      // 棋子
      for (let i = 0; i < B.N; i++) {
        const piece = model.cells[i].piece;
        if (piece) drawPiece(cellCenter(i), piece);
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
