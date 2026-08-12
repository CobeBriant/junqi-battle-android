/* game.js — 主对局页：两种玩法共用 Canvas 交互（支持人机对战） */
(function () {
  const J = window.Junqi, B = J.Board, Engine = J.Engine, AI = J.AI, w = window;

  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || J.loadMode() || 'flip';
  const opp = params.get('opp') || 'human';        // human=热座, ai=人机
  const level = params.get('level') || 'normal';
  const humanSide = params.get('side') || 'black';
  const aiSide = humanSide === 'black' ? 'red' : 'black';
  const aiOn = opp === 'ai';

  let S; // 引擎状态
  const resume = params.get('resume') === '1';
  const saved = resume ? J.loadGame() : null;
  if (saved && saved.state) {
    S = Engine.load(JSON.parse(saved.state));
  } else if (mode === 'hidden') {
    const raw = J.loadState();
    S = raw ? Engine.load(JSON.parse(raw)) : Engine.createGame({ mode: 'hidden' });
  } else {
    S = Engine.createGame({ mode: 'flip', opponent: aiOn ? 'ai' : 'human', aiLevel: level });
  }

  // 持久化当前对局（每步后调用，支持「继续上局」）
  function persist() {
    J.saveGame({ v: 1, mode, opp, level, humanSide, finished: !!S.result, state: Engine.serialize(S) });
  }
  persist(); // 立即落盘，保证新开对局可被续上

  let viewer = aiOn ? humanSide : S.turn;  // 人机模式下视角固定为人类，隐藏 AI 暗子
  let selected = null;
  let targets = null;
  let pendingHandoff = false;
  let aiThinking = false;

  const canvas = document.getElementById('board');
  let view;
  let animating = false;
  let revealAll = false;

  function bottomSideFor() {
    const o = J.Settings.orientation;
    const viewer = aiOn ? humanSide : S.turn;
    return o === 'auto' ? viewer : o;
  }
  function makeView() { view = J.createBoardView(canvas, { bottomSide: bottomSideFor() }); view.fit(); }
  const toastEl = document.getElementById('toast');
  const turnChip = document.getElementById('turnChip');
  const modeLabel = document.getElementById('modeLabel');
  const aiBadge = document.getElementById('aiBadge');

  // —— 渲染模型 ——
  function buildCells() {
    const cells = [];
    for (let i = 0; i < B.N; i++) cells.push({ type: B.cellType(i), piece: null });
    if (mode === 'hidden') {
      const v = Engine.viewFor(S, viewer);
      for (const id in v.pieces) {
        const p = v.pieces[id];
        if (!p.alive || p.cell == null) continue;
        if (revealAll || p.side === viewer || p.revealed)
          cells[p.cell].piece = { kind: p.kind, side: p.side, revealed: true, back: false };
      }
    } else {
      for (const id in S.pieces) {
        const p = S.pieces[id];
        if (!p.alive || p.cell == null) continue;
        cells[p.cell].piece = { kind: p.kind, side: p.side, revealed: p.revealed, back: !p.revealed };
      }
    }
    return cells;
  }

  function lastCells() {
    const lm = S.lastMove; if (!lm) return [];
    if (lm.from != null && lm.to != null) return [lm.from, lm.to];
    if (lm.pieceId) { const p = S.pieces[lm.pieceId]; if (p && p.cell != null) return [p.cell]; }
    return [];
  }

  function render() {
    view.draw({ cells: buildCells() }, { selected, targets, lastCells: lastCells() });
    turnChip.textContent = J.sideName(S.turn) + '回合';
    turnChip.className = S.turn === 'red' ? 'red' : '';
    modeLabel.textContent = (mode === 'hidden' ? '背靠背暗棋' : '翻棋') + (aiOn ? ' · 人机' : '');
  }

  // —— 交互 ——
  function pieceAt(cell) {
    if (cell == null || cell < 0) return null;
    const id = S.board[cell];
    return id ? S.pieces[id] : null;
  }
  function mySelectable(p) {
    return p && p.alive && p.cell != null && p.side === S.turn && p.revealed && !J.Pieces.IMMOVABLE.has(p.kind);
  }

  function onTap(cell) {
    if (animating) return;
    if (pendingHandoff || aiThinking || S.result) return;
    if (aiOn && S.turn !== humanSide) return;       // 非人类回合忽略点击
    const p = pieceAt(cell);
    if (selected != null && targets && targets.has(cell)) { doMove(selected, cell); return; }
    if (mode === 'flip' && p && !p.revealed) { doFlip(cell); return; }
    if (mySelectable(p)) {
      const moves = Engine.legalMoves(S, p.id);
      if (moves.length) { selected = cell; targets = new Set(moves); J.Sound.click(); render(); return; }
    }
    selected = null; targets = null; render();
  }

  function playMoveOrCapture(aKind, dKind, battle) {
    if (battle) J.Sound.capture(); else J.Sound.move();
  }

  function doMove(from, to) {
    const attacker = S.pieces[S.board[from]];
    const defenderId = S.board[to];
    const aKind = attacker.kind, dKind = defenderId ? S.pieces[defenderId].kind : null;
    const aSide = attacker.side;
    const oldTurn = S.turn;
    const willSee = (mode === 'flip') || aSide === viewer; // 该步是否在当前视角可见
    const r = Engine.applyAction(S, { type: 'move', pieceId: S.board[from], from, to });
    selected = null; targets = null;
    if (!r.ok) { J.Sound.illegal(); toast('无效移动'); render(); return; }
    playMoveOrCapture(aKind, dKind, !!r.battle);
    if (r.battle) toast(battleText(oldTurn, aKind, dKind, r.battle));
    if (willSee && !animating) {
      animating = true;
      animateMove(from, to, aKind, aSide, () => {
        if (r.battle) flashCell(to, '#e0573e', 320, () => { animating = false; afterAction(oldTurn); });
        else { animating = false; afterAction(oldTurn); }
      });
    } else {
      if (r.battle) flashCell(to, '#e0573e', 320);
      afterAction(oldTurn);
    }
  }

  function doFlip(cell) {
    const id = S.board[cell];
    const p = S.pieces[id];
    const kind = p ? p.kind : null, side = p ? p.side : null;
    const oldTurn = S.turn;
    const r = Engine.applyAction(S, { type: 'flip', pieceId: id });
    selected = null; targets = null;
    if (!r.ok) { J.Sound.illegal(); toast('无效翻棋'); render(); return; }
    J.Sound.flip();
    if (!animating) {
      animating = true;
      popCell(cell, kind, side, () => { animating = false; afterAction(oldTurn); });
    } else {
      afterAction(oldTurn);
    }
  }

  // —— 动画 ——
  function now() { return (w.performance && w.performance.now) ? w.performance.now() : Date.now(); }
  function animateMove(from, to, kind, side, done) {
    const a = view.cellCenter(from), b = view.cellCenter(to);
    const dur = 200, t0 = now();
    (function frame() {
      const t = Math.min(1, (now() - t0) / dur), e = t * t * (3 - 2 * t);
      const x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e;
      view.draw({ cells: buildCells() },
        { selected: null, targets: null, lastCells: [from, to], skipCell: to, float: { x, y, kind, side, scale: 1 } });
      if (now() - t0 < dur) w.requestAnimationFrame(frame);
      else { render(); done && done(); }
    })();
  }
  function popCell(cell, kind, side, done) {
    const c = view.cellCenter(cell);
    const dur = 180, t0 = now();
    (function frame() {
      const t = Math.min(1, (now() - t0) / dur), s = 0.5 + 0.5 * (t * t * (3 - 2 * t));
      view.draw({ cells: buildCells() }, { selected: null, targets: null, lastCells: [cell], float: { x: c.x, y: c.y, kind, side, scale: s } });
      if (now() - t0 < dur) w.requestAnimationFrame(frame);
      else { render(); done && done(); }
    })();
  }
  function flashCell(cell, color, dur, done) {
    const t0 = now();
    (function frame() {
      const t = Math.min(1, (now() - t0) / dur);
      view.draw({ cells: buildCells() }, { selected: null, targets: null, lastCells: [cell], ring: { cell, color, t } });
      if (t < 1) w.requestAnimationFrame(frame);
      else { render(); done && done(); }
    })();
  }

  function afterAction(oldTurn) {
    if (S.result) { showGameOver(); persist(); return; }
    if (!aiOn && mode === 'hidden' && S.turn !== oldTurn) {
      pendingHandoff = true;
      document.getElementById('handoffText').textContent = `请把设备交给${J.sideName(S.turn)}`;
      document.getElementById('handoff').classList.add('show');
    }
    render();
    persist();
    if (aiOn) scheduleAI();
  }

  // —— 人机：AI 回合调度 ——
  function scheduleAI() {
    if (!aiOn || S.result || S.turn !== aiSide) return;
    aiThinking = true;
    aiBadge.hidden = false;
    setTimeout(() => {
      if (S.result || S.turn !== aiSide) { aiThinking = false; aiBadge.hidden = true; return; }
      const act = AI.chooseAction(S, aiSide, level);
      aiBadge.hidden = true; aiThinking = false;
      if (!act) { render(); return; }
      const attId = act.pieceId;
      const aKind = S.pieces[attId] ? S.pieces[attId].kind : null;
      const defId = (act.type === 'move') ? S.board[act.to] : null;
      const dKind = defId ? S.pieces[defId].kind : null;
      const oldTurn = S.turn;
      const r = Engine.applyAction(S, act);
      if (!r.ok) {
        const acts = Engine.allLegalActions(S);
        if (acts.length) Engine.applyAction(S, acts[0]); // 兜底：随机一步避免卡死
      } else {
        playMoveOrCapture(aKind, dKind, !!r.battle);
        if (r.battle) toast(battleText(oldTurn, aKind, dKind, r.battle));
      }
      render();
      if (S.result) showGameOver();
      persist();
    }, 350);
  }

  function battleText(turn, aKind, dKind, battle) {
    const me = J.sideName(turn);
    if (battle.flagCaptured) return `${me} 夺得军旗，获胜！`;
    const aN = J.SHORT[aKind], dN = J.SHORT[dKind];
    if (battle.outcome === 'attackerWins') return `${me} ${aN} 吃 ${dN}`;
    if (battle.outcome === 'defenderWins') return `${me} ${aN} 被 ${dN} 击毁`;
    return `${me} ${aN} 与 ${dN} 同归于尽`;
  }

  function reasonText(reason) {
    return { flag: '夺旗', nomove: '对方无子可动', draw: '长时间无战斗判和' }[reason] || reason;
  }
  function showGameOver() {
    const { winner, reason } = S.result;
    const txt = winner
      ? `${J.sideName(winner)}获胜（${reasonText(reason)}）`
      : `平局（${reasonText(reason)}）`;
    document.getElementById('resultText').textContent = txt;
    document.getElementById('gameover').classList.add('show');
    if (winner) J.Sound.win(); else J.Sound.lose();
  }

  // —— 顶栏按钮 ——
  function undo() {
    if (!S.history.length) return;
    if (aiOn) {
      // 多步悔棋：一直退到「轮到人类」，避免退到 AI 回合后又被自动重走
      do { Engine.undo(S); } while (S.history.length && S.turn !== humanSide);
      viewer = humanSide;
      pendingHandoff = false;
    } else {
      Engine.undo(S);
      viewer = S.turn;
      if (mode === 'hidden') { pendingHandoff = true; document.getElementById('handoffText').textContent = `请交回${J.sideName(S.turn)}`; }
    }
    selected = null; targets = null;
    render();
    if (pendingHandoff) document.getElementById('handoff').classList.add('show');
    // 注意：悔棋后不自动调度 AI，交回人类决策
  }
  function restart() {
    if (resume && saved && saved.state && !saved.finished) {
      // 续局模式下的「重开」= 回到本局存档起点（即从存档复位）
      S = Engine.load(JSON.parse(saved.state));
    } else if (mode === 'hidden') {
      const raw = J.loadState();
      S = raw ? Engine.load(JSON.parse(raw)) : Engine.createGame({ mode: 'hidden' });
    } else {
      S = Engine.createGame({ mode: 'flip', opponent: aiOn ? 'ai' : 'human', aiLevel: level });
    }
    viewer = aiOn ? humanSide : S.turn;
    selected = null; targets = null; pendingHandoff = false; aiThinking = false; revealAll = false;
    aiBadge.hidden = true;
    document.getElementById('gameover').classList.remove('show');
    persist();
    render();
    if (aiOn) scheduleAI();
  }

  // —— 事件 ——
  function relPos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }
  function onCanvas(e) { e.preventDefault(); const { x, y } = relPos(e); onTap(view.hitTest(x, y)); }
  canvas.addEventListener('click', onCanvas);
  canvas.addEventListener('touchstart', onCanvas, { passive: false });

  document.getElementById('homeBtn').addEventListener('click', () => J.go('index.html'));
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('restartBtn').addEventListener('click', restart);
  document.getElementById('handoffBtn').addEventListener('click', () => {
    document.getElementById('handoff').classList.remove('show');
    pendingHandoff = false; viewer = S.turn; render();
  });
  document.getElementById('againBtn').addEventListener('click', restart);
  document.getElementById('toHomeBtn').addEventListener('click', () => J.go('index.html'));
  const revealBtn = document.getElementById('revealBtn');
  if (revealBtn) revealBtn.addEventListener('click', () => { revealAll = true; render(); });

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  function fitAndRender() { if (!view) makeView(); else view.fit(); render(); }
  window.addEventListener('resize', fitAndRender);

  // 视角（设置）变化时重建棋盘视图
  J.Settings.subscribe(() => { if (view) { makeView(); render(); } });

  // 初始：暗棋热座需先交接给先手
  makeView();
  fitAndRender();
  if (!aiOn && mode === 'hidden') {
    pendingHandoff = true;
    document.getElementById('handoffText').textContent = `请把设备交给${J.sideName(S.turn)}`;
    document.getElementById('handoff').classList.add('show');
  }
  if (aiOn) scheduleAI();   // 若 AI 先手则立即行动（当前人类先手，通常为空操作）
  J.initSettings();
})();
