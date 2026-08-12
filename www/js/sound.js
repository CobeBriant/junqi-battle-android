/*
 * sound.js — WebAudio 合成音效（无需任何音频素材文件）。
 * 依赖：settings.js（决定是否发声）。首次用户交互后解锁音频上下文。
 */
(function () {
  const w = window;
  const J = (w.Junqi = w.Junqi || {});
  let ctx = null, master = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = w.AudioContext || w.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) { ctx = null; }
    return ctx;
  }
  function enabled() { return J.Settings ? J.Settings.sound : true; }

  function tone(freq, dur, type, gain, when) {
    if (!enabled()) return;
    const c = ensure(); if (!c) return;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    const t0 = c.currentTime + (when || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, gain) {
    if (!enabled()) return;
    const c = ensure(); if (!c) return;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = gain || 0.2;
    src.connect(g); g.connect(master); src.start();
  }

  J.Sound = {
    unlock() { const c = ensure(); if (c && c.state === 'suspended') { try { c.resume(); } catch (e) {} } },
    click() { tone(420, 0.06, 'triangle', 0.2); },
    move() { tone(300, 0.08, 'sine', 0.25); tone(380, 0.08, 'sine', 0.2, 0.04); },
    flip() { tone(520, 0.1, 'triangle', 0.25); tone(660, 0.1, 'triangle', 0.2, 0.05); },
    capture() { noise(0.18, 0.25); tone(180, 0.18, 'sawtooth', 0.2); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.3, i * 0.12)); },
    lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.22, 'sine', 0.3, i * 0.14)); },
    illegal() { tone(160, 0.12, 'square', 0.18); },
  };
})();
