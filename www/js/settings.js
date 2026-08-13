/*
 * settings.js — 跨页面设置（音效 / 视角 / 规则约定）。
 * 依赖：sound.js（可选，用于首次交互解锁音频）。在页面 JS 末尾调用 J.initSettings()。
 */
(function () {
  const w = window;
  const J = (w.Junqi = w.Junqi || {});

  // —— 设置持久化 ——
  const KEY = 'junqi_settings_v1';
  const subscribers = [];
  const DEFAULTS = { sound: true, orientation: 'auto' }; // orientation: auto|black|red
  function load() {
    let s = Object.assign({}, DEFAULTS);
    try { const raw = localStorage.getItem(KEY); if (raw) s = Object.assign(s, JSON.parse(raw)); } catch (e) {}
    return s;
  }
  function persist(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  let cur = load();

  J.Settings = {
    get sound() { return cur.sound; },
    get orientation() { return cur.orientation; },
    set(key, val) {
      cur[key] = val; persist(cur);
      subscribers.forEach((fn) => { try { fn(key, val); } catch (e) {} });
    },
    subscribe(fn) { subscribers.push(fn); },
  };

  // —— UI ——
  const RULES_HTML = `
    <div class="rulesmini">
      <div><b>翻棋</b>：每回合翻子或走明子；大吃小、同级同归于尽。</div>
      <div><b>暗棋</b>：双方暗布阵型，系统当裁判；夺旗 / 无子可动 / 久战无果判胜负。</div>
      <div>地雷碰炸同亡 · 工兵可拐弯排雷 · 炸弹同归于尽 · 踩旗即胜。</div>
      <div>规则决策已锁定（详见项目 docs/规则说明.md）。</div>
    </div>`;

  function ensureStyles() {
    if (document.getElementById('settings-style')) return;
    const s = document.createElement('style'); s.id = 'settings-style';
    s.textContent = `
    .gearbtn{position:fixed;right:14px;bottom:14px;z-index:60;width:46px;height:46px;border-radius:50%;
      background:#ffffff;color:#4f46e5;border:1px solid rgba(15,23,42,.08);box-shadow:0 6px 18px rgba(15,23,42,.18);
      font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;}
    .gearbtn:active{transform:scale(.94);}
    .gswitch{display:flex;align-items:center;justify-content:space-between;padding:11px 2px;border-bottom:1px solid rgba(15,23,42,.08);}
    .gswitch .lbl{font-size:15px;color:#1f2933;}
    .gswitch select{background:#f1f3f7;color:#1f2933;border:1px solid rgba(15,23,42,.12);border-radius:8px;padding:7px 10px;font-size:14px;}
    .rulesmini{text-align:left;font-size:12px;color:#7b8794;line-height:1.6;background:#f1f3f7;border-radius:10px;padding:10px 12px;margin:12px 0;}
    .rulesmini b{color:#4f46e5;}
    `;
    document.head.appendChild(s);
  }

  function buildOverlay() {
    const ov = document.createElement('div');
    ov.className = 'overlay'; ov.id = 'settingsOverlay';
    ov.innerHTML = `
      <div class="box">
        <h2>设置</h2>
        <div class="gswitch"><span class="lbl">音效</span>
          <select id="setSound"><option value="1">开</option><option value="0">关</option></select></div>
        <div class="gswitch"><span class="lbl">视角（我方在下）</span>
          <select id="setOri">
            <option value="auto">自动（当前操作方在下）</option>
            <option value="black">黑方在下</option>
            <option value="red">红方在下</option>
          </select></div>
        ${RULES_HTML}
        <button class="btn" id="setClose">关闭</button>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('show'); });
    ov.querySelector('#setClose').addEventListener('click', () => ov.classList.remove('show'));
    const sSel = ov.querySelector('#setSound');
    sSel.addEventListener('change', () => J.Settings.set('sound', sSel.value === '1'));
    const oSel = ov.querySelector('#setOri');
    oSel.addEventListener('change', () => J.Settings.set('orientation', oSel.value));
    return ov;
  }

  let overlay = null;
  J.openSettings = function () {
    if (!overlay) { ensureStyles(); overlay = buildOverlay(); }
    overlay.querySelector('#setSound').value = J.Settings.sound ? '1' : '0';
    overlay.querySelector('#setOri').value = J.Settings.orientation;
    overlay.classList.add('show');
  };

  J.initSettings = function () {
    ensureStyles();
    if (document.getElementById('gearBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'gearBtn'; btn.className = 'gearbtn'; btn.textContent = '⚙'; btn.setAttribute('aria-label', '设置');
    btn.addEventListener('click', () => J.openSettings());
    document.body.appendChild(btn);
    const unlock = () => { if (J.Sound) J.Sound.unlock(); };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  };
})();
