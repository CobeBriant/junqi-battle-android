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
      buildGrain();
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
      const nx = -dy / len, ny = dx / len, off = cs * 0.11;
      ctx.strokeStyle = 'rgba(90,60,30,.55)'; ctx.lineWidth = Math.max(1, cs * 0.02);
      const ties = Math.max(2, Math.round(len / (cs * 0.26)));
      for (let k = 0; k <= ties; k++) {
        const f = k / ties, x = pa.x + dx * f, y = pa.y + dy * f;
        ctx.beginPath();
        ctx.moveTo(x + nx * off * 1.5, y + ny * off * 1.5);
        ctx.lineTo(x - nx * off * 1.5, y - ny * off * 1.5);
        ctx.stroke();
      }
      ctx.strokeStyle = '#caa46a'; ctx.lineWidth = Math.max(1.5, cs * 0.038);
      for (const s of [1, -1]) {
        ctx.beginPath();
        ctx.moveTo(pa.x + nx * off * s, pa.y + ny * off * s);
        ctx.lineTo(pb.x + nx * off * s, pb.y + ny * off * s);
        ctx.stroke();
      }
    }
    function drawCamp(c) {
      ctx.beginPath(); ctx.arc(c.x, c.y, cs * 0.36, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(190,210,140,.95)'; ctx.fill();
      ctx.strokeStyle = 'rgba(110,138,58,.9)'; ctx.lineWidth = Math.max(1.5, cs * 0.04); ctx.stroke();
      ctx.strokeStyle = 'rgba(110,138,58,.5)'; ctx.lineWidth = Math.max(1, cs * 0.02);
      ctx.beginPath();
      ctx.moveTo(c.x - cs * 0.22, c.y); ctx.lineTo(c.x + cs * 0.22, c.y);
      ctx.moveTo(c.x, c.y - cs * 0.22); ctx.lineTo(c.x, c.y + cs * 0.22);
      ctx.stroke();
    }
    function drawHQ(c) {
      const s = cs * 0.2;
      ctx.strokeStyle = 'rgba(140,58,47,.9)'; ctx.lineWidth = Math.max(2, cs * 0.05);
      ctx.strokeRect(c.x - s, c.y - s, 2 * s, 2 * s);
      ctx.fillStyle = 'rgba(180,60,50,.85)';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - cs * 0.12); ctx.lineTo(c.x + cs * 0.13, c.y - cs * 0.05); ctx.lineTo(c.x, c.y + cs * 0.02);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,50,40,.9)'; ctx.beginPath();
      ctx.moveTo(c.x, c.y - cs * 0.12); ctx.lineTo(c.x, c.y + cs * 0.12); ctx.stroke();
    }
    let grain = [];
    function buildGrain() {
      let seed = 987654321;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      grain = [];
      for (let i = 0; i < 16; i++) grain.push({ y: rnd() * H, amp: 3 + rnd() * 9, ph: rnd() * 6.28, w: 0.5 + rnd() * 1.3 });
    }
    function drawWoodGrain() {
      ctx.save(); ctx.globalAlpha = 0.10; ctx.strokeStyle = '#5a3a1c';
      for (const g of grain) {
        ctx.lineWidth = g.w; ctx.beginPath();
        for (let x = 0; x <= W; x += 8) {
          const y = g.y + Math.sin(x * 0.018 + g.ph) * g.amp;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawPiece(c, piece, scale, sx) {
      scale = scale || 1;
      const R = cs * 0.37 * scale;
      ctx.save();
      ctx.translate(c.x, c.y);
      if (sx != null) ctx.scale(sx, 1);
      // 落地阴影
      ctx.save(); ctx.translate(0, R * 0.14);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.96, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fill();
      ctx.restore();
      let top, bot, ring, txt;
      if (piece.back) { top = '#7c8aa0'; bot = '#3a4654'; ring = '#cdd8e6'; txt = '#e7eef7'; }
      else if (piece.side === 'black') { top = '#52525a'; bot = '#17171b'; ring = '#d8b25a'; txt = '#f4e6c0'; }
      else { top = '#e85a4f'; bot = '#8e1d18'; ring = '#ffd9a0'; txt = '#fff4e2'; }
      const g = ctx.createRadialGradient(0, -R * 0.35, R * 0.1, 0, 0, R);
      g.addColorStop(0, top); g.addColorStop(1, bot);
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = Math.max(1.5, R * 0.1); ctx.strokeStyle = ring; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, -R * 0.42, R * 0.55, R * 0.26, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.26)'; ctx.fill();
      ctx.fillStyle = txt;
      ctx.font = `700 ${Math.floor(cs * 0.3 * scale)}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(piece.back ? '軍' : (J.SHORT[piece.kind] || '?'), 0, R * 0.04);
      ctx.restore();
    }

    // model: { cells: [{type, piece|null}] }  opts: { selected, targets:Set, lastCells, skipCell, float, ring, burst }
    function draw(model, opts) {
      opts = opts || {};
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#d9b483'); bg.addColorStop(0.5, '#c79a63'); bg.addColorStop(1, '#b07f4c');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      drawWoodGrain();
      ctx.strokeStyle = 'rgba(60,35,15,.55)'; ctx.lineWidth = Math.max(3, cs * 0.1);
      ctx.strokeRect(ox - cs * 0.18, oy - cs * 0.18, cs * B.COLS + cs * 0.36, cs * B.ROWS + cs * 0.36);

      // 格位底色
      for (let i = 0; i < B.N; i++) {
        const { x, y } = cellTL(i), ty = B.cellType(i);
        ctx.fillStyle = ty === 'camp' ? 'rgba(180,205,130,.85)' : ty === 'hq' ? 'rgba(210,150,120,.9)' : 'rgba(247,236,210,.92)';
        roundRect(x + 1.5, y + 1.5, cs - 3, cs - 3, cs * 0.08); ctx.fill();
      }
      // 公路
      ctx.strokeStyle = 'rgba(80,55,25,.30)'; ctx.lineWidth = Math.max(1, cs * 0.02);
      for (const [a, b] of ROAD) lineSeg(a, b);
      // 铁路（双轨 + 枕木）
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
        ctx.fillStyle = 'rgba(80,140,255,.30)';
        roundRect(x + 1.5, y + 1.5, cs - 3, cs - 3, cs * 0.08); ctx.fill();
      }
      // 选中（脉冲光环）
      if (opts.selected != null) {
        const c = cellCenter(opts.selected);
        const pulse = 0.5 + 0.5 * Math.sin(now2() / 180);
        ctx.save();
        ctx.strokeStyle = `rgba(255,210,80,${0.6 + 0.4 * pulse})`;
        ctx.lineWidth = Math.max(2, cs * 0.06);
        ctx.beginPath(); ctx.arc(c.x, c.y, cs * (0.42 + 0.02 * pulse), 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      // 合法落点（呼吸点 / 红圈）
      if (opts.targets) for (const tg of opts.targets) {
        const c = cellCenter(tg), occ = model.cells[tg] && model.cells[tg].piece;
        if (occ) {
          ctx.strokeStyle = 'rgba(224,87,62,.95)'; ctx.lineWidth = Math.max(2, cs * 0.05);
          ctx.beginPath(); ctx.arc(c.x, c.y, cs * 0.42, 0, Math.PI * 2); ctx.stroke();
        } else {
          const spp = 0.5 + 0.5 * Math.sin(now2() / 220);
          ctx.fillStyle = `rgba(63,174,90,${0.55 + 0.35 * spp})`;
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
