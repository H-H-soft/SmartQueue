import { useMemo, useState } from 'react';
import buildingData from './data/building.json';
import type { AccessibilityProfile, Building, RouteStep } from './types';
import { findRoute } from './routing/findRoute';
import IndoorMap from './components/IndoorMap';

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
  const [floorId, setFloorId] = useState(building.floors[0]?.id ?? '');

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



     <div
  role="group"
  aria-label="Selectează etajul"
  style={{ display: 'flex', gap: 12, marginBottom: 16 }}
>
  {building.floors.map((floor) => (
    <button
      key={floor.id}
      type="button"
      aria-pressed={floorId === floor.id}
      onClick={() => setFloorId(floor.id)}
      style={{
        padding: '12px 20px',
        minHeight: 48,
        borderRadius: 8,
        border: '2px solid #1d4ed8',
        backgroundColor: floorId === floor.id ? '#1d4ed8' : '#ffffff',
        color: floorId === floor.id ? '#ffffff' : '#1d4ed8',
        cursor: 'pointer',
        fontWeight: 700,
      }}
    >
      {floor.name}
    </button>
  ))}
</div>

      <IndoorMap building={building} route={route} floorId={floorId} />

      {route?.nodePath.map((nodeId, index) => {
  const currentNode = building.nodes.find(
    (node) => node.id === nodeId,
  );
  const nextNode = building.nodes.find(
    (node) => node.id === route.nodePath[index + 1],
  );

  if (
    !currentNode ||
    !nextNode ||
    currentNode.floor !== floorId ||
    currentNode.floor === nextNode.floor
  ) {
    return null;
  }

  const connection = building.edges.find(
    (edge) =>
      (edge.from === currentNode.id && edge.to === nextNode.id) ||
      (edge.to === currentNode.id && edge.from === nextNode.id),
  );

  if (
    !connection ||
    (connection.mode !== 'elevator' && connection.mode !== 'stairs')
  ) {
    return null;
  }

  const nextFloor = building.floors.find(
    (floor) => floor.id === nextNode.floor,
  );

  return (
    <div key={`${currentNode.id}-${nextNode.id}`}>
      <p>
        Continuă folosind {currentNode.label ?? 'legătura dintre etaje'}
        {' '}către {nextFloor?.name ?? nextNode.floor}.
      </p>

      
    </div>
  );
})}


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
