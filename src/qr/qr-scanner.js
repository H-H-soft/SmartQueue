
(function (global) {
  'use strict';
  const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  let dlg, ui = {}, stream = null, timer = 0, detector = null, jsqrPromise = null;
  let done = false, lastBad = 0, resolveFn = null, opts = {};

  // ---------- parsing
  function parseStartCode(raw, allowPlain) {
    const t = String(raw || '').trim();
    const m = t.match(/^accesshub:\/\/start\/([A-Za-z0-9_-]{1,64})$/i);
    if (m) return m[1];
    try { const id = new URL(t).searchParams.get('start'); if (id && ID.test(id)) return id; } catch (e) {}
    return allowPlain && ID.test(t) ? t : null;
  }
  function readStartFromUrl() { // when someone opened the app by scanning with the phone camera
    const id = new URLSearchParams(location.search).get('start');
    return id && ID.test(id) ? id : null;
  }

  // ---------- feedback
  function say(text, speak) {
    if (ui.status) ui.status.textContent = text;
    if (speak !== false && opts.voice !== false && global.VoiceGuide) global.VoiceGuide.speakOnce(text);
  }
  function beep() {
    try {
      const a = new (global.AudioContext || global.webkitAudioContext)(), o = a.createOscillator();
      o.frequency.value = 880; o.connect(a.destination); o.start();
      setTimeout(() => { o.stop(); a.close(); }, 150);
    } catch (e) {}
  }

  // ---------- decoding
  function loadJsQR() {
    if (global.jsQR) return Promise.resolve();
    if (!jsqrPromise) {
      jsqrPromise = new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = opts.jsqrUrl || JSQR_URL; s.onload = ok;
        s.onerror = () => { jsqrPromise = null; fail(new Error('jsQR failed to load')); };
        document.head.appendChild(s);
      });
    }
    return jsqrPromise;
  }
  async function initDetector() {
    if ('BarcodeDetector' in global) {
      try {
        const f = await global.BarcodeDetector.getSupportedFormats();
        if (f.includes('qr_code')) return new global.BarcodeDetector({ formats: ['qr_code'] });
      } catch (e) {}
    }
    await loadJsQR();
    return null;
  }
  async function decode(canvas, thorough) {
    if (detector) { const r = await detector.detect(canvas); return r[0] ? r[0].rawValue : null; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const c = global.jsQR(img.data, img.width, img.height, { inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert' });
    return c ? c.data : null;
  }

  // ---------- camera loop
  async function tick() {
    if (!stream || done) return;
    const v = ui.video;
    if (v.readyState >= 2 && v.videoWidth) {
      const k = Math.min(1, 640 / v.videoWidth), c = ui.canvas;
      c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
      c.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, c.width, c.height);
      try { const raw = await decode(c, false); if (raw) handle(raw, false); } catch (e) {}
    }
    if (!done && stream) timer = setTimeout(tick, 120);
  }
  function stopCamera() {
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; if (ui.video) ui.video.srcObject = null;
  }
  async function startCamera() {
    say('Starting camera.', false);
    try { detector = await initDetector(); }
    catch (e) { return say('The scanner could not load. Type the code below instead.'); }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return say('The camera is not available here (it needs HTTPS). Type the code below instead.');
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      return say(e.name === 'NotAllowedError'
        ? 'Camera permission was denied. Type the code below instead.'
        : 'No camera found. Type the code below instead.');
    }
    ui.video.srcObject = stream;
    await ui.video.play().catch(() => {});
    say('Camera ready. Point it at the QR code and hold steady.');
    tick();
  }

  // ---------- result handling
  function handle(raw, plain) {
    const id = parseStartCode(raw, plain);
    if (!id) {
      if (Date.now() - lastBad > 3000) { lastBad = Date.now(); say('That code is not a start point. Try another one.'); }
      return false;
    }
    done = true; beep();
    if (navigator.vibrate) navigator.vibrate(200);
    stopCamera();
    if (opts.voice !== false && global.VoiceGuide) global.VoiceGuide.speakOnce('Code recognized.');
    resolveFn({ id, raw });
    dlg.close();
    return true;
  }

  // ---------- dialog
  function build() {
    const css = document.createElement('style');
    css.textContent =
      '#qr-dlg{max-width:min(32rem,94vw);border:2px solid #9fb0c8;border-radius:12px;padding:1rem 1.25rem;font:1rem/1.5 system-ui,sans-serif;background:#fff;color:#111}' +
      '#qr-dlg::backdrop{background:rgba(0,0,0,.6)}#qr-dlg video{width:100%;max-height:45vh;background:#000;border-radius:8px;object-fit:cover}' +
      '#qr-dlg label{display:block;font-weight:600;margin:.9rem 0 .25rem}' +
      '#qr-dlg input[type=text]{font:inherit;min-height:44px;width:100%;padding:.4rem .6rem;border:2px solid #9fb0c8;border-radius:8px;background:#fff;color:#111}' +
      '#qr-dlg button{font:inherit;font-weight:600;min-height:44px;min-width:44px;margin:.5rem .5rem 0 0;padding:.3rem 1rem;border:2px solid #0b57d0;border-radius:8px;background:#0b57d0;color:#fff;cursor:pointer}' +
      '#qr-dlg #qr-cancel{background:#fff;color:#0b57d0}#qr-dlg :focus-visible{outline:3px solid #0b57d0;outline-offset:2px}' +
      '@media (prefers-color-scheme:dark){#qr-dlg{background:#1e2430;color:#f2f2f2;border-color:#3b4658}#qr-dlg input[type=text]{background:#121417;color:#f2f2f2;border-color:#3b4658}#qr-dlg button{background:#8ab4ff;border-color:#8ab4ff;color:#111}#qr-dlg #qr-cancel{background:#1e2430;color:#8ab4ff}}';
    document.head.appendChild(css);
    dlg = document.createElement('dialog');
    dlg.id = 'qr-dlg'; dlg.setAttribute('aria-labelledby', 'qr-title');
    dlg.innerHTML =
      '<h2 id="qr-title">Scan the QR code at your starting point</h2>' +
      '<p id="qr-status" role="status"></p>' +
      '<video id="qr-video" playsinline muted aria-label="Camera preview"></video><canvas id="qr-canvas" hidden></canvas>' +
      '<label for="qr-manual">Or type the code printed under the QR code</label>' +
      '<input id="qr-manual" type="text" autocomplete="off" maxlength="64" placeholder="ENTRANCE-A">' +
      '<button type="button" id="qr-use">Use this code</button>' +
      '<label for="qr-photo">Or take a photo of the QR code</label>' +
      '<input id="qr-photo" type="file" accept="image/*" capture="environment">' +
      '<div><button type="button" id="qr-cancel">Cancel</button></div>';
    document.body.appendChild(dlg);
    ['status', 'video', 'canvas', 'manual', 'use', 'photo', 'cancel'].forEach(n => (ui[n] = dlg.querySelector('#qr-' + n)));

    ui.cancel.onclick = () => dlg.close();
    ui.use.onclick = () => { if (!handle(ui.manual.value, true)) say('That code is not valid. Use letters, digits, dashes and underscores.'); };
    ui.manual.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ui.use.click(); } };
    ui.photo.onchange = async () => {
      const file = ui.photo.files[0]; if (!file) return;
      say('Reading the photo.');
      try {
        if (!detector) await loadJsQR();
        const bmp = await createImageBitmap(file), k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height)), c = ui.canvas;
        c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, c.width, c.height);
        const raw = await decode(c, true);
        if (!raw) say('No QR code found in the photo. Try again, closer to the code.');
        else handle(raw, false);
      } catch (e) { say('The photo could not be read. Type the code instead.'); }
    };
    dlg.addEventListener('close', () => {
      stopCamera();
      if (!done && resolveFn) resolveFn(null); // cancelled or Escape
      if (global.speechSynthesis && !done) global.speechSynthesis.cancel();
    });
  }

  function open(o) {
    opts = o || {};
    if (!dlg) build();
    done = false; lastBad = 0; ui.manual.value = ''; ui.photo.value = '';
    return new Promise(resolve => {
      resolveFn = resolve;
      dlg.showModal();
      startCamera();
    });
  }

  global.QrStart = { open, parseStartCode, readStartFromUrl, makePayload: id => 'accesshub://start/' + id };
})(window);