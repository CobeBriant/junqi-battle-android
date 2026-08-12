/* game.js — 主对局页：两种玩法共用 Canvas 交互（支持人机对战） */
(function () {
  const J = window.Junqi, B = J.Board, Engine = J.Engine, AI = J.AI;

  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || J.loadMode() || 'flip';
  const opp = params.get('opp') || 'human';        // human=热座, ai=人机
  const level = params.get('level') || 'normal';
  const humanSide = params.get('side') || 'black';
  const aiSide = humanSide === 'black' ? 'red' : 'black';
  const aiOn = opp === 'ai';

  let S; // 引擎状态
  if (mode === 'hidden') {
    const raw = J.loadState();
    S = raw ? Engine.load(JSON.parse(raw)) : Engine.createGame({ mode: 'hidden' });
  } else {
    S = Engine.createGame({ mode: 'flip', opponent: aiOn ? 'ai' : 'human', aiLevel: level });
  }

  let viewer = aiOn ? humanSide : S.turn;  // 人机模式下视角固定为人类，隐藏 AI 暗子
  let selected = null;
  let targets = null;
  let pendingHandoff = false;
  let aiThinking = false;

  const canvas = document.getElementById('board');
  const view = J.createBoardView(canvas);
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
        if (p.side !== viewer && !p.revealed) continue; // 敌方未揭示不可见
        cells[p.cell].piece = { kind: p.kind, side: p.side, revealed: p.revealed, back: false };
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
    if (pendingHandoff || aiThinking || S.result) return;
    if (aiOn && S.turn !== humanSide) return;       // 非人类回合忽略点击
    const p = pieceAt(cell);
    if (selected != null && targets && targets.has(cell)) { doMove(selected, cell); return; }
    if (mode === 'flip' && p && !p.revealed) { doFlip(cell); return; }
    if (mySelectable(p)) {
      const moves = Engine.legalMoves(S, p.id);
      if (moves.length) { selected = cell; targets = new Set(moves); render(); return; }
    }
    selected = null; targets = null; render();
  }

  function doMove(from, to) {
    const attacker = S.pieces[S.board[from]];
    const defenderId = S.board[to];
    const aKind = attacker.kind, dKind = defenderId ? S.pieces[defenderId].kind : null;
    const oldTurn = S.turn;
    const r = Engine.applyAction(S, { type: 'move', pieceId: S.board[from], from, to });
    selected = null; targets = null;
    if (!r.ok) { toast('无效移动'); render(); return; }
    if (r.battle) toast(battleText(oldTurn, aKind, dKind, r.battle));
    afterAction(oldTurn);
  }

  function doFlip(cell) {
    const id = S.board[cell];
    const oldTurn = S.turn;
    const r = Engine.applyAction(S, { type: 'flip', pieceId: id });
    selected = null; targets = null;
    if (!r.ok) { toast('无效翻棋'); render(); return; }
    afterAction(oldTurn);
  }

  function afterAction(oldTurn) {
    if (S.result) { showGameOver(); return; }
    if (!aiOn && mode === 'hidden' && S.turn !== oldTurn) {
      pendingHandoff = true;
      document.getElementById('handoffText').textContent = `请把设备交给${J.sideName(S.turn)}`;
      document.getElementById('handoff').classList.add('show');
    }
    render();
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
      } else if (r.battle) {
        toast(battleText(oldTurn, aKind, dKind, r.battle));
      }
      render();
      if (S.result) showGameOver();
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
  }

  // —— 顶栏按钮 ——
  function undo() {
    if (!S.history.length) return;
    Engine.undo(S);
    selected = null; targets = null;
    if (aiOn) { viewer = humanSide; pendingHandoff = false; }
    else { viewer = S.turn; if (mode === 'hidden') { pendingHandoff = true; document.getElementById('handoffText').textContent = `请交回${J.sideName(S.turn)}`; } }
    render();
    if (pendingHandoff) document.getElementById('handoff').classList.add('show');
    if (aiOn) scheduleAI();      // 若回退到 AI 回合，AI 重新行动
  }
  function restart() {
    if (mode === 'hidden') {
      const raw = J.loadState();
      S = raw ? Engine.load(JSON.parse(raw)) : Engine.createGame({ mode: 'hidden' });
    } else {
      S = Engine.createGame({ mode: 'flip', opponent: aiOn ? 'ai' : 'human', aiLevel: level });
    }
    viewer = aiOn ? humanSide : S.turn;
    selected = null; targets = null; pendingHandoff = false; aiThinking = false;
    aiBadge.hidden = true;
    document.getElementById('gameover').classList.remove('show');
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

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
  }

  function fitAndRender() { view.fit(); render(); }
  window.addEventListener('resize', fitAndRender);

  // 初始：暗棋热座需先交接给先手
  fitAndRender();
  if (!aiOn && mode === 'hidden') {
    pendingHandoff = true;
    document.getElementById('handoffText').textContent = `请把设备交给${J.sideName(S.turn)}`;
    document.getElementById('handoff').classList.add('show');
  }
  if (aiOn) scheduleAI();   // 若 AI 先手则立即行动（当前人类先手，通常为空操作）
})();
