import { useMemo, useState } from 'react';
import buildingData from './data/building.json';
import type { AccessibilityProfile, Building, RouteStep } from './types';
import { findRoute } from './routing/findRoute';
import QueuePanel from './QueuePanel';
import './App.css';
import IndoorMap from './components/IndoorMap';

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

type AppView = 'overview' | 'queue' | 'map' | 'staff';
const VIEW_LABELS: Record<AppView, string> = {
  overview: 'Prezentare', queue: 'Tichete', map: 'Hartă interioară', staff: 'Personal',
};

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
  const [activeView, setActiveView] = useState<AppView>('overview');

  function navigateTo(view: AppView, targetId?: string) {
    setActiveView(view);
    const element = document.getElementById(targetId ?? (view === 'overview' ? 'top' : view === 'queue' ? 'queue' : view === 'map' ? 'navigation' : 'staff-panel'));
    if (view === 'staff' && element instanceof HTMLDetailsElement) element.open = true;
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (view === 'map') document.getElementById('navigation-heading')?.focus({ preventScroll: true });
  }

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
        navigateTo('map');
        return;
      }
      selectStart(place.id);
      window.VoiceGuide?.speakOnce(`Punct de start: ${place.label}`);
      navigateTo('map');
    } catch {
      setScanMessage('Scannerul QR nu este disponibil. Alege punctul de plecare din listă.');
      navigateTo('map');
    }
  }

  const route = useMemo(() => findRoute(building, from, to, profile), [from, to, profile]);

  return (
    <div className="app-frame">
      <aside className="app-sidebar" aria-label="Meniul SmartQueue">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span className="brand-name">smart<span>queue</span></span>
        </div>

        <div className="location-card">
          <span className="location-icon" aria-hidden="true">⌂</span>
          <span><strong>Centrul civic</strong><small>Clădire principală</small></span>
        </div>

        <nav className="app-nav" aria-label="Navigare aplicație">
          <span className="nav-caption">MENIU PRINCIPAL</span>
          <button type="button" className={activeView === 'overview' ? 'app-nav__item active' : 'app-nav__item'} aria-current={activeView === 'overview' ? 'page' : undefined} onClick={() => navigateTo('overview')}>
            <span className="nav-icon" aria-hidden="true">⌂</span><span>Prezentare</span>
          </button>
          <button type="button" className={activeView === 'queue' ? 'app-nav__item active' : 'app-nav__item'} aria-current={activeView === 'queue' ? 'page' : undefined} onClick={() => navigateTo('queue')}>
            <span className="nav-icon" aria-hidden="true">▤</span><span>Tichete</span>
          </button>
          <button type="button" className={activeView === 'map' ? 'app-nav__item active' : 'app-nav__item'} aria-current={activeView === 'map' ? 'page' : undefined} onClick={() => navigateTo('map')}>
            <span className="nav-icon" aria-hidden="true">⌖</span><span>Hartă interioară</span>
          </button>
          <span className="nav-caption nav-caption--manage">GESTIONARE</span>
          <button type="button" className={activeView === 'staff' ? 'app-nav__item active' : 'app-nav__item'} aria-current={activeView === 'staff' ? 'page' : undefined} onClick={() => navigateTo('staff')}>
            <span className="nav-icon" aria-hidden="true">♙</span><span>Personal</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="accessibility-card"><span aria-hidden="true">◉</span><div><strong>Profil activ</strong><small>{PROFILES.find((item) => item.value === profile)?.label}</small></div><button type="button" aria-label="Alege profilul de accesibilitate" onClick={() => document.getElementById('accessibility-profile')?.focus()}>⌄</button></div>
          <div className="sidebar-user"><span className="user-avatar" aria-hidden="true">V</span><span><strong>Vizitator</strong><small>Sesiune locală</small></span><span className="user-menu-dots" aria-hidden="true">···</span></div>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="app-topbar">
          <div className="breadcrumbs"><span>SmartQueue</span><span aria-hidden="true">/</span><strong>{VIEW_LABELS[activeView]}</strong></div>
          <div className="topbar-controls">
            <span className="environment-badge"><span aria-hidden="true" />Mediu demonstrativ</span>
            <label className="profile-picker" htmlFor="accessibility-profile">
              <span className="profile-picker__icon" aria-hidden="true">◉</span>
              <span className="profile-picker__label">Accesibilitate</span>
              <select id="accessibility-profile" value={profile} onChange={(event) => setProfile(event.target.value as AccessibilityProfile)} aria-label="Profil de accesibilitate">
                {PROFILES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>
        </header>

        <main id="top" className="app-content">
          <section className="dashboard-heading" aria-labelledby="welcome-heading">
            <div><span className="eyebrow">CENTRUL CIVIC · CLĂDIRE PRINCIPALĂ</span><h1 id="welcome-heading">Cu ce te putem ajuta?</h1><p>Alege o acțiune sau continuă de unde ai rămas.</p></div>
            <button className="primary heading-action" type="button" onClick={() => navigateTo('queue')}><span aria-hidden="true">＋</span> Solicită tichet</button>
          </section>

          <section className="quick-actions" aria-label="Acțiuni rapide">
            <button className="quick-action" type="button" onClick={() => navigateTo('queue')}><span className="quick-action__icon quick-action__icon--mint" aria-hidden="true">▤</span><span className="quick-action__copy"><strong>Intră la rând</strong><small>Alege un serviciu și ia un tichet</small></span><span className="quick-action__arrow" aria-hidden="true">›</span></button>
            <button className="quick-action" type="button" onClick={() => navigateTo('map')}><span className="quick-action__icon quick-action__icon--blue" aria-hidden="true">⌖</span><span className="quick-action__copy"><strong>Găsește un ghișeu</strong><small>Vezi traseul potrivit profilului tău</small></span><span className="quick-action__arrow" aria-hidden="true">›</span></button>
            <button className="quick-action" type="button" onClick={() => void scanStart()}><span className="quick-action__icon quick-action__icon--amber" aria-hidden="true">▦</span><span className="quick-action__copy"><strong>Scanează cod QR</strong><small>Setează automat punctul de plecare</small></span><span className="quick-action__arrow" aria-hidden="true">›</span></button>
          </section>

          <QueuePanel profile={profile} onNavigate={(ticket) => {
            if (!ticket.desk) return;
            setTo(ticket.desk.locationId);
            setProfile(ticket.profile);
            navigateTo('map');
          }} />

          <section id="navigation" className="navigation-section" aria-labelledby="navigation-heading">
            <div className="navigation-heading-row"><div><span className="eyebrow">HARTĂ INTERACTIVĂ</span><h2 id="navigation-heading" tabIndex={-1}>Găsește-ți drumul</h2><p className="section-description">Alege plecarea și destinația pentru a vedea traseul accesibil.</p></div><span className="map-access-badge"><span aria-hidden="true">♿</span> Rute accesibile</span></div>

            <div className="route-controls">
              <label htmlFor="route-start"><span className="control-caption">PUNCT DE PLECARE</span><select id="route-start" value={from} onChange={(event) => selectStart(event.target.value)}>{places.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label>
              <label htmlFor="route-destination"><span className="control-caption">DESTINAȚIE</span><select id="route-destination" value={to} onChange={(event) => setTo(event.target.value)}>{places.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label>
              <button className="secondary route-controls__scan" type="button" onClick={() => void scanStart()}><span aria-hidden="true">▦</span> Scanează cod QR</button>
            </div>
            {scanMessage && <p className="notice error" role="alert">{scanMessage}</p>}

            <div className="map-toolbar"><span className="map-toolbar-label">Nivelul clădirii</span><div className="floor-switcher" role="group" aria-label="Selectează etajul hărții">
              {building.floors.map((floor) => <button key={floor.id} className="floor-switcher__button" type="button" aria-pressed={floorId === floor.id} onClick={() => setFloorId(floor.id)}>{floor.name}</button>)}
            </div></div>

            <IndoorMap building={building} route={route} floorId={floorId} />

            {route?.nodePath.map((nodeId, index) => {
              const currentNode = nodesById.get(nodeId);
              const nextNode = nodesById.get(route.nodePath[index + 1]);
              if (!currentNode || !nextNode || currentNode.floor !== floorId || currentNode.floor === nextNode.floor) return null;
              const connection = edgesByPair.get(`${currentNode.id}:${nextNode.id}`);
              if (!connection || !['elevator', 'stairs', 'ramp'].includes(connection.mode)) return null;
              const nextFloor = floorsById.get(nextNode.floor);
              const transition = connection.mode === 'elevator' ? 'liftul' : connection.mode === 'ramp' ? 'rampa' : 'scările';
              return <p className="floor-transition" key={`${currentNode.id}-${nextNode.id}`}>Continuă folosind {currentNode.label ?? transition} către {nextFloor?.name ?? nextNode.floor}.</p>;
            })}

            {route ? <section className="route-summary" aria-live="polite"><div className="route-summary-heading"><div><span className="eyebrow">TRASEUL RECOMANDAT</span><h3>{route.totalDistance} metri <span>·</span> {Math.round(route.estimatedSeconds / 60) || 1} min</h3></div>{'speechSynthesis' in window && <button className="secondary voice-button" type="button" onClick={() => speak(route.steps)}><span aria-hidden="true">◖))</span> Ascultă indicațiile</button>}</div><ol className="route-steps">{route.steps.map((step) => <li key={step.id}>{step.text}{step.landmark && <em> ({step.landmark})</em>}</li>)}</ol></section> : <p role="alert">Nu există traseu pentru acest profil între locațiile alese.</p>}
          </section>

          <footer className="app-footer"><span>SmartQueue</span><span>Accesibilitate și autonomie, la fiecare pas.</span><span>© 2026</span></footer>
        </main>
      </div>
    </div>
  );
}
