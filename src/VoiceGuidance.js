
(function (global) {
  'use strict';
  const synth = global.speechSynthesis;
  const KEY = 'vg-settings';
  const cfg = { content: 'main', apiBase: '/api', mount: null, onChange: null };
  const S = { language: 'ro-RO', rate: 1, gender: 'female', voiceURI: '', formGuidance: false, engine: 'auto' };
  let queue = [], idx = 0, session = 0, state = 'stopped', mark = null, audio = null, voices = [];
  const cache = new Map();
  let serverDownUntil = 0; // after a server failure, use the browser voice for a minute
  const ui = {};

  const say = t => { if (ui.msg) ui.msg.textContent = t; };
  const saveSettings = () => {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    if (cfg.onChange) cfg.onChange({ ...S });
  };

  // ---------- text -> sentences (Romanian-aware: does not split after "str.", "nr.", "etc.")
  const ABBR = /\b(str|nr|bd|dr|etc|ex|cca|tel|ap|bl|sc|et|jud|mun|prof)\.$/i;
  function sentences(text) {
    const parts = text.split(/(?<=[.!?\u2026])\s+(?=[A-Z\u0102\u00C2\u00CE\u0218\u0162\u021A\u201E"(0-9])/);
    const out = [];
    parts.forEach(p => {
      if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += ' ' + p;
      else out.push(p);
    });
    return out.map(s => s.trim()).filter(Boolean);
  }
  function buildQueue() {
    const root = document.querySelector(cfg.content) || document.body, q = [];
    root.querySelectorAll('h1,h2,h3,h4,p,li,legend,figcaption').forEach(node => {
      if (node.closest('[aria-hidden="true"],[data-no-read]')) return;
      sentences(node.innerText.replace(/\s+/g, ' ').trim()).forEach(text => q.push({ node, text }));
    });
    return q;
  }

  // ---------- engines
  const sameLang = v => v.lang.replace('_', '-').toLowerCase().startsWith(S.language.slice(0, 2).toLowerCase());
  function browserVoice() {
    const list = voices.filter(sameLang);
    const score = v => (/natural|neural|online/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
    return list.find(v => v.voiceURI === S.voiceURI) || list.sort((a, b) => score(b) - score(a))[0] || null;
  }
  function browserSpeak(text, done) {
    if (!synth) return done();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = S.language; u.rate = S.rate;
    const v = browserVoice(); if (v) u.voice = v;
    u.onend = done; u.onerror = done;
    synth.speak(u);
  }
  function audioUrl(text) {
    const k = S.language + '|' + S.gender + '|' + text;
    if (!cache.has(k)) {
      const p = fetch(cfg.apiBase + '/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: S.language, gender: S.gender })
      }).then(r => { if (!r.ok) throw new Error('tts ' + r.status); return r.blob(); })
        .then(b => URL.createObjectURL(b));
      p.catch(() => cache.delete(k));
      cache.set(k, p);
    }
    return cache.get(k);
  }
  function speakChunk(text, my) {
    return new Promise(async resolve => {
      let used = false;
      const fallback = () => { if (used) return; used = true; if (my !== session) return resolve(); browserSpeak(text, resolve); };
      if (S.engine === 'browser' || Date.now() < serverDownUntil) return fallback();
      try {
        const url = await audioUrl(text);
        if (my !== session) { used = true; return resolve(); }
        audio = new Audio(url); audio.playbackRate = S.rate;
        audio.onended = () => { used = true; resolve(); };
        audio.onerror = () => (S.engine === 'server' ? resolve() : fallback());
        await audio.play();
      } catch (e) {
        if (S.engine === 'server') { say('Server voice unavailable.'); return resolve(); }
        serverDownUntil = Date.now() + 60000;
        fallback();
      }
    });
  }
  function silence() { if (audio) { audio.pause(); audio = null; } if (synth) synth.cancel(); }

  // ---------- playback
  function highlight(node) {
    if (mark) mark.classList.remove('vg-current');
    node.classList.add('vg-current'); mark = node;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
  }
  const clearMark = () => { if (mark) mark.classList.remove('vg-current'); mark = null; };

  async function run(my) {
    while (my === session && state === 'playing' && idx < queue.length) {
      const item = queue[idx];
      highlight(item.node);
      if (S.engine !== 'browser' && Date.now() >= serverDownUntil && queue[idx + 1]) audioUrl(queue[idx + 1].text).catch(() => {}); // preload next
      await speakChunk(item.text, my);
      if (my !== session) return;
      idx++;
    }
    if (my === session && state === 'playing') { state = 'stopped'; idx = 0; clearMark(); say('Finished reading.'); render(); }
  }
  function startAt(i) {
    silence();
    const my = ++session;
    idx = Math.max(0, Math.min(i, queue.length - 1));
    state = 'playing'; render(); run(my);
  }
  function play() {
    if (state === 'playing') return pause();
    if (state === 'stopped') {
      queue = buildQueue();
      if (!queue.length) return say('Nothing to read on this page.');
      return startAt(0);
    }
    startAt(idx);
  }
  function pause() { state = 'paused'; session++; silence(); say('Paused.'); render(); }
  function stop() { state = 'stopped'; session++; silence(); idx = 0; clearMark(); say('Stopped.'); render(); }
  function skip(d) {
    if (state === 'stopped') { queue = buildQueue(); if (!queue.length) return; idx = 0; if (d < 0) d = 0; }
    startAt(idx + d);
  }
  async function speakOnce(text) {
    silence(); state = 'stopped'; const my = ++session; clearMark(); render(); say(text);
    await speakChunk(text, my);
  }

  // ---------- UI
  function render() {
    ui.play.textContent = state === 'playing' ? 'Pause' : state === 'paused' ? 'Resume' : 'Play';
    ui.guide.setAttribute('aria-pressed', String(S.formGuidance));
    ui.guide.textContent = 'Form guidance: ' + (S.formGuidance ? 'on' : 'off');
    ui.rateOut.textContent = S.rate.toFixed(1) + 'x';
  }
  function buildBar() {
    const css = document.createElement('style');
    css.textContent =
      '#vg-bar{position:sticky;top:0;z-index:50;display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;padding:.6rem 1rem;background:#eef3fa;color:#111;border-bottom:2px solid #9fb0c8;font:1rem system-ui,sans-serif}' +
      '#vg-bar button,#vg-bar select{font:inherit;min-height:44px;min-width:44px;padding:.3rem .8rem;border:2px solid #9fb0c8;border-radius:8px;background:#fff;color:#111}' +
      '#vg-bar button{cursor:pointer;font-weight:600}#vg-bar button[aria-pressed="true"],#vg-bar [data-a=play]{background:#0b57d0;color:#fff;border-color:#0b57d0}' +
      '#vg-bar label{display:inline-flex;gap:.4rem;align-items:center}#vg-msg{flex-basis:100%;margin:0;font-size:.95rem}' +
      '.vg-current{background:#fff3b0;color:#111;outline:3px solid #8a6d00;outline-offset:3px;border-radius:4px}' +
      '@media (prefers-color-scheme:dark){#vg-bar{background:#1e2430;color:#f2f2f2;border-color:#3b4658}#vg-bar button,#vg-bar select{background:#121417;color:#f2f2f2;border-color:#3b4658}.vg-current{background:#3d3400;color:#fff;outline-color:#ffd84d}}';
    document.head.appendChild(css);
    const bar = document.createElement('div');
    bar.id = 'vg-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Voice guidance controls');
    bar.innerHTML =
      '<button type="button" data-a="play" aria-keyshortcuts="Alt+P">Play</button>' +
      '<button type="button" data-a="back" aria-label="Previous sentence">Back</button>' +
      '<button type="button" data-a="next" aria-label="Next sentence">Next</button>' +
      '<button type="button" data-a="stop" aria-keyshortcuts="Alt+S">Stop</button>' +
      '<label>Speed <input type="range" data-a="rate" min="0.7" max="1.6" step="0.1"> <output data-a="rateOut"></output></label>' +
      '<label>Language <select data-a="lang"><option value="ro-RO">Rom\u00e2n\u0103</option><option value="en-US">English</option></select></label>' +
      '<label>Voice <select data-a="gender"><option value="female">Female</option><option value="male">Male</option></select></label>' +
      '<button type="button" data-a="guide" aria-pressed="false">Form guidance</button>' +
      '<p id="vg-msg" role="status"></p>';
    (cfg.mount ? document.querySelector(cfg.mount) : document.body).prepend(bar);
    bar.querySelectorAll('[data-a]').forEach(n => (ui[n.dataset.a] = n));
    ui.msg = bar.querySelector('#vg-msg');
    ui.rate.value = S.rate; ui.lang.value = S.language; ui.gender.value = S.gender;

    ui.play.onclick = play; ui.stop.onclick = stop;
    ui.back.onclick = () => skip(-1); ui.next.onclick = () => skip(1);
    ui.rate.oninput = () => { S.rate = parseFloat(ui.rate.value); if (audio) audio.playbackRate = S.rate; render(); };
    ui.rate.onchange = () => { saveSettings(); if (state === 'playing' && !audio) startAt(idx); };
    ui.lang.onchange = () => { S.language = ui.lang.value; S.voiceURI = ''; saveSettings(); if (state === 'playing') startAt(idx); };
    ui.gender.onchange = () => { S.gender = ui.gender.value; saveSettings(); if (state === 'playing') startAt(idx); };
    ui.guide.onclick = () => { S.formGuidance = !S.formGuidance; saveSettings(); render(); say('Form guidance ' + (S.formGuidance ? 'on.' : 'off.')); };
    document.addEventListener('keydown', e => {
      if (!e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); play(); }
      if (k === 's') { e.preventDefault(); stop(); }
    });
  }

  // ---------- form guidance: label, current value, hint/error when a field gets focus
  function describedBy(ids) {
    return ids.split(/\s+/).map(i => document.getElementById(i)).filter(Boolean)
      .map(n => n.textContent.trim()).filter(Boolean).join('. ');
  }
  function initFormGuidance() {
    document.addEventListener('focusin', e => {
      const f = e.target;
      if (!S.formGuidance || !f.matches('input:not([type=hidden]),select,textarea')) return;
      const label = (f.labels && f.labels[0] && f.labels[0].textContent.trim()) || f.getAttribute('aria-label') || f.name || '';
      const extra = f.getAttribute('aria-describedby') ? describedBy(f.getAttribute('aria-describedby')) : '';
      speakOnce([label, f.value ? 'Current value: ' + f.value : 'Empty', extra].filter(Boolean).join('. '));
    });
  }

  // ---------- public API
  function init(opts) {
    Object.assign(cfg, opts || {});
    try { Object.assign(S, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
    if (opts && opts.settings) Object.assign(S, opts.settings); // e.g. preferences loaded from the API
    if (synth) { voices = synth.getVoices(); synth.onvoiceschanged = () => { voices = synth.getVoices(); }; }
    buildBar(); initFormGuidance(); render();
    say('Ready. Press Play (Alt+P) to hear this page.');
    addEventListener('pagehide', silence);
  }
  global.VoiceGuide = {
    init, play, pause, stop, speakOnce,
    getSettings: () => ({ ...S }),
    setSettings: s => { Object.assign(S, s); if (ui.rate) { ui.rate.value = S.rate; ui.lang.value = S.language; ui.gender.value = S.gender; render(); } saveSettings(); }
  };
  global.VoiceGuidance = global.VoiceGuide; // alias
  if (typeof module !== 'undefined' && module.exports) module.exports = global.VoiceGuide;
})(window);