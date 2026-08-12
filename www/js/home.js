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
    J.clearState();
    J.saveMode(mode);
    const q = `mode=${mode}&opp=${opp}&level=${level}&side=black`;
    if (mode === 'flip') {
      J.go('game.html?' + q);
    } else {
      J.go('layout.html?' + q);
    }
  });

  const rules = document.getElementById('rulesOverlay');
  document.getElementById('rulesBtn').addEventListener('click', () => rules.classList.add('show'));
  document.getElementById('closeRules').addEventListener('click', () => rules.classList.remove('show'));
})();
