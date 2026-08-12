/* home.js — 主页交互 */
(function () {
  const J = window.Junqi;
  let mode = 'flip';
  let opp = 'human';

  document.querySelectorAll('.opt[data-mode]').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.opt[data-mode]').forEach((x) => x.classList.remove('active'));
      el.classList.add('active');
      mode = el.dataset.mode;
    });
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    J.clearState();
    if (mode === 'flip') {
      J.saveMode('flip');
      J.go('game.html?mode=flip');
    } else {
      J.saveMode('hidden');
      J.go('layout.html?mode=hidden');
    }
  });

  const rules = document.getElementById('rulesOverlay');
  document.getElementById('rulesBtn').addEventListener('click', () => rules.classList.add('show'));
  document.getElementById('closeRules').addEventListener('click', () => rules.classList.remove('show'));
})();
