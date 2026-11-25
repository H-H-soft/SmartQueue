
(function (global) {
  'use strict';
  const synth = global.speechSynthesis;
  const KEY = 'vg-settings';
  // Route details are now included in AI requests, so obtain consent for this scope separately.
  const AI_CONSENT_KEY = 'smartqueue-ai-consent-v2';
  const cfg = { content: 'main', apiBase: '/api', mount: null, onChange: null };
  const S = { language: 'ro-RO', rate: 1, gender: 'female', voiceURI: '', formGuidance: false, engine: 'auto' };
  let queue = [], idx = 0, session = 0, state = 'stopped', mark = null, audio = null, voices = [];
  const cache = new Map();
  let serverDownUntil = 0; // after a server failure, use the browser voice for a minute
  const ui = {};
  let routeContext = null;

  const say = t => {
    if (ui.msg) ui.msg.textContent = t;
    if (ui.startStatus && awaitingVoiceChoice && !ui.startDialog.hidden) ui.startStatus.textContent = t;
  };
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
    if (!voiceMode) return;
    silence(); state = 'stopped'; const my = ++session; clearMark(); render(); say(text);
    await speakChunk(text, my);
  }

  // ---------- compact, task-focused visitor assistant
  let recognition = null;
  let voiceMode = false, awaitingVoiceChoice = false, awaitingAiConsent = false, pendingQuestion = '';
  let startupPromptRetries = 0, permissionRecoveryAttempted = false, noSpeechNotices = 0;
  const aiHistory = [];
  let mapLandmarks = Array.isArray(global.smartqueueMapLandmarks) ? global.smartqueueMapLandmarks : [];
  function canListen() {
    return (voiceMode && !ui.panel.hidden) || (awaitingVoiceChoice && !ui.startDialog.hidden) ||
      (awaitingAiConsent && voiceMode && !ui.panel.hidden);
  }
  function plain(text) {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function addMessage(role, text) {
    const item = document.createElement('div');
    item.className = 'vg-message vg-message--' + role;
    item.textContent = text;
    ui.messages.appendChild(item);
    ui.messages.scrollTop = ui.messages.scrollHeight;
  }
  function chooseVoiceMode(enabled) {
    awaitingVoiceChoice = false;
    voiceMode = enabled;
    ui.startDialog.hidden = true;
    if (enabled) {
      setPanelOpen(true);
      void speakOnce('Conversația vocală este activă. Spune-mi cu ce ai nevoie de ajutor.').then(() => listen());
    } else {
      recognition?.abort();
      recognition = null;
      awaitingAiConsent = false;
      pendingQuestion = '';
      silence();
      state = 'stopped'; idx = 0; session++; clearMark();
      setPanelOpen(false);
      ui.launcher.focus();
    }
  }
  function requestStartupMicrophone() {
    const mediaDevices = global.navigator?.mediaDevices;
    if (!mediaDevices?.getUserMedia) return Promise.resolve({ granted: false, unsupported: true });
    try {
      return mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop());
        return { granted: true };
      }).catch(error => ({ granted: false, unsupported: false, reason: error?.name || 'denied' }));
    } catch (error) {
      return Promise.resolve({ granted: false, unsupported: false, reason: error?.name || 'denied' });
    }
  }
  function recoverMicrophoneAccess() {
    const wasStarting = awaitingVoiceChoice;
    const wasConversing = voiceMode && !ui.panel.hidden;
    if (permissionRecoveryAttempted) {
      const denied = 'Browserul nu permite acum recunoașterea vocală. Activează microfonul și recunoașterea vorbirii pentru SmartQueue în setările site-ului, apoi reîncarcă pagina.';
      if (wasConversing) {
        voiceMode = false;
        ui.mic.setAttribute('aria-label', 'Activează conversația vocală');
        ui.mic.textContent = 'Vorbește';
      }
      say(denied);
      browserSpeak(denied, () => {});
      return;
    }
    permissionRecoveryAttempted = true;
    if (wasConversing) {
      ui.mic.setAttribute('aria-pressed', 'false');
      ui.mic.textContent = 'Vorbește';
    }
    const notice = 'Browserul nu a pornit microfonul. Îți cer acum accesul; permite microfonul pentru SmartQueue dacă apare întrebarea browserului.';
    say(notice);
    browserSpeak(notice, () => {});
    void requestStartupMicrophone().then(access => {
      if (wasStarting) {
        if (!awaitingVoiceChoice && !voiceMode) return;
        if (access.granted) {
          if (awaitingVoiceChoice) promptVoiceChoice('Microfonul este pregătit. Vrei să continui conversația vocală? Spune da sau nu.');
          else if (voiceMode && !ui.panel.hidden) listen();
          return;
        }
      } else if (wasConversing) {
        if (!voiceMode || ui.panel.hidden) return;
        if (access.granted) { listen(); return; }
        voiceMode = false;
        ui.mic.setAttribute('aria-label', 'Activează conversația vocală');
      }
      const denied = access.unsupported
        ? 'Acest browser nu oferă recunoaștere vocală. Încearcă SmartQueue în Chrome sau Edge actualizat.'
        : 'Microfonul nu este permis. Activează permisiunea pentru SmartQueue din setările browserului, apoi reîncarcă pagina.';
      say(denied);
      browserSpeak(denied, () => {});
    });
  }
  function promptVoiceChoice(message = 'Vrei să continui conversația vocală? Spune da sau nu.') {
    const prompt = message;
    awaitingVoiceChoice = true;
    if (!synth || !global.SpeechSynthesisUtterance) {
      say('Redarea vocală nu este disponibilă. Dialogul are opțiunile Da și Nu.');
      return;
    }
    const requestedAt = Date.now();
    const speakPrompt = () => {
      if (!awaitingVoiceChoice) return;
      voices = synth.getVoices();
      if (!voices.length && Date.now() - requestedAt < 900) { setTimeout(speakPrompt, 100); return; }
      synth.cancel();
      synth.resume?.();
      const utterance = new global.SpeechSynthesisUtterance(prompt);
      utterance.lang = S.language;
      utterance.rate = S.rate;
      const selectedVoice = browserVoice();
      if (selectedVoice) utterance.voice = selectedVoice;
      let started = false;
      const watchdog = setTimeout(() => {
        if (!started && awaitingVoiceChoice) {
          if (startupPromptRetries < 1) {
            startupPromptRetries += 1;
            setTimeout(() => promptVoiceChoice(prompt), 450);
          } else {
            say('Întrebarea este afișată și pentru cititorul de ecran. Te ascult; spune da sau nu.');
            listen();
          }
        }
      }, 1800);
      utterance.onstart = () => { started = true; startupPromptRetries = 0; clearTimeout(watchdog); say('Spune da pentru a activa conversația vocală sau nu pentru a continua fără voce.'); };
      utterance.onend = () => { clearTimeout(watchdog); startupPromptRetries = 0; if (awaitingVoiceChoice) listen(); };
      utterance.onerror = () => {
        clearTimeout(watchdog);
        if (!awaitingVoiceChoice) return;
        if (startupPromptRetries < 1) {
          startupPromptRetries += 1;
          setTimeout(() => promptVoiceChoice(prompt), 450);
        } else {
          say('Întrebarea este afișată și pentru cititorul de ecran. Te ascult; spune da sau nu.');
          listen();
        }
      };
      synth.speak(utterance);
    };
    setTimeout(speakPrompt, 120);
  }
  function goTo(label) {
    const button = Array.from(document.querySelectorAll('.app-nav__item')).find(item => plain(item.innerText).includes(plain(label)));
    if (button) { button.click(); return true; }
    return false;
  }
  function ticketAnswer() {
    const card = document.querySelector('.ticket-panel--active');
    if (!card) {
      goTo('Servicii și tichet');
      return 'Nu văd un tichet activ. Am deschis Servicii și tichet; alege o solicitare și confirm-o ca să primești un număr de urmărire.';
    }
    const number = card.querySelector('.ticket-number')?.innerText.trim();
    const status = card.querySelector('.ticket-status')?.innerText.trim();
    const parts = [number ? `Tichetul tău este ${number}.` : '', status ? `Starea: ${status}.` : ''];
    const metrics = Array.from(card.querySelectorAll('.ticket-position > div')).map(item => {
      const label = item.querySelector('span')?.innerText.trim();
      const value = item.querySelector('strong')?.innerText.trim();
      return label && value ? `${label}: ${value}.` : '';
    });
    const desk = card.querySelector('.destination')?.innerText.replace(/\s+/g, ' ').trim();
    return [...parts, ...metrics, desk ? `Ghișeu: ${desk}.` : '', card.querySelector('.ticket-live-note')?.innerText.trim() ?? ''].filter(Boolean).join(' ') || 'Nu pot citi starea tichetului momentan.';
  }
  const landmarkAliases = {
    'scan-11': ['intrare', 'intrarea principala'],
    'scan-16': ['usa cu simbol', 'simbol de accesibilitate'],
    'scan-22': ['iesire', 'exit'],
    'scan-23': ['gradene', 'gradena'],
    'scan-24': ['atrium', 'atriu'],
    'scan-26': ['lift', 'ascensor'],
    'scan-29': ['receptie', 'tejghea'],
    'scan-31': ['turnicheti', 'turnichet'],
    'scan-178': ['camera 105', '105'],
  };
  let pendingRouteDestination = null;
  function findNamedLandmark(question, excludedId, fromEnd = false) {
    const q = plain(question);
    let best = null, bestIndex = fromEnd ? -1 : Infinity, bestLength = 0;
    mapLandmarks.filter(item => item.id !== excludedId).forEach(item => {
      const names = [plain(item.label), ...(landmarkAliases[item.id] || [])];
      // Recognize natural room names such as “sala 110”, “S110” or “camera 105”.
      const room = item.label.match(/^(?:camera\s+)?(?:[SL]\s*)?(\d{3})\b/i);
      if (room) names.push(room[1], 'sala ' + room[1], 'camera ' + room[1]);
      names.forEach(name => {
        const index = name ? (fromEnd ? q.lastIndexOf(name) : q.indexOf(name)) : -1;
        if (index < 0 || (index > 0 && /[a-z0-9]/.test(q[index - 1])) || /[a-z0-9]/.test(q[index + name.length] || '')) return;
        if (fromEnd ? index > bestIndex || (index === bestIndex && name.length > bestLength) : index < bestIndex || (index === bestIndex && name.length > bestLength)) {
          best = item; bestIndex = index; bestLength = name.length;
        }
      });
    });
    return best;
  }
  function setRequestedRoute(origin, destination) {
    pendingRouteDestination = null;
    global.dispatchEvent(new CustomEvent('smartqueue-route-origin', { detail: { nodeId: origin.id } }));
    global.dispatchEvent(new CustomEvent('smartqueue-route-destination', { detail: { nodeId: destination.id } }));
    return 'Am setat plecarea la ' + origin.label + ' și destinația la ' + destination.label + '. Aplicația calculează traseul pe hartă. Dacă nu există o rută pentru profilul ales, vei vedea mesajul pe ecran.';
  }
  function routeOriginAnswer(question) {
    const q = plain(question);
    if (!/\b(sunt|ma aflu|am ajuns|ma gasesc)\b/.test(q) && !pendingRouteDestination) return null;
    const location = findNamedLandmark(q);
    if (!location) return null;
    const destination = findNamedLandmark(q, location.id, true) || pendingRouteDestination;
    if (destination && destination.id !== location.id) return setRequestedRoute(location, destination);
    global.dispatchEvent(new CustomEvent('smartqueue-route-origin', { detail: { nodeId: location.id } }));
    if (routeContext?.steps?.length) return 'Am schimbat plecarea la ' + location.label + '. Aplicația recalculează traseul spre ' + routeContext.destination + '.';
    return 'Am setat plecarea la ' + location.label + '. Spune-mi unde vrei să ajungi.';
  }
  function routeDestinationAnswer(question) {
    const q = plain(question);
    if (!/\b(vreau|as vrea|ajung|merg|du ma|condu ma|traseu|ruta|destinatie|directii|drum|unde este|unde e)\b/.test(q)) return null;
    const destination = findNamedLandmark(q, undefined, true);
    if (!destination) return 'Nu am identificat destinația pe hartă. Spune numele reperului sau numărul sălii, de exemplu „sala 110”.';
    const from = q.match(/\b(?:de la|din|from)\s+(.+)/);
    const origin = from ? findNamedLandmark(from[1], destination.id) : null;
    if (origin) return setRequestedRoute(origin, destination);
    global.dispatchEvent(new CustomEvent('smartqueue-route-destination', { detail: { nodeId: destination.id } }));
    if (routeContext?.steps?.length) return 'Am schimbat destinația la ' + destination.label + '. Aplicația recalculează ruta de la ' + routeContext.origin + '.';
    pendingRouteDestination = destination;
    return 'Am selectat destinația ' + destination.label + ' pe hartă. De unde pleci? Spune un reper, de exemplu „sunt la intrare”.';
  }
  function routeProgressAnswer(q) {
    if (/(repeta|repeti|din nou|indicatia curenta|pasul curent|directia actuala)/.test(q)) {
      if (!routeContext?.steps?.length) return 'Nu există un traseu activ. Deschide Orientare interioară și alege punctul de plecare și destinația.';
      return `Ultimul reper confirmat este „${routeContext.currentStepIndex === 0 ? routeContext.origin : routeContext.steps[routeContext.currentStepIndex - 1]?.landmark || routeContext.origin}”. Pasul următor: ${routeContext.steps[routeContext.currentStepIndex]?.text || routeContext.currentStep}. Poziția avansează când confirmi reperul; telefonul nu o detectează automat.`;
    }
    if (/^(urmatorul pas|urmatorul reper|am ajuns|continua traseul|mergi mai departe|ce urmeaza)/.test(q)) {
      if (!routeContext?.steps?.length) return 'Nu există un traseu activ. Deschide Orientare interioară și alege plecarea și destinația.';
      const nextIndex = Math.min(routeContext.currentStepIndex + 1, routeContext.steps.length - 1);
      if (nextIndex === routeContext.currentStepIndex) return `Acesta este ultimul pas: ${routeContext.steps[nextIndex].text}`;
      routeContext = { ...routeContext, currentStepIndex: nextIndex, currentStep: routeContext.steps[nextIndex].text };
      global.dispatchEvent(new CustomEvent('smartqueue-route-next'));
      return `Bine. Pasul ${nextIndex + 1}: ${routeContext.steps[nextIndex].text}`;
    }
    if (/(unde sunt|unde ma aflu|care este pozitia mea)/.test(q)) {
      if (!routeContext?.steps?.length) return 'Nu pot detecta poziția ta. Alege manual punctul în care te afli în Orientare interioară, apoi destinația.';
      return `Nu pot detecta unde ești în clădire. Ai ales plecarea „${routeContext.origin}”, iar aplicația este la pasul ${routeContext.currentStepIndex + 1}: ${routeContext.steps[routeContext.currentStepIndex]?.text || routeContext.currentStep}. Acest pas avansează numai când confirmi că ai ajuns la reper.`;
    }
    return null;
  }
  function answerQuestion(question) {
    const q = plain(question);
    const routeOrigin = routeOriginAnswer(question);
    if (routeOrigin) return routeOrigin;
    const routeDestination = routeDestinationAnswer(question);
    if (routeDestination) return routeDestination;
    const routeProgress = routeProgressAnswer(q);
    if (routeProgress) return routeProgress;
    if (/^(buna|buna ziua|salut|hei|hello|buna seara)/.test(q)) return 'Bună! Sunt asistentul SmartQueue. Te pot ajuta cu tichete, servicii, accesibilitate sau orientare. Ce ai nevoie?';
    if (/(ce poti face|cum ma ajuti|ce poti|optiuni)/.test(q) || /^(ajutor|help)$/.test(q)) return 'Te pot ajuta să alegi o destinație de pe planul parterului AIRI și să asculți pașii traseului. Poți cere să repet indicația sau să explic un reper. Nu detectez automat poziția ta, iar accesibilitatea traseului trebuie confirmată la fața locului.';
    if (/\b(cum (pot sa )?(iau|solicit)|as vrea|vreau|solicit|solicita|cer|am nevoie de)\b.{0,45}\b(tichet|ajutor|sprijin|orientare|ghidaj)\b/.test(q)) {
      try { sessionStorage.setItem('smartqueue-pending-service', 'Ajutor pentru orientare'); } catch {}
      window.dispatchEvent(new CustomEvent('smartqueue-service-request', { detail: { name: 'Ajutor pentru orientare' } }));
      goTo('Servicii și tichet');
      return 'Am deschis Servicii și tichet. Am pregătit solicitarea „Ajutor pentru orientare”; verifică selecția și apasă Confirmă. Vei urmări aici când operatorul SmartQueue preia tichetul. Punctul echipei nu este încă marcat pe planul AIRI.';
    }
    if (/(tichet|randul meu|coada|pozitia mea|cat mai dureaza|timp de asteptare|m au chemat|fost chemat)/.test(q)) return ticketAnswer();
    if (/(servici|ghiseu|taxe|informatii|solicitari|ajutor|sprijin)/.test(q) && /(ce|care|disponibil|lista|aleg|vreau|ia|solicit|pot trimite)/.test(q)) {
      const names = Array.from(document.querySelectorAll('.service-option__body strong')).map(item => item.innerText.trim()).filter(Boolean);
      if (names.length) return `Serviciile disponibile sunt: ${names.join(' și ')}. Alege unul din lista de pe ecran pentru a solicita tichet.`;
      if (goTo('Servicii și tichet')) return 'Te-am dus la Servicii și tichet. Alege serviciul de care ai nevoie; după confirmare, numărul și poziția ta apar pe ecran.';
      return 'Deschide secțiunea Servicii și tichet din meniul din stânga ca să vezi opțiunile disponibile.';
    }
    if (/(ruta|traseu|orientare|cum ajung|unde este|du ma la|ghidaj|planul parterului|folosesc planul)/.test(q)) {
      if (routeContext?.steps?.length && /(pierdut|nu ma descurc|nu stiu|pe unde|ce directie|incotro|ajutor acum)/.test(q)) return null;
      goTo('Orientare interioară');
      const step = document.querySelector('.route-current-step strong')?.textContent?.trim();
      if (step) return `Am deschis traseul curent. Pasul afișat este: ${step}. Distanțele sunt măsurate între scanările turului; poziția ta nu este detectată, iar accesibilitatea nu a fost verificată la fața locului.`;
      return 'Am deschis planul parterului AIRI. Alege reperul de plecare de lângă tine și destinația. Poți cere să citesc indicația curentă sau să o repet. Nu detectez automat unde ești, iar accesibilitatea traseului nu a fost confirmată la fața locului.';
    }
    if (/(accesibil|profil|scaun cu rotile|vedere|contrast|text marit)/.test(q)) {
      goTo('Accesibilitate');
      return 'Am deschis Accesibilitate. Aici poți alege profilul de deplasare, contrast ridicat și text mărit.';
    }
    if (/(acasa|pagina principala|inceput)/.test(q)) {
      goTo('Acasă');
      return 'Am revenit la pagina Acasă. De acolo poți deschide serviciile și tichetul sau setările de accesibilitate.';
    }
    return null;
  }
  async function ask(question, options = {}) {
    const text = String(question || '').trim();
    if (!text) return;
    const q = plain(text);
    if (awaitingVoiceChoice) {
      if (/^(da\b.*|vreau\b.*|activeaza vocea|foloseste vocea|sunt nevazator|am vedere slaba)$/.test(q)) chooseVoiceMode(true);
      else if (/^(nu\b.*|fara voce|continua fara voce|dezactiveaza)$/.test(q)) chooseVoiceMode(false);
      else promptVoiceChoice('Nu am înțeles. Spune da ca să continui conversația vocală sau nu ca să o închid.');
      return;
    }
    if (awaitingAiConsent) {
      if (!options.alreadyShown) addMessage('user', text);
      awaitingAiConsent = false;
      if (/^(da|accept|sunt de acord|activeaza ai|activeaza|continua|ok|bine)$/.test(q)) {
        ui.aiConsent.checked = true;
        try { localStorage.setItem(AI_CONSENT_KEY, 'true'); } catch {}
        const nextQuestion = pendingQuestion;
        pendingQuestion = '';
        addMessage('assistant', 'Am înțeles. Trimit acum întrebarea către asistentul AI.');
        await ask(nextQuestion, { alreadyShown: true });
        return;
      }
      pendingQuestion = '';
      const reply = /^(nu|nu sunt de acord|refuz|opreste|stop)$/.test(q)
        ? 'În regulă. Nu trimit mesajul nicăieri. Poți continua cu comenzile locale despre tichet și aplicație.'
        : 'Nu am activat AI-ul. Dacă vrei, spune „accept” după ce auzi din nou explicația sau folosește comanda vocală pentru a opri conversația.';
      addMessage('assistant', reply);
      if (voiceMode) await speakOnce(reply);
      if (voiceMode && !ui.panel.hidden) listen();
      return;
    }
    silence();
    if (!options.alreadyShown) addMessage('user', text);
    ui.input.value = '';
    let reply;
    if (voiceMode && /^(opreste vocea|opreste conversatia vocala|dezactiveaza vocea)$/.test(q)) {
      voiceMode = false;
      recognition?.abort();
      reply = 'Am oprit conversația vocală. Poți folosi aplicația și asistentul prin butoane sau text.';
      } else reply = answerQuestion(text);
    if (!reply) {
      if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d\s().-]{7,}\d)/i.test(text)) {
        reply = 'Întrebarea pare să conțină un e-mail sau un număr de telefon. Ca să-ți protejez datele, nu o trimit către AI. Reformulează fără date personale.';
      } else if (!ui.aiConsent.checked) {
        if (voiceMode) {
          awaitingAiConsent = true;
          pendingQuestion = text;
          reply = `Ca să te pot ghida, întrebarea${routeContext ? ', plecarea, destinația și pașii traseului curent' : ''} vor fi trimise la Google Gemini. Nu trimit contul, tichetul sau profilul tău. Pe planul gratuit, Google poate folosi mesajele pentru îmbunătățirea serviciilor. Nu dicta date personale. Dacă ești de acord, spune „accept”; pentru a refuza, spune „nu”.`;
        } else reply = `Pentru o întrebare liberă pot folosi AI-ul dacă activezi opțiunea de mai jos. Întrebarea${routeContext ? ', plecarea, destinația și pașii traseului curent' : ''} ajung la Google Gemini; contul, tichetul și profilul tău nu sunt trimise. Pe planul gratuit, Google poate folosi mesajele pentru îmbunătățirea serviciilor. Comenzile pentru repetarea sau avansarea pasului rămân locale.`;
      } else {
        ui.send.disabled = true; ui.input.disabled = true; ui.mic.disabled = true;
        say('Întreb AI-ul SmartQueue…');
        try {
          const response = await fetch(cfg.apiBase + '/assistant', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: text, history: aiHistory.slice(-6), consent: true, ...(routeContext?.steps?.length ? { route: routeContext } : {}) }), signal: AbortSignal.timeout(18000),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error?.message || 'Asistentul AI nu este disponibil acum.');
          reply = data.answer;
          aiHistory.push({ role: 'user', text }, { role: 'model', text: reply });
          if (aiHistory.length > 12) aiHistory.splice(0, aiHistory.length - 12);
        } catch (error) {
          reply = error.name === 'TimeoutError' || error.name === 'AbortError'
            ? 'AI-ul răspunde greu. Încearcă din nou sau întreabă personalul instituției.'
            : error.message || 'Nu am reușit să contactez asistentul AI. Verifică dacă backend-ul și cheia AI sunt configurate.';
        } finally {
          ui.send.disabled = false; ui.input.disabled = false; ui.mic.disabled = false;
        }
      }
    }
    addMessage('assistant', reply);
    if (voiceMode && !ui.panel.hidden) void speakOnce(reply).then(() => { if (voiceMode && !ui.panel.hidden) listen(); });
  }
  function listen() {
    const Recognition = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!Recognition) {
      const message = 'Recunoașterea vorbirii nu este disponibilă în acest browser. Încearcă SmartQueue în Chrome sau Edge actualizat.';
      say(message);
      if (awaitingVoiceChoice || voiceMode) browserSpeak(message, () => {});
      return;
    }
    if (recognition) { recognition.abort(); recognition = null; }
    recognition = new Recognition();
    recognition.lang = S.language;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { permissionRecoveryAttempted = false; ui.mic.setAttribute('aria-pressed', 'true'); ui.mic.textContent = 'Ascult'; say(awaitingVoiceChoice ? 'Te ascult. Spune da sau nu.' : 'Te ascult. Spune-mi cu ce te pot ajuta.'); };
    let heardSpeech = false;
    let retryAllowed = true;
    recognition.onresult = event => { const text = event.results?.[0]?.[0]?.transcript || ''; if (text) { heardSpeech = true; noSpeechNotices = 0; ask(text); } };
    recognition.onerror = event => {
      if (!voiceMode && !awaitingVoiceChoice && !awaitingAiConsent) return;
      if (event.error === 'not-allowed' || event.error === 'audio-capture') {
        retryAllowed = false;
        recoverMicrophoneAccess();
      } else if (event.error === 'service-not-allowed') {
        retryAllowed = false;
        if (voiceMode) {
          voiceMode = false;
          ui.mic.setAttribute('aria-label', 'Activează conversația vocală');
          ui.mic.textContent = 'Vorbește';
        }
        const message = 'Serviciul de recunoaștere vocală al browserului nu este disponibil. Verifică setările de recunoaștere vocală sau folosește Chrome ori Edge actualizat.';
        say(message);
        browserSpeak(message, () => {});
      } else say(event.error === 'no-speech'
        ? (awaitingVoiceChoice ? 'Nu am auzit răspunsul. Repet întrebarea; apoi spune da sau nu.' : 'Nu am prins ce ai spus. Încearcă din nou sau scrie întrebarea.')
        : 'Nu am prins ce ai spus. Încearcă din nou sau scrie întrebarea.');
      if (event.error === 'no-speech' && awaitingVoiceChoice) {
        retryAllowed = false;
        promptVoiceChoice('Nu am auzit răspunsul. Vrei să continui conversația vocală? Spune da sau nu.');
      } else if (event.error === 'no-speech' && voiceMode && noSpeechNotices === 0) {
        noSpeechNotices += 1;
        retryAllowed = false;
        browserSpeak('Nu am auzit răspunsul. Te ascult din nou; spune-mi ce ai nevoie.', () => {
          if (canListen()) listen();
        });
      }
    };
    recognition.onend = () => {
      ui.mic.setAttribute('aria-pressed', 'false'); ui.mic.textContent = 'Vorbește';
      if (!heardSpeech && retryAllowed && canListen()) {
        setTimeout(() => { if (canListen()) listen(); }, 350);
      }
    };
    try {
      recognition.start();
    } catch (error) {
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') recoverMicrophoneAccess();
      else {
        say(error?.name === 'InvalidStateError' ? 'Microfonul este deja activ.' : 'Nu am putut porni microfonul. Încearcă din nou.');
        if (voiceMode || awaitingVoiceChoice) browserSpeak(ui.msg.textContent, () => {});
      }
    }
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
    if (!open && recognition) { recognition.abort(); recognition = null; }
    if (!open) { awaitingAiConsent = false; pendingQuestion = ''; }
    if (open && focus) ui.input.focus();
    if (!open && focus) ui.launcher.focus();
  }
  function buildBar() {
    const css = document.createElement('style');
    css.textContent = `
      #vg-launcher{position:fixed;right:24px;bottom:24px;z-index:40;display:inline-flex;align-items:center;gap:9px;min-height:46px;padding:0 16px;border:1px solid #155b49;border-radius:13px;color:#fff;background:#176b58;box-shadow:0 8px 24px #153d302e;font:650 14px/1 system-ui,sans-serif;cursor:pointer;transition:transform .16s ease,background .16s ease}
      #vg-launcher:hover{background:#105642;transform:translateY(-1px)}#vg-launcher:focus-visible,#vg-bar button:focus-visible,#vg-bar select:focus-visible,#vg-bar input:focus-visible{outline:3px solid #c88725;outline-offset:3px}
      #vg-launcher .vg-launcher-icon{display:grid;width:25px;height:25px;place-items:center;border-radius:8px;background:#ffffff20;font-size:16px}
      #vg-bar{position:fixed;right:24px;bottom:82px;z-index:41;display:flex;width:min(390px,calc(100vw - 28px));max-height:min(82vh,680px);flex-direction:column;overflow:hidden;padding:16px;border:1px solid #e0e8e1;border-radius:17px;color:#263a30;background:#fff;box-shadow:0 18px 55px #183b2e2b;font:14px/1.45 system-ui,'Segoe UI',sans-serif}
      #vg-bar[hidden]{display:none}#vg-launcher[aria-expanded=true]{box-shadow:0 0 0 3px #176b5830,0 8px 24px #153d302e}
      .vg-panel-head{display:flex;align-items:center;gap:11px;margin-bottom:15px}.vg-panel-icon{display:grid;width:40px;height:40px;flex:none;place-items:center;border-radius:12px;color:#176b58;background:#eaf4ed;font-size:20px}.vg-panel-title{min-width:0;flex:1}.vg-panel-title strong,.vg-panel-title small{display:block}.vg-panel-title strong{color:#20382c;font-size:14px}.vg-panel-title small{margin-top:3px;color:#7a887e;font-size:11px}.vg-close{width:36px;min-width:36px!important;height:36px;min-height:36px!important;padding:0!important;border:0!important;border-radius:9px!important;color:#68776d!important;background:#f3f6f3!important;font-size:21px!important}
      #vg-bar .vg-playback{display:grid;grid-template-columns:1fr 1.5fr 1fr 1fr;gap:7px;margin-bottom:15px}#vg-bar button{min-width:0;min-height:42px;padding:0 10px;border:1px solid #dce5dd;border-radius:9px;color:#3c5948;background:#fff;font:650 12px/1 system-ui,sans-serif;cursor:pointer}#vg-bar button:hover{background:#f3f8f4;border-color:#c5d9c9}#vg-bar button[data-a=play]{border-color:#176b58;color:#fff;background:#176b58}#vg-bar button[data-a=play]:hover{background:#105642}
      .vg-status{display:flex;align-items:flex-start;gap:8px;min-height:35px;margin:0 0 13px;padding:9px 10px;border-radius:9px;color:#63736a;background:#f5f8f5;font-size:11px}.vg-status:before{width:7px;height:7px;flex:none;margin-top:4px;border-radius:50%;background:#76a784;content:''}#vg-msg{margin:0}
      .vg-rate-row{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;margin:0 0 13px;color:#59695f;font-size:11px;font-weight:650}.vg-rate-row input{width:100%;min-height:20px;margin:0;accent-color:#176b58}.vg-rate-row output{min-width:34px;color:#37674d;text-align:right;font-variant-numeric:tabular-nums}
      .vg-settings{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:12px}.vg-settings label{display:block;color:#718077;font-size:10px;font-weight:700}.vg-settings select{display:block;width:100%;min-height:38px;margin:5px 0 0;padding:0 9px;border:1px solid #dce5dd;border-radius:8px;color:#33483c;background:#fff;font:12px system-ui,sans-serif}
      #vg-bar .vg-guide{display:flex;width:100%;align-items:center;justify-content:space-between;min-height:42px;padding:0 11px;color:#53675b;background:#f5f8f5}#vg-bar .vg-guide[aria-pressed=true]{border-color:#cee2d1;color:#296346;background:#eff8f0}.vg-guide-state{color:#7a887e;font-size:10px}
      .vg-shortcut{margin:11px 0 0;color:#89948c;font-size:10px}.vg-shortcut kbd{padding:2px 5px;border:1px solid #dfe6df;border-radius:4px;color:#5b6d60;background:#f8faf8;font:inherit}
      .vg-current{border-radius:4px;background:#fff2bd;color:#172d22;outline:3px solid #a87c21;outline-offset:3px}
      #vg-bar .vg-panel-head{flex:none;margin-bottom:12px}#vg-bar .vg-panel-title small{font-size:11px}
      #vg-bar .vg-chat-log{display:flex;min-height:130px;max-height:270px;flex:1;flex-direction:column;gap:8px;overflow:auto;padding:4px 3px 10px;scroll-behavior:smooth}
      #vg-bar .vg-message{max-width:88%;padding:10px 12px;border-radius:13px;color:#35483b;background:#f2f5f1;font-size:12px;line-height:1.55;white-space:pre-wrap}
      #vg-bar .vg-message--user{align-self:flex-end;border-bottom-right-radius:4px;color:#fff;background:#356b50}
      #vg-bar .vg-message--assistant{align-self:flex-start;border-bottom-left-radius:4px}
      #vg-bar .vg-suggestions{display:flex;flex:none;flex-wrap:wrap;gap:6px;margin:0 0 10px}
      #vg-bar .vg-suggestions button{min-height:32px;padding:0 9px;border-radius:99px;font-size:10px;font-weight:600}
      #vg-bar .vg-ai-consent{display:flex;align-items:flex-start;gap:8px;flex:none;margin:0 0 9px;padding:9px 10px;border:1px solid #e3e9e2;border-radius:9px;color:#68786e;background:#f8faf7;font-size:10px;line-height:1.45}
      #vg-bar .vg-ai-consent input{width:16px;height:16px;flex:none;margin:1px 0 0;accent-color:#176b58}
      #vg-bar .vg-ai-consent strong{color:#405748}
      #vg-start{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:20px;background:#14251dcc;font:16px/1.5 system-ui,'Segoe UI',sans-serif}
      #vg-start[hidden]{display:none}#vg-start-card{width:min(520px,100%);padding:30px;border:1px solid #dce7dd;border-radius:20px;color:#263a30;background:#fff;box-shadow:0 24px 80px #07170e66}
      #vg-start-card h1{margin:0 0 10px;color:#20382c;font-size:clamp(23px,5vw,30px);line-height:1.15}#vg-start-card p{margin:0 0 22px;color:#627268}
      #vg-start-status:empty{display:none}#vg-start-card #vg-start-status:not(:empty){margin:-8px 0 16px;color:#8a4f23;font-size:13px}
      #vg-start-actions{display:grid;gap:10px}#vg-start-actions button{min-height:58px;padding:12px 16px;border:1px solid #176b58;border-radius:12px;color:#fff;background:#176b58;font:700 16px/1.25 system-ui,sans-serif;cursor:pointer}
      #vg-start-actions button+button{border-color:#d8e2d9;color:#354a3c;background:#f7f9f6}#vg-start-actions button:focus-visible{outline:4px solid #d29c35;outline-offset:3px}
      #vg-bar .vg-composer{display:grid;grid-template-columns:1fr 42px 42px;gap:6px;flex:none;padding-top:10px;border-top:1px solid #edf0eb}
      #vg-bar .vg-composer input{min-width:0;min-height:42px;padding:0 11px;border:1px solid #dce5dd;border-radius:10px;color:#293a30;background:#fff;font:12px system-ui,sans-serif}
      #vg-bar .vg-composer input:focus{border-color:#7eaa89;outline:3px solid #dcecdf}
      #vg-bar .vg-composer button{min-height:42px;padding:0;border-radius:10px}
      #vg-bar .vg-composer [data-a=mic][aria-pressed=true]{border-color:#bc776d;color:#8d3e35;background:#fff2ef}
      #vg-bar .vg-status{flex:none;margin-top:9px;margin-bottom:0;padding:7px 9px;font-size:10px}
      #vg-bar .vg-advanced{flex:none;margin-top:8px;border-top:1px solid #edf0eb;color:#68786e;font-size:11px}
      #vg-bar .vg-advanced summary{padding:9px 1px;cursor:pointer;font-weight:650}
      #vg-bar .vg-advanced-content{padding:0 0 4px}
      #vg-bar .vg-playback{grid-template-columns:1fr 1.5fr 1fr 1fr;margin:4px 0 11px}
      #vg-bar .vg-shortcut{margin:8px 0 2px}
      @media(max-width:700px){#vg-launcher{right:14px;bottom:85px;min-height:43px;padding:0 13px}#vg-bar{right:14px;bottom:137px;width:min(390px,calc(100vw - 28px));max-height:70vh;padding:14px}#vg-bar .vg-chat-log{min-height:110px;max-height:34vh}}
      @media(prefers-reduced-motion:reduce){#vg-launcher{transition:none}}
      @media(forced-colors:active){#vg-launcher,#vg-bar button{border:1px solid ButtonText!important}#vg-bar{border:1px solid CanvasText;background:Canvas;color:CanvasText}}
    `;
    document.head.appendChild(css);
    const launcher = document.createElement('button');
    launcher.id = 'vg-launcher'; launcher.type = 'button'; launcher.setAttribute('aria-haspopup', 'dialog'); launcher.setAttribute('aria-label', 'Deschide asistentul SmartQueue');
    launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-controls', 'vg-bar');
    launcher.innerHTML = '<span class="vg-launcher-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" fill="none"><path d="M4 10v4h3l4 3V7l-4 3H4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span><span>Asistent SmartQueue</span>';
    const bar = document.createElement('section');
    bar.id = 'vg-bar'; bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-labelledby', 'vg-title'); bar.hidden = true;
    bar.innerHTML =
      '<div class="vg-panel-head"><span class="vg-panel-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="M4 10v4h3l4 3V7l-4 3H4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M15 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span><span class="vg-panel-title"><strong id="vg-title">Asistent SmartQueue</strong><small>Întreabă-mă despre SmartQueue sau alte subiecte</small></span><button type="button" class="vg-close" data-a="close" aria-label="Închide asistentul">×</button></div>' +
      '<div class="vg-chat-log" data-a="messages" role="log" aria-label="Conversație cu asistentul" aria-live="polite"><div class="vg-message vg-message--assistant">Te pot ajuta cu tichete și orientare pe Parter și Etaj 1. Cu opțiunea AI activată și configurată, poți pune și întrebări generale.</div></div>' +
      '<div class="vg-suggestions" aria-label="Întrebări rapide"><button type="button" data-q="Vreau un tichet pentru ajutor la orientare">Solicită ajutor la orientare</button><button type="button" data-q="Ce solicitări pot trimite?">Servicii disponibile</button><button type="button" data-q="Cum folosesc planul parterului?">Cum folosesc planul?</button></div>' +
      '<label class="vg-ai-consent"><input type="checkbox" data-a="aiConsent"><span><strong>Permite răspunsuri AI și ajutor pentru traseu.</strong> Întrebarea și, dacă ai început un traseu, plecarea, sosirea și pașii lui ajung la Google Gemini. Nu trimitem contul, tichetul sau profilul tău. Pe planul gratuit, Google poate folosi solicitările pentru îmbunătățirea serviciilor.</span></label>' +
      '<form class="vg-composer" data-a="form"><input type="text" data-a="input" aria-label="Întreabă asistentul SmartQueue" placeholder="Scrie o întrebare…" autocomplete="off"><button type="button" data-a="mic" aria-label="Pune o întrebare vocală" aria-pressed="false">🎙</button><button type="submit" data-a="send" aria-label="Trimite întrebarea">➤</button></form>' +
      '<div class="vg-status"><p id="vg-msg" role="status" aria-live="polite">Asistentul este pregătit.</p></div>' +
      '<details class="vg-advanced"><summary>Setări voce și citire opțională</summary><div class="vg-advanced-content">' +
      '<div class="vg-playback"><button type="button" data-a="back" aria-label="Propoziția anterioară">←</button><button type="button" data-a="play" aria-keyshortcuts="Alt+P">Citește pagina</button><button type="button" data-a="next" aria-label="Propoziția următoare">→</button><button type="button" data-a="stop" aria-label="Oprește citirea" aria-keyshortcuts="Alt+S">■</button></div>' +
      '<label class="vg-rate-row" for="vg-rate"><span>Viteză voce</span><input id="vg-rate" type="range" data-a="rate" min="0.7" max="1.6" step="0.1"><output data-a="rateOut" for="vg-rate"></output></label>' +
      '<div class="vg-settings"><label for="vg-language">Limbă<select id="vg-language" data-a="lang"><option value="ro-RO">Română</option><option value="en-US">English</option></select></label><label for="vg-gender">Voce<select id="vg-gender" data-a="gender"><option value="female">Femeie</option><option value="male">Bărbat</option></select></label></div>' +
      '<button type="button" class="vg-guide" data-a="guide" aria-pressed="false"><span>Ghidarea formularelor</span><span class="vg-guide-state" data-a="guideState">Oprită</span></button><p class="vg-shortcut">Citirea paginii este opțională. Scurtături: <kbd>Alt</kbd> + <kbd>P</kbd> · <kbd>Alt</kbd> + <kbd>S</kbd> oprește.</p></div></details>';
    const startDialog = document.createElement('div');
    startDialog.id = 'vg-start'; startDialog.hidden = true;
    startDialog.innerHTML = '<section id="vg-start-card" role="dialog" aria-modal="true" aria-labelledby="vg-start-title" aria-describedby="vg-start-description" tabindex="-1"><h1 id="vg-start-title">Vrei să continui cu voce?</h1><p id="vg-start-description">Îți pun întrebarea cu voce tare. Spune „da” sau apasă Da ca să continui conversația vocală. Spune „nu” sau apasă Nu ca să închid asistentul vocal. La prima folosire, browserul poate cere acces la microfon pentru a-ți auzi răspunsul.</p><p id="vg-start-status" role="status" aria-live="assertive"></p><div id="vg-start-actions"><button type="button" data-start="voice">Da, continuă cu voce</button><button type="button" data-start="silent">Nu, închide</button></div></section>';
    const mount = cfg.mount ? document.querySelector(cfg.mount) : document.body;
    mount.append(launcher, bar, startDialog);
    ui.startDialog = startDialog;
    ui.startStatus = startDialog.querySelector('#vg-start-status');
    startDialog.querySelector('[data-start="voice"]').onclick = () => chooseVoiceMode(true);
    startDialog.querySelector('[data-start="silent"]').onclick = () => chooseVoiceMode(false);
    launcher.onclick = () => {
      const opening = bar.hidden;
      setPanelOpen(opening, opening);
      if (opening && voiceMode) listen();
    };
    bar.querySelectorAll('[data-a]').forEach(n => (ui[n.dataset.a] = n));
    ui.launcher = launcher; ui.panel = bar; ui.msg = bar.querySelector('#vg-msg');
    try { ui.aiConsent.checked = localStorage.getItem(AI_CONSENT_KEY) === 'true'; } catch {}
    ui.aiConsent.onchange = () => { try { localStorage.setItem(AI_CONSENT_KEY, String(ui.aiConsent.checked)); } catch {} };
    ui.rate.value = S.rate; ui.lang.value = S.language; ui.gender.value = S.gender;

    ui.play.onclick = play; ui.stop.onclick = stop;
    ui.back.onclick = () => skip(-1); ui.next.onclick = () => skip(1);
    ui.close.onclick = () => setPanelOpen(false, true);
    ui.mic.onclick = () => {
      if (voiceMode && recognition) {
        voiceMode = false; recognition.abort(); recognition = null; silence();
        ui.mic.setAttribute('aria-pressed', 'false');
        ui.mic.setAttribute('aria-label', 'Activează conversația vocală');
      } else {
        voiceMode = true;
        ui.mic.setAttribute('aria-label', 'Oprește conversația vocală');
        listen();
      }
    };
    ui.form.onsubmit = event => { event.preventDefault(); ask(ui.input.value); };
    bar.querySelectorAll('[data-q]').forEach(button => button.addEventListener('click', () => ask(button.dataset.q)));
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
      if (!voiceMode || !S.formGuidance || !f.matches('input:not([type=hidden]),select,textarea')) return;
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
    global.addEventListener('smartqueue-map-landmarks', event => {
      if (Array.isArray(event.detail)) mapLandmarks = event.detail.filter(item => item && typeof item.id === 'string' && typeof item.label === 'string');
    });
    global.addEventListener('smartqueue-route-context', event => {
      const next = event.detail;
      routeContext = next && Array.isArray(next.steps) && next.steps.length ? next : null;
    });
    voiceMode = false;
    awaitingVoiceChoice = true;
    ui.startDialog.hidden = false;
    ui.startDialog.querySelector('#vg-start-card').focus();
    ui.startStatus.textContent = 'Vrei să continui conversația vocală? Spune da sau nu; dacă browserul cere acces la microfon, permite-l ca să-ți pot auzi răspunsul.';
    startupPromptRetries = 0; permissionRecoveryAttempted = false; noSpeechNotices = 0;
    promptVoiceChoice();
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
