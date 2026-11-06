import { useMemo, useState } from 'react';
import buildingData from './data/building.json';
import type { AccessibilityProfile, Building, RouteStep } from './types';
import { findRoute } from './routing/findRoute';
import QueuePanel from './QueuePanel';
import './App.css';

// JSON-ul are tipuri generice (string), de aceea îl convertim la tipul nostru
const building = buildingData as unknown as Building;

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
  const places = building.nodes.filter((n) => n.label);
  const [from, setFrom] = useState(places[0].id);
  const [to, setTo] = useState(places[places.length - 1].id);
  const [profile, setProfile] = useState<AccessibilityProfile>('wheelchair');

  const route = useMemo(() => findRoute(building, from, to, profile), [from, to, profile]);

  return (
    <main>
      <header className="app-header"><a href="#" className="brand">Smart<span>Queue</span></a><span>Orientare accesibilă · Servicii publice</span></header>
      <div className="intro"><span className="eyebrow">Bine ai venit</span><h1>Mai puțină așteptare.<br />Mai multă independență.</h1><p>Alege profilul de accesibilitate, ia un tichet și găsește drumul către ghișeu.</p></div>
      <div className="profile-picker">
        <label htmlFor="accessibility-profile">Profil de accesibilitate</label>
        <select id="accessibility-profile" value={profile} onChange={(e) => setProfile(e.target.value as AccessibilityProfile)}>
          {PROFILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <QueuePanel profile={profile} onNavigate={(ticket) => {
        if (!ticket.desk) return;
        setTo(ticket.desk.locationId);
        setProfile(ticket.profile);
        document.getElementById('navigation-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('navigation-heading')?.focus({ preventScroll: true });
      }} />
      <section className="navigation-section panel" aria-labelledby="navigation-heading">
      <span className="eyebrow">Orientare în clădire</span>
      <h2 id="navigation-heading" tabIndex={-1}>Traseul tău accesibil</h2>

      <p>
        <label>
          Pornesc de la:{' '}
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {places.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
      </p>

      <p>
        <label>
          Vreau să ajung la:{' '}
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {places.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
      </p>

      {route ? (
        <section aria-live="polite">
          <h3>
            {route.totalDistance} m · aprox. {Math.round(route.estimatedSeconds / 60) || 1} min
          </h3>
          <ol>
            {route.steps.map((s) => (
              <li key={s.id}>
                {s.text}
                {s.landmark && <em> ({s.landmark})</em>}
              </li>
            ))}
          </ol>
          {'speechSynthesis' in window && <button className="secondary" onClick={() => speak(route.steps)}>Citește traseul cu voce tare</button>}
        </section>
      ) : (
        <p role="alert">Nu există traseu pentru acest profil între locațiile alese.</p>
      )}
      </section>
      <footer>SmartQueue · Păstrează pagina deschisă pentru a urmări tichetul.</footer>
    </main>
  );
}
