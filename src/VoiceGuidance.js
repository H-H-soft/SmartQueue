
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
        if (S.engine === 'server') { say('Vocea serverului nu este disponibilă.'); return resolve(); }
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
    if (my === session && state === 'playing') { state = 'stopped'; idx = 0; clearMark(); say('Citirea s-a încheiat.'); render(); }
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
      if (!queue.length) return say('Nu există text de citit pe această pagină.');
      return startAt(0);
    }
    startAt(idx);
  }
  function pause() { state = 'paused'; session++; silence(); say('Citirea este în pauză.'); render(); }
  function stop() { state = 'stopped'; session++; silence(); idx = 0; clearMark(); say('Citirea a fost oprită.'); render(); }
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
    ui.play.textContent = state === 'playing' ? 'Pauză' : state === 'paused' ? 'Continuă' : 'Pornește';
    ui.play.setAttribute('aria-label', state === 'playing' ? 'Pune pauză la citire' : state === 'paused' ? 'Continuă citirea' : 'Pornește citirea paginii');
    ui.guide.setAttribute('aria-pressed', String(S.formGuidance));
    ui.guideState.textContent = S.formGuidance ? 'Activată' : 'Oprită';
    ui.rateOut.textContent = S.rate.toFixed(1) + 'x';
  }
  function setPanelOpen(open, focus = false) {
    ui.panel.hidden = !open;
    ui.launcher.setAttribute('aria-expanded', String(open));
    if (open && focus) ui.play.focus();
    if (!open && focus) ui.launcher.focus();
  }
  function buildBar() {
    const css = document.createElement('style');
    css.textContent = `
      #vg-launcher{position:fixed;right:24px;bottom:24px;z-index:40;display:inline-flex;align-items:center;gap:9px;min-height:46px;padding:0 16px;border:1px solid #155b49;border-radius:13px;color:#fff;background:#176b58;box-shadow:0 8px 24px #153d302e;font:650 14px/1 system-ui,sans-serif;cursor:pointer;transition:transform .16s ease,background .16s ease}
      #vg-launcher:hover{background:#105642;transform:translateY(-1px)}#vg-launcher:focus-visible,#vg-bar button:focus-visible,#vg-bar select:focus-visible,#vg-bar input:focus-visible{outline:3px solid #c88725;outline-offset:3px}
      #vg-launcher .vg-launcher-icon{display:grid;width:25px;height:25px;place-items:center;border-radius:8px;background:#ffffff20;font-size:16px}
      #vg-bar{position:fixed;right:24px;bottom:82px;z-index:41;width:min(370px,calc(100vw - 28px));max-height:min(80vh,620px);overflow:auto;padding:16px;border:1px solid #e0e8e1;border-radius:17px;color:#263a30;background:#fff;box-shadow:0 18px 55px #183b2e2b;font:14px/1.45 system-ui,'Segoe UI',sans-serif}
      #vg-bar[hidden]{display:none}#vg-launcher[aria-expanded=true]{box-shadow:0 0 0 3px #176b5830,0 8px 24px #153d302e}
      .vg-panel-head{display:flex;align-items:center;gap:11px;margin-bottom:15px}.vg-panel-icon{display:grid;width:40px;height:40px;flex:none;place-items:center;border-radius:12px;color:#176b58;background:#eaf4ed;font-size:20px}.vg-panel-title{min-width:0;flex:1}.vg-panel-title strong,.vg-panel-title small{display:block}.vg-panel-title strong{color:#20382c;font-size:14px}.vg-panel-title small{margin-top:3px;color:#7a887e;font-size:11px}.vg-close{width:36px;min-width:36px!important;height:36px;min-height:36px!important;padding:0!important;border:0!important;border-radius:9px!important;color:#68776d!important;background:#f3f6f3!important;font-size:21px!important}
      #vg-bar .vg-playback{display:grid;grid-template-columns:1fr 1.5fr 1fr 1fr;gap:7px;margin-bottom:15px}#vg-bar button{min-width:0;min-height:42px;padding:0 10px;border:1px solid #dce5dd;border-radius:9px;color:#3c5948;background:#fff;font:650 12px/1 system-ui,sans-serif;cursor:pointer}#vg-bar button:hover{background:#f3f8f4;border-color:#c5d9c9}#vg-bar button[data-a=play]{border-color:#176b58;color:#fff;background:#176b58}#vg-bar button[data-a=play]:hover{background:#105642}
      .vg-status{display:flex;align-items:flex-start;gap:8px;min-height:35px;margin:0 0 13px;padding:9px 10px;border-radius:9px;color:#63736a;background:#f5f8f5;font-size:11px}.vg-status:before{width:7px;height:7px;flex:none;margin-top:4px;border-radius:50%;background:#76a784;content:''}#vg-msg{margin:0}
      .vg-rate-row{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;margin:0 0 13px;color:#59695f;font-size:11px;font-weight:650}.vg-rate-row input{width:100%;min-height:20px;margin:0;accent-color:#176b58}.vg-rate-row output{min-width:34px;color:#37674d;text-align:right;font-variant-numeric:tabular-nums}
      .vg-settings{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:12px}.vg-settings label{display:block;color:#718077;font-size:10px;font-weight:700}.vg-settings select{display:block;width:100%;min-height:38px;margin:5px 0 0;padding:0 9px;border:1px solid #dce5dd;border-radius:8px;color:#33483c;background:#fff;font:12px system-ui,sans-serif}
      #vg-bar .vg-guide{display:flex;width:100%;align-items:center;justify-content:space-between;min-height:42px;padding:0 11px;color:#53675b;background:#f5f8f5}#vg-bar .vg-guide[aria-pressed=true]{border-color:#cee2d1;color:#296346;background:#eff8f0}.vg-guide-state{color:#7a887e;font-size:10px}
      .vg-shortcut{margin:11px 0 0;color:#89948c;font-size:10px}.vg-shortcut kbd{padding:2px 5px;border:1px solid #dfe6df;border-radius:4px;color:#5b6d60;background:#f8faf8;font:inherit}
      .vg-current{border-radius:4px;background:#fff2bd;color:#172d22;outline:3px solid #a87c21;outline-offset:3px}
      @media(max-width:700px){#vg-launcher{right:14px;bottom:85px;min-height:43px;padding:0 13px}#vg-bar{right:14px;bottom:137px;width:min(370px,calc(100vw - 28px));padding:14px}}
      @media(prefers-reduced-motion:reduce){#vg-launcher{transition:none}}
      @media(forced-colors:active){#vg-launcher,#vg-bar button{border:1px solid ButtonText!important}#vg-bar{border:1px solid CanvasText;background:Canvas;color:CanvasText}}
    `;
    document.head.appendChild(css);
    const launcher = document.createElement('button');
    launcher.id = 'vg-launcher'; launcher.type = 'button'; launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-controls', 'vg-bar');
    launcher.innerHTML = '<span class="vg-launcher-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none"><path d="M4 10v4h3l4 3V7l-4 3H4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span><span>Ghidare vocală</span>';
    const bar = document.createElement('section');
    bar.id = 'vg-bar'; bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-labelledby', 'vg-title'); bar.hidden = true;
    bar.innerHTML =
      '<div class="vg-panel-head"><span class="vg-panel-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M4 10v4h3l4 3V7l-4 3H4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span><span class="vg-panel-title"><strong id="vg-title">Ghidare vocală</strong><small>Ascultă și navighează prin conținut</small></span><button type="button" class="vg-close" data-a="close" aria-label="Închide meniul">×</button></div>' +
      '<div class="vg-status"><p id="vg-msg" role="status" aria-live="polite">Gata pentru citire.</p></div>' +
      '<div class="vg-playback"><button type="button" data-a="back" aria-label="Propoziția anterioară">←</button>' +
      '<button type="button" data-a="play" aria-keyshortcuts="Alt+P">Pornește</button>' +
      '<button type="button" data-a="next" aria-label="Propoziția următoare">→</button>' +
      '<button type="button" data-a="stop" aria-label="Oprește citirea" aria-keyshortcuts="Alt+S">■</button></div>' +
      '<label class="vg-rate-row" for="vg-rate"><span>Viteză</span><input id="vg-rate" type="range" data-a="rate" min="0.7" max="1.6" step="0.1"><output data-a="rateOut" for="vg-rate"></output></label>' +
      '<div class="vg-settings"><label for="vg-language">Limbă<select id="vg-language" data-a="lang"><option value="ro-RO">Română</option><option value="en-US">English</option></select></label>' +
      '<label for="vg-gender">Voce<select id="vg-gender" data-a="gender"><option value="female">Femeie</option><option value="male">Bărbat</option></select></label></div>' +
      '<button type="button" class="vg-guide" data-a="guide" aria-pressed="false"><span>Ghidare formulare</span><span class="vg-guide-state" data-a="guideState">Oprită</span></button>' +
      '<p class="vg-shortcut">Scurtături: <kbd>Alt</kbd> + <kbd>P</kbd> pornește/oprește · <kbd>Alt</kbd> + <kbd>S</kbd> oprește</p>';
    const mount = cfg.mount ? document.querySelector(cfg.mount) : document.body;
    mount.append(launcher, bar);
    launcher.onclick = () => setPanelOpen(bar.hidden, bar.hidden);
    bar.querySelectorAll('[data-a]').forEach(n => (ui[n.dataset.a] = n));
    ui.launcher = launcher; ui.panel = bar; ui.msg = bar.querySelector('#vg-msg');
    ui.rate.value = S.rate; ui.lang.value = S.language; ui.gender.value = S.gender;

    ui.play.onclick = play; ui.stop.onclick = stop;
    ui.back.onclick = () => skip(-1); ui.next.onclick = () => skip(1);
    ui.close.onclick = () => setPanelOpen(false, true);
    ui.rate.oninput = () => { S.rate = parseFloat(ui.rate.value); if (audio) audio.playbackRate = S.rate; render(); };
    ui.rate.onchange = () => { saveSettings(); if (state === 'playing' && !audio) startAt(idx); };
    ui.lang.onchange = () => { S.language = ui.lang.value; S.voiceURI = ''; saveSettings(); if (state === 'playing') startAt(idx); };
    ui.gender.onchange = () => { S.gender = ui.gender.value; saveSettings(); if (state === 'playing') startAt(idx); };
    ui.guide.onclick = () => { S.formGuidance = !S.formGuidance; saveSettings(); render(); say('Ghidarea formularelor ' + (S.formGuidance ? 'activată.' : 'oprită.')); };
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !ui.panel.hidden) { e.preventDefault(); setPanelOpen(false, true); return; }
      if (!e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); setPanelOpen(true); play(); }
      if (k === 's') { e.preventDefault(); setPanelOpen(true); stop(); }
    });
    document.addEventListener('pointerdown', e => {
      if (!ui.panel.hidden && !ui.panel.contains(e.target) && !ui.launcher.contains(e.target)) setPanelOpen(false);
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
    say('Gata pentru citire. Apasă Pornește sau folosește Alt+P.');
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
