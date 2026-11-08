import { useMemo, useState } from 'react';
import buildingData from './data/building.json';
import type { AccessibilityProfile, Building, RouteStep } from './types';
import { findRoute } from './routing/findRoute';

// JSON-ul are tipuri generice (string), de aceea îl convertim la tipul nostru
const building = buildingData as unknown as Building;

const PROFILES: { value: AccessibilityProfile; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'wheelchair', label: 'Scaun cu rotile (fără scări)' },
  { value: 'visual', label: 'Deficiență de vedere' },
  { value: 'reduced', label: 'Mobilitate redusă' },
];

function speak(steps: RouteStep[]) {
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
  const [scanMessage, setScanMessage] = useState('');

async function scanStart() {
  const r = await window.QrStart.open();
  if (!r) return;
  const place = places.find((p) => p.id === r.id);
  if (place) {
    setFrom(place.id);
    setScanMessage('');
    window.VoiceGuide.speakOnce(`Punct de start: ${place.label}`);
  } else {
    setScanMessage('Acest cod QR nu corespunde niciunui punct de start.');
  }
}
  const route = useMemo(() => findRoute(building, from, to, profile), [from, to, profile]);

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 24, fontSize: 18, textAlign: 'left' }}>
      <h1>SmartQueue – test rutare</h1>

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
        <button type="button" onClick={scanStart}>Scanează codul QR de start</button>
      </p>
      {scanMessage && <p role="alert">{scanMessage}</p>}

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

      <p>
        <label>
          Profil:{' '}
          <select value={profile} onChange={(e) => setProfile(e.target.value as AccessibilityProfile)}>
            {PROFILES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
      </p>

      {route ? (
        <section aria-live="polite">
          <h2>
            {route.totalDistance} m · aprox. {Math.round(route.estimatedSeconds / 60) || 1} min
          </h2>
          <ol>
            {route.steps.map((s) => (
              <li key={s.id}>
                {s.text}
                {s.landmark && <em> ({s.landmark})</em>}
              </li>
            ))}
          </ol>
          <button onClick={() => speak(route.steps)}>Citește traseul cu voce tare</button>
        </section>
      ) : (
        <p role="alert">Nu există traseu pentru acest profil între locațiile alese.</p>
      )}
    </main>
  );
}
