import { useMemo, useState } from 'react';
import buildingData from './data/building.json';
import type { AccessibilityProfile, Building, RouteStep } from './types';
import { findRoute } from './routing/findRoute';
import QueuePanel from './QueuePanel';
import './App.css';
import IndoorMap from './components/IndoorMap';

// JSON-ul are tipuri generice (string), de aceea îl convertim la tipul nostru
const building = buildingData as unknown as Building;
const places = building.nodes.filter((node) => node.label);
const nodesById = new Map(building.nodes.map((node) => [node.id, node]));
const floorsById = new Map(building.floors.map((floor) => [floor.id, floor]));
const edgesByPair = new Map<string, (typeof building.edges)[number]>();
for (const edge of building.edges) {
  edgesByPair.set(`${edge.from}:${edge.to}`, edge);
  edgesByPair.set(`${edge.to}:${edge.from}`, edge);
}

const PROFILES: { value: AccessibilityProfile; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'wheelchair', label: 'Scaun cu rotile (fără scări)' },
  { value: 'visual', label: 'Deficiență de vedere' },
  { value: 'reduced', label: 'Mobilitate redusă' },
];

function speak(steps: RouteStep[]) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  for (const step of steps) {
    const text = step.landmark ? `${step.text}. ${step.landmark}` : step.text;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ro-RO';
    window.speechSynthesis.speak(utterance);
  }
}

export default function App() {
  const [from, setFrom] = useState(places[0].id);
  const [to, setTo] = useState(places[places.length - 1].id);
  const [profile, setProfile] = useState<AccessibilityProfile>('wheelchair');
  const [floorId, setFloorId] = useState(building.floors[0]?.id ?? '');
  const [scanMessage, setScanMessage] = useState('');

  function selectStart(placeId: string) {
    setFrom(placeId);
    const place = nodesById.get(placeId);
    if (place) setFloorId(place.floor);
  }

  async function scanStart() {
    setScanMessage('');
    try {
      const result = await window.QrStart.open();
      if (!result) return;
      const place = places.find((item) => item.id === result.id);
      if (!place) {
        setScanMessage('Acest cod QR nu corespunde niciunui punct de start.');
        return;
      }
      selectStart(place.id);
      window.VoiceGuide?.speakOnce(`Punct de start: ${place.label}`);
    } catch {
      setScanMessage('Scannerul QR nu este disponibil. Reîncarcă pagina și încearcă din nou.');
    }
  }
  const route = useMemo(() => findRoute(building, from, to, profile), [from, to, profile]);

  return (
    <div className="app-frame">
      <header className="topbar">
        <a href="#top" className="brand" aria-label="SmartQueue, pagina principală"><span className="brand-mark" aria-hidden="true">S</span><span>smart<span>queue</span></span></a>
        <nav className="main-nav" aria-label="Navigare principală"><a href="#queue">Programări</a><a href="#navigation-heading">Orientare</a></nav>
        <div className="topbar-tools"><span className="building-status"><span aria-hidden="true" />Servicii digitale</span><label className="profile-picker" htmlFor="accessibility-profile"><span className="profile-icon" aria-hidden="true">◉</span><select id="accessibility-profile" value={profile} onChange={(e) => setProfile(e.target.value as AccessibilityProfile)} aria-label="Profil de accesibilitate">
          {PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select></label></div>
      </header>
      <main id="top" className="app-shell">
        <section className="hero-card" aria-labelledby="welcome-heading">
          <div className="hero-copy"><span className="eyebrow hero-eyebrow"><span className="eyebrow-dot" />SERVICII PUBLICE, MAI UȘOR</span><h1 id="welcome-heading">Drumul tău.<br /><span>În ritmul tău.</span></h1><p>Ia un tichet, urmărește rândul în timp real și găsește un traseu accesibil până la ghișeu.</p><a className="hero-action" href="#queue">Începe acum <span aria-hidden="true">↓</span></a></div>
          <div className="hero-visual" aria-label="Servicii SmartQueue"><div className="hero-orbit hero-orbit--one" /><div className="hero-orbit hero-orbit--two" /><div className="hero-pin" aria-hidden="true">⌖</div><div className="hero-stat hero-stat--queue"><span className="hero-stat-icon" aria-hidden="true">≋</span><div><strong>Rândul tău</strong><small>actualizat în timp real</small></div><span className="hero-live-dot" /></div><div className="hero-stat hero-stat--route"><span className="hero-stat-icon" aria-hidden="true">↗</span><div><strong>Traseu accesibil</strong><small>pas cu pas, până la ghișeu</small></div></div><span className="hero-map-label">ORIENTARE INTERIOARĂ <span>•</span> ETAJ 1</span></div>
          <div className="hero-footer"><span><strong>01</strong> Alege serviciul</span><i /><span><strong>02</strong> Urmărește tichetul</span><i /><span><strong>03</strong> Urmează traseul</span></div>
        </section>
        <div className="page-intro"><div><span className="eyebrow">SERVICII ȘI ORIENTARE</span><h2>Tot ce ai nevoie, într-un singur loc</h2></div><p>Conceput pentru autonomie, accesibilitate și o vizită fără stres.</p></div>
        <QueuePanel profile={profile} onNavigate={(ticket) => {
        if (!ticket.desk) return;
        setTo(ticket.desk.locationId);
        setProfile(ticket.profile);
        document.getElementById('navigation-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('navigation-heading')?.focus({ preventScroll: true });
      }} />
      <section className="navigation-section" aria-labelledby="navigation-heading">
      <div className="navigation-heading-row"><div><span className="eyebrow">HARTĂ INTERACTIVĂ</span><h2 id="navigation-heading" tabIndex={-1}>Găsește-ți drumul</h2><p className="section-description">Alege punctul de plecare și destinația. Îți arătăm traseul potrivit profilului tău.</p></div><span className="map-access-badge"><span aria-hidden="true">♿</span> Rute accesibile</span></div>

      <div className="route-controls">
        <label htmlFor="route-start"><span className="control-caption">PUNCT DE PLECARE</span>
          <select id="route-start" value={from} onChange={(e) => selectStart(e.target.value)}>
            {places.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <label htmlFor="route-destination"><span className="control-caption">DESTINAȚIE</span>
          <select id="route-destination" value={to} onChange={(e) => setTo(e.target.value)}>
            {places.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <button className="secondary route-controls__scan" type="button" onClick={scanStart}><span aria-hidden="true">▦</span>
          Scanează cod QR
        </button>
      </div>
      {scanMessage && <p className="notice error" role="alert">{scanMessage}</p>}

      <div className="map-toolbar"><span className="map-toolbar-label">Selectează nivelul</span><div className="floor-switcher" role="group" aria-label="Selectează etajul hărții">
        {building.floors.map((floor) => (
          <button
            key={floor.id}
            className="floor-switcher__button"
            type="button"
            aria-pressed={floorId === floor.id}
            onClick={() => setFloorId(floor.id)}
          >
            {floor.name}
          </button>
        ))}
      </div>
      </div>

      <IndoorMap building={building} route={route} floorId={floorId} />

      {route?.nodePath.map((nodeId, index) => {
        const currentNode = nodesById.get(nodeId);
        const nextNode = nodesById.get(route.nodePath[index + 1]);
        if (!currentNode || !nextNode || currentNode.floor !== floorId || currentNode.floor === nextNode.floor) return null;

        const connection = edgesByPair.get(`${currentNode.id}:${nextNode.id}`);
        if (!connection || !['elevator', 'stairs', 'ramp'].includes(connection.mode)) return null;

        const nextFloor = floorsById.get(nextNode.floor);
        const transition = connection.mode === 'elevator' ? 'liftul' : connection.mode === 'ramp' ? 'rampa' : 'scările';
        return <p className="floor-transition" key={`${currentNode.id}-${nextNode.id}`}>
          Continuă folosind {currentNode.label ?? transition} către {nextFloor?.name ?? nextNode.floor}.
        </p>;
      })}


      {route ? (
        <section className="route-summary" aria-live="polite">
          <div className="route-summary-heading"><div><span className="eyebrow">TRASEUL RECOMANDAT</span><h3>{route.totalDistance} metri <span>·</span> {Math.round(route.estimatedSeconds / 60) || 1} min</h3></div>
          {'speechSynthesis' in window && <button className="secondary voice-button" onClick={() => speak(route.steps)}><span aria-hidden="true">◖))</span> Ascultă indicațiile</button>}</div>
          <ol className="route-steps">
            {route.steps.map((s) => (
              <li key={s.id}>
                {s.text}
                {s.landmark && <em> ({s.landmark})</em>}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p role="alert">Nu există traseu pentru acest profil între locațiile alese.</p>
      )}
      </section>
      <footer className="site-footer"><a href="#top" className="brand"><span className="brand-mark" aria-hidden="true">S</span><span>smart<span>queue</span></span></a><p>Accesibilitate și autonomie, la fiecare pas.</p><span>© 2026 SmartQueue</span></footer>
      </main>
    </div>
  );
}
