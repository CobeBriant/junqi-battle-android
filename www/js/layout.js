/* layout.js — 暗棋布阵页（含热座遮挡交接） */
(function () {
  const J = window.Junqi, B = J.Board, Engine = J.Engine;
  const canvas = document.getElementById('layoutCanvas');
  const msgEl = document.getElementById('layoutMsg');
  const paletteEl = document.getElementById('palette');
  const titleEl = document.getElementById('title');

  const params = new URLSearchParams(location.search);
  const opp = params.get('opp') || 'human';
  const level = params.get('level') || 'normal';
  const humanSide = params.get('side') || 'black';
  let side = humanSide;

  const tempState = Engine.createGame({ mode: 'hidden' }); // 仅用于取本方棋子与随机布阵
  let view = J.createBoardView(canvas, { bottomSide: side });
  let placed = {};        // cell -> id
  let held = null;        // 当前手持的 id
  let blackLayout = null; // 黑方已确认

  function idsOfKind(kind) {
    return Object.values(tempState.pieces)
      .filter((p) => p.side === side && p.kind === kind)
      .map((p) => p.id);
  }
  function placedCount(kind) {
    return Object.values(placed).filter((id) => id.startsWith(side + '-' + kind + '-')).length;
  }

  function renderBoard() {
    const cells = [];
    for (let i = 0; i < B.N; i++) cells.push({ type: B.cellType(i), piece: null });
    for (const cell in placed) {
      const p = tempState.pieces[placed[cell]];
      cells[cell].piece = { kind: p.kind, side, revealed: true, back: false };
    }
    view.draw({ cells }, { selected: heldCell() });
  }
  function heldCell() {
    if (!held) return null;
    for (const cell in placed) if (placed[cell] === held) return Number(cell);
    return null;
  }

  function renderPalette() {
    paletteEl.innerHTML = '';
    for (const kind of J.KIND_ORDER) {
      const total = J.Board ? J.Pieces.COMPOSITION[kind] : 0;
      const used = placedCount(kind);
      const remaining = total - used;
      const chip = document.createElement('div');
      chip.className = 'pchip';
      if (remaining <= 0) chip.classList.add('empty');
      if (held && held.startsWith(side + '-' + kind + '-')) chip.classList.add('held');
      chip.innerHTML = `${J.SHORT[kind]}<span class="n">${used}/${total}</span>`;
      chip.addEventListener('click', () => onPalette(kind, remaining));
      paletteEl.appendChild(chip);
    }
    const heldTxt = held ? `已选：${J.SHORT[tempState.pieces[held].kind]}（点击己方空格落子，或再点该兵种取消）` : '请选择棋子，再点击己方半区的空格落子';
    msgEl.classList.remove('heldinfo');
    msgEl.textContent = heldTxt;
  }

  function onPalette(kind, remaining) {
    if (remaining <= 0) return;
    const heldKind = held ? held.split('-')[1] : null;
    if (held && heldKind === kind) { held = null; renderAll(); return; }
    const avail = idsOfKind(kind).find((id) => !Object.values(placed).includes(id));
    if (avail) { held = avail; J.Sound.click(); renderAll(); }
  }

  function onTap(cell) {
    if (cell < 0) return;
    if (B.cellType(cell) === 'camp') return;
    const own = J.ownCells(side);
    if (!own.includes(cell)) return;
    if (held) {
      if (placed[cell]) return;            // 该格已被占
      placed[cell] = held; held = null; J.Sound.click(); renderAll(); return;
    }
    if (placed[cell]) {                    // 拾起已布棋子
      held = placed[cell]; delete placed[cell]; J.Sound.click(); renderAll();
    }
  }

  function randomFill() {
    const lay = Engine.randomLayout(tempState, side);
    placed = {}; for (const { id, cell } of lay) placed[cell] = id;
    held = null; renderAll();
  }
  function clearAll() { placed = {}; held = null; renderAll(); }

  // —— 阵型库 ——
  function toBlackEntries() {
    // 将当前 placed（cell->id）转为黑方坐标的 [{cell, kind}]（红方则镜像）
    const out = [];
    for (const cell in placed) {
      const p = tempState.pieces[placed[cell]];
      const c = side === 'red' ? J.mirrorCell(Number(cell)) : Number(cell);
      out.push({ cell: c, kind: p.kind });
    }
    return out;
  }
  function saveFormation() {
    const name = (window.prompt('阵型名称：') || '').trim();
    if (!name) return;
    J.Formations.saveUser(name, toBlackEntries());
    msgEl.classList.add('heldinfo');
    msgEl.textContent = `已保存阵型「${name}」`;
  }
  function applyFormation(entries) {
    // entries: 黑方坐标 [{cell, kind}]；按当前 side 镜像后映射为 id
    const need = entries.map((e) => ({ cell: side === 'red' ? J.mirrorCell(e.cell) : e.cell, kind: e.kind }));
    const counts = {};
    need.forEach((e) => { counts[e.kind] = (counts[e.kind] || 0) + 1; });
    for (const k in counts) {
      if (counts[k] !== J.Pieces.COMPOSITION[k]) { msgEl.textContent = `阵型「${k}」数量不符，无法使用`; return; }
    }
    const used = new Set();
    const layout = [];
    for (const e of need) {
      const p = Object.values(tempState.pieces).find((pp) => pp.side === side && pp.kind === e.kind && !used.has(pp.id));
      if (!p) { msgEl.textContent = '阵型与可用棋子不匹配'; return; }
      used.add(p.id); layout.push({ id: p.id, cell: e.cell });
    }
    const res = Engine.applyLayout(tempState, side, layout);
    if (!res.ok) { msgEl.textContent = '阵型不合法：' + res.errors.join('；'); return; }
    placed = {}; for (const { id, cell } of layout) placed[cell] = id;
    held = null; renderAll();
  }
  function openFormations() {
    const panel = document.getElementById('formationPanel');
    const list = document.getElementById('formationList');
    list.innerHTML = '';
    const mk = (title, sub, onClick, onDel) => {
      const row = document.createElement('div');
      row.className = 'frow';
      const info = document.createElement('div');
      info.className = 'finfo';
      info.innerHTML = `<div class="fname">${title}</div><div class="fsub">${sub}</div>`;
      info.addEventListener('click', onClick);
      row.appendChild(info);
      if (onDel) {
        const del = document.createElement('button');
        del.className = 'fdel'; del.textContent = '删除';
        del.addEventListener('click', (ev) => { ev.stopPropagation(); onDel(); });
        row.appendChild(del);
      }
      list.appendChild(row);
    };
    J.Formations.PRESETS.forEach((p) => mk(p.name, p.desc, () => { applyFormation(J.Formations.presetEntries(p.name)); closeFormations(); }));
    J.Formations.listUser().forEach((u) => mk(u.name, '我的阵型',
      () => { applyFormation(J.Formations.getUser(u.name)); closeFormations(); },
      () => { if (window.confirm(`删除阵型「${u.name}」？`)) { J.Formations.removeUser(u.name); openFormations(); } }));
    panel.classList.add('show');
  }
  function closeFormations() { document.getElementById('formationPanel').classList.remove('show'); }

  function confirm() {
    const layout = Object.entries(placed).map(([cell, id]) => ({ id, cell: Number(cell) }));
    const res = Engine.applyLayout(tempState, side, layout);
    if (!res.ok) { msgEl.classList.remove('heldinfo'); msgEl.textContent = '布阵不合法：' + res.errors.join('；'); return; }
    if (opp === 'ai' && side === humanSide) {
      // 人机模式：仅人类布阵，AI 自动随机布阵后开始
      const aiSide = humanSide === 'black' ? 'red' : 'black';
      const g = Engine.createGame({ mode: 'hidden', opponent: 'ai', aiLevel: level });
      Engine.applyLayout(g, humanSide, layout);
      Engine.applyLayout(g, aiSide, Engine.randomLayout(g, aiSide));
      Engine._beginPlay(g);
      J.saveState(Engine.serialize(g));
      J.go(`game.html?mode=hidden&opp=ai&level=${level}&side=${humanSide}`);
      return;
    }
    if (side === 'black') {
      blackLayout = layout;
      side = 'red';
      placed = {}; held = null;
      view = J.createBoardView(canvas, { bottomSide: side }); view.fit();
      titleEl.textContent = '布阵 · 红方';
      document.getElementById('handoffText').textContent = '请把设备交给红方';
      document.getElementById('handoff').classList.add('show');
    } else {
      const g = Engine.createGame({ mode: 'hidden' });
      Engine.applyLayout(g, 'black', blackLayout);
      Engine.applyLayout(g, 'red', layout);
      Engine._beginPlay(g);
      J.saveState(Engine.serialize(g));
      J.go('game.html?mode=hidden');
    }
  }

  // —— 事件绑定 ——
  function relPos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }
  function onCanvas(e) {
    e.preventDefault();
    const { x, y } = relPos(e);
    onTap(view.hitTest(x, y));
  }
  canvas.addEventListener('click', onCanvas);
  canvas.addEventListener('touchstart', onCanvas, { passive: false });

  document.getElementById('randomBtn').addEventListener('click', randomFill);
  document.getElementById('clearBtn').addEventListener('click', clearAll);
  document.getElementById('confirmBtn').addEventListener('click', confirm);
  document.getElementById('backBtn').addEventListener('click', () => J.go('index.html'));
  const saveFormBtn = document.getElementById('saveFormBtn');
  if (saveFormBtn) saveFormBtn.addEventListener('click', saveFormation);
  const formLibBtn = document.getElementById('formLibBtn');
  if (formLibBtn) formLibBtn.addEventListener('click', openFormations);
  const formCloseBtn = document.getElementById('formCloseBtn');
  if (formCloseBtn) formCloseBtn.addEventListener('click', closeFormations);
  document.getElementById('handoffBtn').addEventListener('click', () => {
    document.getElementById('handoff').classList.remove('show');
    renderAll();
  });

  function renderAll() { renderBoard(); renderPalette(); }
  function fitAndRender() { view.fit(); renderAll(); }
  window.addEventListener('resize', fitAndRender);
  fitAndRender();
  J.initSettings();
})();
