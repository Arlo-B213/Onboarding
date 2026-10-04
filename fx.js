/* Visual and sound effects for the PRIDE Training Log. Loaded as the global `PrideFx`.
   - Sounds are synthesized with the Web Audio API (no audio files). They only ever play after a
     user click (sign in, submit, tab, forgot password), which is what browsers require.
   - Everything visual is skipped when the device asks for reduced motion.
   - The mute choice is remembered in localStorage. */
const PrideFx = (() => {
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let ctx = null, master = null, muted = false, armed = false, armTimer = null, swapToken = 0;
  try { muted = localStorage.getItem('pride-muted') === '1'; } catch (e) { /* storage unavailable */ }

  // ── sound ────────────────────────────────────────────────────────────
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // A soft bell: a fundamental plus a few inharmonic partials, quick attack, long decay
  function bell(freq, when, vol, decay) {
    const c = audio();
    if (!c) return;
    const t = c.currentTime + when;
    [[1, 1], [2.01, 0.42], [2.76, 0.24], [4.07, 0.1]].forEach(([ratio, level]) => {
      const osc = c.createOscillator(), amp = c.createGain();
      const life = decay / Math.sqrt(ratio);
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(vol * level, t + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + life);
      osc.connect(amp);
      amp.connect(master);
      osc.start(t);
      osc.stop(t + life + 0.05);
    });
  }

  // Filtered noise sweeping up (forward) or down (back)
  function swoosh(forward) {
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    const len = Math.floor(c.sampleRate * 0.5);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), filter = c.createBiquadFilter(), amp = c.createGain();
    src.buffer = buf;
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(forward ? 500 : 2600, t);
    filter.frequency.exponentialRampToValueAtTime(forward ? 2600 : 500, t + 0.38);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.07, t + 0.12);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start(t);
    src.stop(t + 0.5);
  }

  const SOUNDS = {
    // rising C major arpeggio, last note rings
    login: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f, i * 0.11, 0.09, i === 3 ? 1.8 : 1.1)),
    // two warm notes, then a little sparkle
    submit: () => {
      bell(783.99, 0, 0.09, 1.2);
      bell(1174.66, 0.12, 0.09, 1.6);
      [2093, 2637, 3136].forEach((f, i) => bell(f, 0.26 + i * 0.07, 0.025, 0.5));
    },
    tick: () => bell(1568, 0, 0.03, 0.18),
    slideForward: () => swoosh(true),
    slideBack: () => swoosh(false),
  };

  function play(name) {
    if (muted) return;
    try { if (SOUNDS[name]) SOUNDS[name](); } catch (e) { /* sound is a nicety, never break the app */ }
  }

  function syncMute() {
    document.querySelectorAll('.fx-mute').forEach(b => {
      b.dataset.muted = String(muted);
      b.setAttribute('aria-pressed', String(muted));
      b.title = muted ? 'Sound off. Click to turn on' : 'Sound on. Click to mute';
    });
  }
  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('pride-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
    syncMute();
    play('tick');
  }

  // ── theme ────────────────────────────────────────────────────────────
  // Dark is the default. The choice is remembered, and an inline script in index.html applies it
  // before first paint so there is no flash.
  const currentTheme = () => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  function syncTheme() {
    const light = currentTheme() === 'light';
    document.querySelectorAll('.theme-toggle').forEach(b => {
      b.setAttribute('aria-pressed', String(light));
      b.title = light ? 'Light mode. Click for dark' : 'Dark mode. Click for light';
    });
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('pride-theme', theme); } catch (e) { /* ignore */ }
    syncTheme();
  }
  // The new theme expands in a circle from the clicked button (View Transitions API),
  // with a plain colour fade where that is not supported.
  function toggleTheme(ev) {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    play('tick');
    if (reduced()) { applyTheme(next); return; }
    const root = document.documentElement;
    const btn = ev && ev.currentTarget;
    const r = btn ? btn.getBoundingClientRect() : { left: window.innerWidth / 2, top: 0, width: 0, height: 0 };
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (document.startViewTransition) {
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      const vt = document.startViewTransition(() => applyTheme(next));
      vt.ready.then(() => root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' }
      )).catch(() => { /* transition skipped, the theme still changed */ });
    } else {
      root.classList.add('theme-fade');
      applyTheme(next);
      setTimeout(() => root.classList.remove('theme-fade'), 450);
    }
  }

  // ── login ────────────────────────────────────────────────────────────
  // armLogin() is called by a real sign-in click so that a restored session on page load
  // does not play the welcome animation or sound.
  function armLogin() {
    armed = true;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => { armed = false; }, 15000);
  }
  function disarmLogin() { armed = false; }
  function consumeLogin() { const was = armed; armed = false; return was; }

  // Chime, gold bloom, login card lifts away; `swap` then shows the app, which glides in.
  function loginTransition(swap) {
    play('login');
    if (reduced()) { swap(); return; }
    const card = document.querySelector('#screen-login .login-card');
    const curtain = document.getElementById('fx-curtain');
    if (card) card.classList.add('fx-exit');
    if (curtain) { curtain.classList.remove('play'); void curtain.offsetWidth; curtain.classList.add('play'); }
    setTimeout(() => {
      swap();
      if (card) card.classList.remove('fx-exit');
      const app = document.getElementById('screen-app');
      app.classList.add('app-enter');
      setTimeout(() => app.classList.remove('app-enter'), 1800);
    }, 430);
  }

  // ── submit ───────────────────────────────────────────────────────────
  function burst(el) {
    if (reduced() || !el) return;
    const layer = document.getElementById('fx-layer');
    if (!layer) return;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const ring = document.createElement('span');
    ring.className = 'fx-ripple';
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    layer.appendChild(ring);
    setTimeout(() => ring.remove(), 1100);
    for (let i = 0; i < 22; i++) {
      const s = document.createElement('span');
      const angle = Math.random() * Math.PI * 2, dist = 70 + Math.random() * 130;
      s.className = 'fx-spark';
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      s.style.setProperty('--dy', Math.sin(angle) * dist - 30 + 'px');
      s.style.setProperty('--sz', 3 + Math.random() * 5 + 'px');
      s.style.animationDelay = Math.random() * 0.12 + 's';
      layer.appendChild(s);
      setTimeout(() => s.remove(), 1400);
    }
  }
  function submitSuccess(button) {
    play('submit');
    burst(button);
  }

  // ── pages ────────────────────────────────────────────────────────────
  // Cross-fade between two panels; dir 1 = moving forward (new page slides in from the right).
  function swapPanels(from, to, dir) {
    if (from === to) return;
    const token = ++swapToken;
    if (reduced() || !from || from.hidden) {
      if (from) from.hidden = true;
      to.hidden = false;
      return;
    }
    from.classList.remove('fx-out-left', 'fx-out-right');
    from.classList.add(dir > 0 ? 'fx-out-left' : 'fx-out-right');
    setTimeout(() => {
      if (token !== swapToken) return; // a newer tab click took over
      from.hidden = true;
      from.classList.remove('fx-out-left', 'fx-out-right');
      to.hidden = false;
      const inCls = dir > 0 ? 'fx-in-right' : 'fx-in-left';
      to.classList.add(inCls);
      setTimeout(() => to.classList.remove(inCls), 560);
    }, 170);
  }

  // Slide the gold highlight behind the active tab
  function movePill(animate = true) {
    const row = document.getElementById('tab-row');
    if (!row) return;
    const pill = row.querySelector('.tab-pill');
    const active = row.querySelector('.tab-btn.active');
    if (!pill || !active || active.hidden || !active.offsetWidth) return;
    if (!animate) pill.style.transition = 'none';
    pill.style.width = active.offsetWidth + 'px';
    pill.style.transform = `translateX(${active.offsetLeft}px)`;
    pill.classList.add('ready');
    if (!animate) { void pill.offsetWidth; pill.style.transition = ''; }
  }

  // ── login <-> forgot password ────────────────────────────────────────
  // Slide two sibling views sideways inside their `.view-stage` while the card height eases.
  function slideViews(fromEl, toEl, dir) {
    const stage = fromEl.parentElement;
    if (stage.dataset.busy) return;
    play(dir > 0 ? 'slideForward' : 'slideBack');
    const focusTarget = () => { const i = toEl.querySelector('input'); if (i) i.focus(); };
    if (reduced()) {
      fromEl.style.display = 'none';
      toEl.style.display = '';
      focusTarget();
      return;
    }
    stage.dataset.busy = '1';
    const PAD = 8; // the stage has 4px of padding on each side so focus rings are not clipped
    stage.style.height = fromEl.offsetHeight + PAD + 'px';
    toEl.style.display = '';
    toEl.classList.add('fx-abs');
    const target = toEl.offsetHeight + PAD;
    fromEl.classList.add('fx-abs', dir > 0 ? 'slide-out-left' : 'slide-out-right');
    toEl.classList.add(dir > 0 ? 'slide-in-right' : 'slide-in-left');
    void stage.offsetHeight;
    stage.style.height = target + 'px';
    setTimeout(() => {
      fromEl.style.display = 'none';
      fromEl.classList.remove('fx-abs', 'slide-out-left', 'slide-out-right');
      toEl.classList.remove('fx-abs', 'slide-in-right', 'slide-in-left');
      stage.style.height = '';
      delete stage.dataset.busy;
      focusTarget();
    }, 480);
  }

  function init() {
    syncMute();
    syncTheme();
    window.addEventListener('resize', () => movePill(false));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => movePill(false));
  }

  return { play, toggleMute, syncMute, toggleTheme, syncTheme, armLogin, disarmLogin, consumeLogin, loginTransition,
           submitSuccess, burst, swapPanels, movePill, slideViews, init };
})();

if (typeof module !== 'undefined') module.exports = PrideFx;
