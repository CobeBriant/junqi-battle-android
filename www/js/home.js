/* home.js — 主页交互 */
(function () {
  const J = window.Junqi;
  let mode = 'flip';
  let opp = 'human';
  let level = 'normal';

  document.querySelectorAll('.opt[data-mode]').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.opt[data-mode]').forEach((x) => x.classList.remove('active'));
      el.classList.add('active');
      mode = el.dataset.mode;
    });
  });

  document.querySelectorAll('.opt[data-opp]').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.opt[data-opp]').forEach((x) => x.classList.remove('active'));
      el.classList.add('active');
      opp = el.dataset.opp;
    });
  });

  document.getElementById('aiLevel').addEventListener('change', (e) => { level = e.target.value; });

  document.getElementById('startBtn').addEventListener('click', () => {
    J.Sound.click();
    J.clearState();
    J.saveMode(mode);
    const q = `mode=${mode}&opp=${opp}&level=${level}&side=black`;
    if (mode === 'flip') {
      J.go('game.html?' + q);
    } else {
      J.go('layout.html?' + q);
    }
  });

  // 「继续上局」：存在未完成存档时显示
  const resumeBtn = document.getElementById('resumeBtn');
  const saved = J.loadGame();
  if (saved && !saved.finished) {
    resumeBtn.style.display = '';
    const modeName = saved.mode === 'hidden' ? '背靠背暗棋' : '翻棋';
    const oppName = saved.opp === 'ai' ? `人机·${saved.level}` : '双人';
    resumeBtn.textContent = `继续上局（${modeName}·${oppName}）`;
    resumeBtn.addEventListener('click', () => {
      J.saveMode(saved.mode);
      J.go(`game.html?resume=1&mode=${saved.mode}&opp=${saved.opp}&level=${saved.level}&side=${saved.humanSide}`);
    });
  }

  const rules = document.getElementById('rulesOverlay');
  document.getElementById('rulesBtn').addEventListener('click', () => rules.classList.add('show'));
  document.getElementById('closeRules').addEventListener('click', () => rules.classList.remove('show'));

  J.initSettings();
})();
