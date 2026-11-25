import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AccessibilityProfile, Building, QueueTicket } from './types';
import type { AccountSummary, AccountTicketSummary } from './account';
import { clearAccountSession, readAccountSession, saveAccountSession } from './account';
import { findRoute } from './routing/findRoute';
import QueuePanel from './QueuePanel';
import AccountPage from './AccountPage';
import BrandMark from './components/BrandMark';
import Icon from './components/Icon';
import IndoorMap from './components/IndoorMap';
import airiGroundFloor from './data/airi-ground-floor.json';
import { floorTwoBuilding } from './data/airi-floor-2';
import { connectAiriFloors } from './data/connect-floors';
import { findRoute } from './routing/findRoute';
import './App.css';

type AppView = 'home' | 'queue' | 'guidance' | 'accessibility' | 'staff' | 'account';
const VIEW_LABELS: Record<AppView, string> = {
  home: 'Acasă', queue: 'Servicii și tichet', guidance: 'Orientare interioară',
  accessibility: 'Accesibilitate', staff: 'Pentru personal', account: 'Cont personal',
};
const PROFILES: { value: AccessibilityProfile; label: string; help: string }[] = [
  { value: 'standard', label: 'Standard', help: 'Preferi trasee uzuale.' },
  { value: 'wheelchair', label: 'Scaun cu rotile', help: 'Evită scările. Include culoarele activate în aplicație; accesul fizic rămâne de confirmat.' },
  { value: 'visual', label: 'Deficiență de vedere', help: 'Prioritizează indicații audio și repere descrise.' },
  { value: 'reduced', label: 'Mobilitate redusă', help: 'Prioritizează distanțe mai scurte și evitarea scărilor.' },
];
const AIRI_GROUND_FLOOR = airiGroundFloor as Building & { source: { accessibilityVerified: boolean } };
const AIRI_BUILDING = connectAiriFloors(AIRI_GROUND_FLOOR, floorTwoBuilding);

function readView(): AppView {
  const view = window.location.hash.slice(1);
  return view === 'home' || view === 'queue' || view === 'guidance' || view === 'accessibility' || view === 'staff' || view === 'account' ? view : 'home';
}
function stored<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value) as T;
  } catch { return fallback; }
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>(readView);
  const [profile, setProfile] = useState<AccessibilityProfile>(() => stored('smartqueue-profile', 'wheelchair'));
  const [highContrast, setHighContrast] = useState(() => stored('smartqueue-contrast', false));
  const [largeText, setLargeText] = useState(() => stored('smartqueue-large-text', false));
  const [selectedDesk, setSelectedDesk] = useState<QueueTicket['desk']>(null);
  const [guidanceStart, setGuidanceStart] = useState('scan-11');
  const [guidanceDestination, setGuidanceDestination] = useState('');
  const [account, setAccount] = useState<AccountSummary | null>(() => readAccountSession()?.account ?? null);
  const [accountToken, setAccountToken] = useState(() => readAccountSession()?.accessToken ?? '');
  const [accountHydrated, setAccountHydrated] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState('');
  const [accountTickets, setAccountTickets] = useState<AccountTicketSummary[]>([]);
  const [loadingAccountTickets, setLoadingAccountTickets] = useState(false);

  useEffect(() => {
    const session = readAccountSession();
    if (!session) { setAccountHydrated(true); return; }
    fetch('/api/account/me', { headers: { Authorization: `Bearer ${session.accessToken}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sesiunea a expirat. Conectează-te din nou.');
        const data = await response.json() as { account: AccountSummary };
        setAccount(data.account); setAccountToken(session.accessToken);
        setProfile(data.account.profile); setHighContrast(data.account.highContrast); setLargeText(data.account.largeText);
        saveAccountSession(session.accessToken, data.account);
      })
      .catch((error: Error) => { clearAccountSession(); setAccount(null); setAccountToken(''); setAccountError(error.message); })
      .finally(() => setAccountHydrated(true));
  }, []);
  const [adminName, setAdminName] = useState('');

  useEffect(() => {
    const syncView = () => setActiveView(readView());
    window.addEventListener('popstate', syncView);
    window.addEventListener('hashchange', syncView);
    return () => {
      window.removeEventListener('popstate', syncView);
      window.removeEventListener('hashchange', syncView);
    };
  }, []);

  useEffect(() => { window.localStorage.setItem('smartqueue-profile', JSON.stringify(profile)); }, [profile]);
  useEffect(() => { window.localStorage.setItem('smartqueue-contrast', JSON.stringify(highContrast)); }, [highContrast]);
  useEffect(() => { window.localStorage.setItem('smartqueue-large-text', JSON.stringify(largeText)); }, [largeText]);

  useEffect(() => {
    const landmarks = AIRI_BUILDING.nodes.flatMap((node) => node.label ? [{ id: node.id, label: node.label }] : []);
    const appWindow = window as Window & { smartqueueMapLandmarks?: typeof landmarks };
    appWindow.smartqueueMapLandmarks = landmarks;
    window.dispatchEvent(new CustomEvent('smartqueue-map-landmarks', { detail: landmarks }));
    const openGuidance = () => {
      setActiveView('guidance');
      if (window.location.hash !== '#guidance') window.history.pushState({}, '', '#guidance');
    };
    const setVoiceOrigin = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
      if (nodeId && landmarks.some((item) => item.id === nodeId)) { setGuidanceStart(nodeId); openGuidance(); }
    };
    const setVoiceDestination = (event: Event) => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
      if (nodeId && landmarks.some((item) => item.id === nodeId)) { setGuidanceDestination(nodeId); openGuidance(); }
    };
    window.addEventListener('smartqueue-route-origin', setVoiceOrigin);
    window.addEventListener('smartqueue-route-destination', setVoiceDestination);
    return () => {
      window.removeEventListener('smartqueue-route-origin', setVoiceOrigin);
      window.removeEventListener('smartqueue-route-destination', setVoiceDestination);
      delete appWindow.smartqueueMapLandmarks;
    };
  }, []);

  useEffect(() => {
    if (!accountToken || !accountHydrated) return;
    const timer = window.setTimeout(() => {
      void fetch('/api/account/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accountToken}` },
        body: JSON.stringify({ profile, highContrast, largeText }) })
        .then(async (response) => {
          if (!response.ok) return;
          const data = await response.json() as { account: AccountSummary };
          setAccount(data.account); saveAccountSession(accountToken, data.account);
        }).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [accountToken, accountHydrated, profile, highContrast, largeText]);

  useEffect(() => {
    if (activeView !== 'account' || !accountToken || !account) return;
    let live = true;
    setLoadingAccountTickets(true);
    fetch('/api/account/tickets', { headers: { Authorization: `Bearer ${accountToken}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Istoricul nu este disponibil momentan.');
        return response.json() as Promise<AccountTicketSummary[]>;
      })
      .then((tickets) => { if (live) setAccountTickets(tickets); })
      .catch((error: Error) => { if (live) setAccountError(error.message); })
      .finally(() => { if (live) setLoadingAccountTickets(false); });
    return () => { live = false; };
  }, [activeView, accountToken, account]);

  function navigateTo(view: AppView) {
    setActiveView(view);
    window.history.pushState({}, '', `#${view}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => document.getElementById('page-heading')?.focus(), 0);
  }
  function showDesk(ticket: QueueTicket) {
    setSelectedDesk(ticket.desk); setGuidanceDestination('');
    navigateTo('guidance');
  }

  async function authenticate(email: string, password: string, mode: 'login' | 'register'): Promise<boolean> {
    setAccountBusy(true); setAccountError('');
    try {
      const response = await fetch(`/api/account/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json().catch(() => null) as { account?: AccountSummary; accessToken?: string; error?: { message?: string } } | null;
      if (!response.ok || !data?.account || !data.accessToken) throw new Error(data?.error?.message ?? 'Nu am putut accesa contul. Încearcă din nou.');
      let nextAccount = data.account;
      if (mode === 'register') {
        const preferences = await fetch('/api/account/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.accessToken}` }, body: JSON.stringify({ profile, highContrast, largeText }) });
        if (preferences.ok) nextAccount = (await preferences.json() as { account: AccountSummary }).account;
      } else {
        setProfile(nextAccount.profile); setHighContrast(nextAccount.highContrast); setLargeText(nextAccount.largeText);
      }
      saveAccountSession(data.accessToken, nextAccount); setAccount(nextAccount); setAccountToken(data.accessToken); setAccountHydrated(true); navigateTo('account');
      return true;
    } catch (error) { setAccountError((error as Error).message); return false; }
    finally { setAccountBusy(false); }
  }

  async function logout() {
    if (accountToken) await fetch('/api/account/logout', { method: 'POST', headers: { Authorization: `Bearer ${accountToken}` } }).catch(() => undefined);
    clearAccountSession(); setAccount(null); setAccountToken(''); setAccountTickets([]); setAccountError(''); navigateTo('home');
  }

  const frameClasses = ['app-frame', highContrast ? 'app-frame--high-contrast' : '', largeText ? 'app-frame--large-text' : ''].filter(Boolean).join(' ');
  const currentProfile = PROFILES.find((item) => item.value === profile) ?? PROFILES[1];

  return (
    <div className={frameClasses}>
      <aside className="app-sidebar" aria-label="Meniul SmartQueue">
        <button className="sidebar-brand" type="button" onClick={() => navigateTo('home')} aria-label="SmartQueue, acasă">
          <BrandMark /><span className="brand-name">Smart<span>Queue</span></span>
        </button>
        <nav className="app-nav" aria-label="Navigare aplicație">
          <div className="nav-group"><span className="nav-caption">NAVIGARE</span>
            <NavButton icon="home" label="Acasă" active={activeView === 'home'} onClick={() => navigateTo('home')} />
            <NavButton icon="ticket" label="Servicii și tichet" active={activeView === 'queue'} onClick={() => navigateTo('queue')} />
            <NavButton icon="map" label="Orientare interioară" active={activeView === 'guidance'} onClick={() => navigateTo('guidance')} />
          </div>
          <div className="nav-group"><span className="nav-caption">PREFERINȚE</span>
            <NavButton icon="accessibility" label="Accesibilitate" active={activeView === 'accessibility'} onClick={() => navigateTo('accessibility')} />
          </div>
          <div className="nav-group nav-group--staff"><span className="nav-caption">ADMINISTRARE</span>
            <NavButton icon="staff" label="Ghișeu" active={activeView === 'staff'} onClick={() => navigateTo('staff')} />
          </div>
        </nav>

        <div className="sidebar-bottom">
          <div className="accessibility-card" aria-label={`Profilul de acces curent: ${currentProfile.label}`}>
            <span><Icon name="accessibility" size={17} /></span><span><strong>Profil de acces</strong><small>{currentProfile.label}</small></span>
          </div>
          <button className="sidebar-user sidebar-user--button" type="button" onClick={() => navigateTo('account')}><span className="user-avatar" aria-hidden="true">{adminName ? 'A' : account ? account.email.slice(0, 1).toUpperCase() : 'V'}</span><span><strong>{adminName || (account ? account.email : 'Contul meu')}</strong><small>{adminName ? 'Administrator autentificat' : account ? 'Cont conectat' : 'Conectare sau înregistrare'}</small></span></button>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="app-topbar">
          <div className="breadcrumbs"><span>SmartQueue</span><span aria-hidden="true">/</span><strong>{VIEW_LABELS[activeView]}</strong></div>
          <div className="topbar-controls">
            <button className="account-entry" type="button" onClick={() => navigateTo('account')} aria-label={account ? `Cont conectat: ${account.email}` : 'Conectare sau creează cont'}>
              <span className="account-entry__icon"><Icon name="staff" size={17} /></span><span>{account ? 'Contul meu' : 'Conectare'}</span>
            </button>
            <label className="profile-picker" htmlFor="accessibility-profile"><span className="profile-picker__icon"><Icon name="accessibility" size={16} /></span><span className="profile-picker__label">Profil</span>
              <select id="accessibility-profile" value={profile} onChange={(event) => setProfile(event.target.value as AccessibilityProfile)} aria-label="Profil de accesibilitate">
                {PROFILES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>
        </header>

        <main id="top" className="app-content">
          {activeView === 'home' && <HomePage goTo={navigateTo} />}
          <QueuePanel visible={activeView === 'queue' || activeView === 'staff'} mode={activeView === 'staff' ? 'staff' : 'visitor'} profile={profile} requesterLocationId={guidanceStart} onAdminChange={setAdminName} onOpenAdmin={() => navigateTo('staff')} onLocateRequester={(locationId, ticketProfile) => {
            setSelectedDesk(null); setGuidanceDestination(locationId); setProfile(ticketProfile); navigateTo('guidance');
          }} onNavigate={showDesk} />
          {activeView === 'guidance' && <GuidancePage desk={selectedDesk} profile={profile} profileLabel={currentProfile.label} startId={guidanceStart} destinationId={guidanceDestination} setStartId={setGuidanceStart} setDestinationId={setGuidanceDestination} goToQueue={() => navigateTo('queue')} />}
          {activeView === 'accessibility' && <AccessibilityPage profile={profile} setProfile={setProfile} highContrast={highContrast} setHighContrast={setHighContrast} largeText={largeText} setLargeText={setLargeText} />}
          {activeView === 'account' && <AccountPage account={account} tickets={accountTickets} loadingTickets={loadingAccountTickets} busy={accountBusy} error={accountError} onAuthenticate={authenticate} onLogout={() => void logout()} goToAccessibility={() => navigateTo('accessibility')} />}
          <footer className="app-footer"><span>SmartQueue</span><span>Accesibilitate și autonomie, la fiecare pas.</span><span>© 2026</span></footer>
        </main>
      </div>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: 'home' | 'ticket' | 'map' | 'staff' | 'accessibility'; label: string; active: boolean; onClick: () => void }) {
  return <button type="button" className={`app-nav__item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}><span className="nav-icon"><Icon name={icon} /></span><span>{label}</span></button>;
}

function HomePage({ goTo }: { goTo: (view: AppView) => void }) {
  return <>
    <section className="dashboard-heading" aria-labelledby="page-heading">
      <div><span className="eyebrow">SMARTQUEUE · VIZITATOR</span><h1 id="page-heading" tabIndex={-1}>Ce ai nevoie să faci?</h1><p>Alege o acțiune pentru vizita ta.</p></div>
      <span className="home-heading-icon" aria-hidden="true"><Icon name="map" size={27} /></span>
    </section>
    <section className="home-feature-grid" aria-label="Acțiuni principale">
      <button className="home-feature-card" type="button" onClick={() => goTo('queue')}><span className="feature-icon"><Icon name="ticket" /></span><span className="feature-copy"><strong>Solicită un tichet</strong><small>Alege serviciul și urmărește când îți vine rândul.</small></span><Icon name="arrow" size={17} /></button>
      <button className="home-feature-card" type="button" onClick={() => goTo('guidance')}><span className="feature-icon feature-icon--blue"><Icon name="map" /></span><span className="feature-copy"><strong>Orientare interioară</strong><small>Vezi ghișeul și informațiile de orientare disponibile.</small></span><Icon name="arrow" size={17} /></button>
      <button className="home-feature-card" type="button" onClick={() => goTo('accessibility')}><span className="feature-icon feature-icon--gold"><Icon name="accessibility" /></span><span className="feature-copy"><strong>Accesibilitate</strong><small>Setează profilul de deplasare, contrastul și mărimea textului.</small></span><Icon name="arrow" size={17} /></button>
    </section>
    <section className="home-note"><span className="home-note__icon"><Icon name="info" size={18} /></span><div><strong>Folosește aplicația cu sau fără cont</strong><p>Tichetul se poate solicita fără cont. Cu un cont salvezi preferințele și istoricul vizitelor.</p></div><button type="button" className="text-button" onClick={() => goTo('account')}>Contul meu <Icon name="arrow" size={14} /></button></section>
  </>;
}

function GuidancePage({ desk, profile, profileLabel, startId, destinationId, setStartId, setDestinationId, goToQueue }: {
  desk: QueueTicket['desk']; profile: AccessibilityProfile; profileLabel: string;
  startId: string; destinationId: string; setStartId: (value: string) => void;
  setDestinationId: (value: string) => void; goToQueue: () => void;
}) {
  const [visibleFloor, setVisibleFloor] = useState<1 | 2>(1);
  const floorControlsRef = useRef<HTMLDivElement>(null);
  const previousFloor = useRef(visibleFloor);
  useLayoutEffect(() => {
    if (previousFloor.current !== visibleFloor) {
      floorControlsRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
      previousFloor.current = visibleFloor;
    }
  }, [visibleFloor]);
  const building = AIRI_BUILDING;
  const floor = building.floors[visibleFloor - 1];
  const schematic = floor.distanceUnit === 'schematic';
  const nodesById = useMemo(() => new Map(building.nodes.map((node) => [node.id, node])), [building]);
  const locations = useMemo(() => building.nodes.filter((node) => node.label).map((node) => ({ node, label: node.label! })), [building]);
  const locationGroups = building.floors.map((item) => ({
    floor: item,
    locations: locations.filter(({ node }) => node.floor === item.id),
  }));
  const deskMatchesFloor = Boolean(desk && desk.buildingId === building.id && nodesById.has(desk.locationId));
  const activeDestination = destinationId || (deskMatchesFloor ? desk!.locationId : '');
  const directRoute = startId && activeDestination
    ? findRoute(building, startId, activeDestination, profile)
    : null;
  const route = directRoute;
  const originFloor = building.floors.find((item) => item.id === nodesById.get(startId)?.floor);
  const destinationFloor = building.floors.find((item) => item.id === nodesById.get(activeDestination)?.floor);
  const crossFloor = originFloor && destinationFloor && originFloor.id !== destinationFloor.id;
  const routeIsSchematic = route?.distanceUnit === 'schematic';
  const accessibilityUnconfirmed = profile === 'wheelchair' && !AIRI_GROUND_FLOOR.source.accessibilityVerified;
  const startLabel = locations.find((item) => item.node.id === startId)?.label;
  const destinationLabel = destinationId
    ? locations.find((item) => item.node.id === destinationId)?.label
    : deskMatchesFloor ? desk!.name : undefined;
  const [currentStep, setCurrentStep] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState('');

  useEffect(() => { setCurrentStep(0); setVoiceStatus(''); window.speechSynthesis?.cancel(); }, [startId, activeDestination, profile]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const currentStepIndex = route?.steps.length ? Math.min(currentStep, route.steps.length - 1) : 0;
  const currentRouteStep = route?.steps[currentStepIndex];
  const instructionFloor = currentRouteStep?.fromFloor ?? nodesById.get(currentRouteStep?.nodeId ?? '')?.floor;
  const instructionFloorName = building.floors.find(item => item.id === instructionFloor)?.name;
  useEffect(() => {
    const detail = route ? {
      floor: instructionFloorName ?? originFloor?.name ?? floor.name,
      origin: startLabel ?? 'Punctul de plecare ales pe plan',
      destination: destinationLabel ?? 'Punctul de sosire ales pe plan',
      currentStepIndex,
      currentStep: currentRouteStep?.text ?? '',
      steps: route.steps.map((step) => ({ action: step.action, text: step.text, landmark: step.landmark ?? locations.find((item) => item.node.id === step.nodeId)?.label ?? 'reperul de orientare' })),
      ...(!routeIsSchematic ? { totalDistance: Number(route.totalDistance.toFixed(2)) } : {}),
      verified: false,
      locationDetected: false,
      landmarks: locations.map(({ node, label }) => ({ id: node.id, label })),
    } : null;
    window.dispatchEvent(new CustomEvent('smartqueue-route-context', { detail }));
  }, [route, currentStepIndex, currentRouteStep, floor.name, startLabel, destinationLabel, visibleFloor, routeIsSchematic, originFloor?.name, instructionFloorName]);
  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('smartqueue-route-context', { detail: null }));
  }, []);

  useEffect(() => {
    const advance = () => setCurrentStep((index) => Math.min(index + 1, (route?.steps.length ?? 1) - 1));
    window.addEventListener('smartqueue-route-next', advance);
    return () => window.removeEventListener('smartqueue-route-next', advance);
  }, [route?.steps.length, visibleFloor]);

  function speak(text: string) {
    if (!('speechSynthesis' in window)) { setVoiceStatus('Citirea vocală nu este disponibilă în acest browser.'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ro-RO';
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
    setVoiceStatus('Redau indicația în limba română.');
  }

  return <section className="guidance-page guidance-page--map" aria-labelledby="page-heading">
    <div className="dashboard-heading"><div><span className="eyebrow">TURUL VIRTUAL AIRI · {floor.name}</span><h1 id="page-heading" tabIndex={-1}>Găsește drumul</h1><p>Alege plecarea și destinația pentru a calcula automat cel mai scurt traseu disponibil pe hartă.</p></div><span className="profile-context"><Icon name="accessibility" size={17} /> {profileLabel}</span></div>
    {schematic && <p className="route-data-note">Floor 2: trasee orientative după fotografii, calculate pe culoarele desenate. Pozițiile sunt aproximative; distanțele în metri nu sunt cunoscute. Reperele scărilor indică palierele și ușile, nu schimbă automat etajul.</p>}
    {profile === 'wheelchair' && <p className="route-info">Toate culoarele cartografiate sunt activate pentru calculul traseelor în scaun rulant. Scările sunt excluse; accesibilitatea fizică nu este verificată.</p>}
    {desk && <div className="destination-card"><span className="destination-card__icon"><Icon name="staff" size={21} /></span><div><span className="eyebrow">DESTINAȚIA TICHETULUI TĂU</span><strong>{desk.name}</strong><p>{desk.floor === 0 ? 'Parter' : `Etajul ${desk.floor}`}</p></div><span className={`desk-status desk-status--${desk.status.toLowerCase()}`}>{desk.status === 'OPEN' ? 'Deschis' : desk.status === 'PAUSED' ? 'Pauză' : 'Închis'}</span></div>}

    <div className="route-planner">
      <label className="route-planner__field"><span>PLECARE</span><select value={startId} onChange={(event) => setStartId(event.target.value)} aria-label="Punctul de plecare"><option value="">Alege reperul de lângă tine</option>{locationGroups.map((group) => <optgroup key={group.floor.id} label={`Floor ${group.floor.level + 1} - ${group.floor.name}`}>{group.locations.map(({ node, label }) => <option key={node.id} value={node.id}>{label}</option>)}</optgroup>)}</select></label>
      <button type="button" className="route-swap" aria-label="Inversează plecarea și destinația" disabled={!startId || !activeDestination} onClick={() => { setStartId(activeDestination); setDestinationId(startId); }}>⇅</button>
      <label className="route-planner__field"><span>DESTINAȚIE</span><select value={destinationId || (deskMatchesFloor ? desk!.locationId : '')} onChange={(event) => setDestinationId(event.target.value)} aria-label="Punctul de sosire"><option value="">Alege unde vrei să ajungi</option>{locationGroups.map((group) => <optgroup key={group.floor.id} label={`Floor ${group.floor.level + 1} - ${group.floor.name}`}>{group.locations.map(({ node, label }) => <option key={node.id} value={node.id}>{label}</option>)}</optgroup>)}</select></label>
      <button type="button" className="route-clear" disabled={!startId && !destinationId} onClick={() => { setStartId(''); setDestinationId(''); }}>Resetează</button>
    </div>
    {desk && !deskMatchesFloor && <p className="route-info" role="status">Punctul acestui tichet nu este înregistrat pe plan, deci nu pot calcula un traseu până la el. Cere operatorului locul exact. Poți alege separat o plecare și o destinație marcate pe plan.</p>}
    {crossFloor && route && <p className="route-info" role="status">Traseu între {originFloor.name} și {destinationFloor.name}. Urmează indicația pentru lift sau scară, apoi confirmă sosirea pe noul etaj. Butoanele hărții permit vizualizarea oricărui etaj fără să schimbe poziția confirmată. Alegerea traseului folosește lungimi aproximative pe schemă.</p>}
    {route && !crossFloor && originFloor?.id !== floor.id && <p className="route-info" role="status">Traseul selectat este pe {originFloor?.name}. Folosește butoanele de deasupra hărții pentru a afișa acel etaj.</p>}

    <p className="route-data-note">Punctul albastru arată ultimul reper ales sau confirmat. Activează „Urmărește direcția” pentru rotirea hărții. Confirmă reperul când ajungi acolo. Poziția nu este detectată automat.</p>
    {accessibilityUnconfirmed && route && <p className="route-warning" role="alert"><strong>Accesibilitatea traseului nu a fost verificată la fața locului.</strong> Modelul nu confirmă pragurile, lățimea ușilor sau dacă traseul este liber. Pentru scaun rulant, folosește această rută ca plan de orientare și cere confirmarea personalului înainte de deplasare.</p>}
    {route && !accessibilityUnconfirmed && profile === 'wheelchair' && <p className="route-safe" role="status">Datele planului marchează acest traseu fără trepte. Confirmă condițiile la fața locului.</p>}
    {startId && activeDestination && startId === activeDestination && <p className="route-info" role="status">Plecare și destinație identice. Alege două puncte diferite.</p>}
    {startId && activeDestination && startId !== activeDestination && !route && <p className="route-info" role="status">{profile === 'wheelchair' ? 'Turul nu confirmă ce legături sunt fără trepte, așa că nu pot afișa o rută sigură pentru scaun rulant. Cere personalului confirmarea traseului accesibil.' : 'Nu există o legătură de navigare în tur între aceste repere.'}</p>}

    {route && currentRouteStep && <section className="route-current-step" aria-live="polite" aria-atomic="true">
      <span>{currentRouteStep.action === 'arrive' ? 'AI AJUNS' : `PASUL ${currentStepIndex + 1} DIN ${route.steps.length}`}</span>
      {instructionFloorName && <small>{instructionFloorName}{currentRouteStep.toFloor ? ` → ${building.floors.find(item => item.id === currentRouteStep.toFloor)?.name}` : ''}</small>}
      <strong>{currentRouteStep.text}</strong>
      <small>Urmează traseul marcat; punctul albastru se mută când confirmi că ai ajuns la reper. Previzualizările neverificate sunt desenate punctat.</small>
      <div>
        <button type="button" className="secondary" onClick={() => speak(currentRouteStep.text)}>Repetă indicația</button>
        <button type="button" className="primary" disabled={currentStepIndex >= route.steps.length - 1} onClick={() => { const next = Math.min(currentStepIndex + 1, route.steps.length - 1); if (currentRouteStep.toFloor) setVisibleFloor(currentRouteStep.toFloor === 'airi-ground' ? 1 : 2); setCurrentStep(next); speak(route.steps[next].text); }}>{currentRouteStep.toFloor ? `Am ajuns pe Floor ${currentRouteStep.toFloor === 'airi-ground' ? 1 : 2}` : 'Am ajuns la reper'} <Icon name="arrow" size={15} /></button>
      </div>
    </section>}

    <div ref={floorControlsRef} className="floor-switcher floor-switcher--map" role="group" aria-label="Alege etajul afișat">
      <button type="button" className={visibleFloor === 1 ? 'primary' : 'secondary'} aria-pressed={visibleFloor === 1} onClick={() => { setVisibleFloor(1); window.speechSynthesis?.cancel(); }}>Floor 1 · Parter</button>
      <button type="button" className={visibleFloor === 2 ? 'primary' : 'secondary'} aria-pressed={visibleFloor === 2} onClick={() => { setVisibleFloor(2); window.speechSynthesis?.cancel(); }}>Floor 2 · Etajul 1</button>
    </div>
    <IndoorMap key={floor.id} building={building} floorId={floor.id} route={route} currentStepIndex={currentStepIndex} activeNodeId={currentRouteStep?.nodeId} startNodeId={startId || undefined} destinationNodeId={activeDestination || undefined} routeIsPreview={accessibilityUnconfirmed || schematic} onNodeSelect={(nodeId) => { if (!startId) setStartId(nodeId); else if (!destinationId) setDestinationId(nodeId); else setDestinationId(nodeId); }} locationLabel={(node) => locations.find((item) => item.node.id === node.id)?.label ?? node.label ?? 'Reper de orientare'} />

    {route && <section className="route-guidance" aria-labelledby="route-guidance-heading">
      <div className="route-guidance__header"><div><span className="eyebrow">TRASEU ÎN PLAN</span><h2 id="route-guidance-heading">{startLabel} → {destinationLabel}</h2><p>{route.steps.length} indicații · {routeIsSchematic ? 'cel mai scurt traseu pe schema orientativă' : `${route.totalDistance.toLocaleString('ro-RO', { maximumFractionDigits: 2 })} m între pozițiile scanărilor`}</p></div>
      <div className="route-voice-actions"><button type="button" className="secondary" onClick={() => speak(`${accessibilityUnconfirmed ? 'Atenție. Accesibilitatea traseului nu a fost confirmată la fața locului. ' : ''}${route.steps.map((step) => step.text).join('. ')}`)}><Icon name="accessibility" size={16} /> Ascultă traseul</button><button type="button" className="text-button" onClick={() => { window.speechSynthesis?.cancel(); setVoiceStatus('Ghidarea vocală a fost oprită.'); }}>Oprește vocea</button></div>
      </div>
      {voiceStatus && <p className="route-voice-status" role="status">{voiceStatus}</p>}
      <ol className="route-step-list">{route.steps.map((step, index) => <li key={step.id} className={index === currentStepIndex ? 'is-current' : ''}><span>{index + 1}</span><div><strong>{step.text}</strong>{!routeIsSchematic && step.distance !== undefined && <small>{step.distance.toLocaleString('ro-RO', { maximumFractionDigits: 2 })} m între pozițiile scanărilor — nu distanță pietonală măsurată</small>}</div><button type="button" aria-label={`Ascultă pasul ${index + 1}`} onClick={() => { setCurrentStep(index); speak(step.text); }}>Ascultă</button></li>)}</ol>
    </section>}

    <p className="route-source-note">Sursă: <a href="https://airi.utcluj.ro/about/virtual-tour" target="_blank" rel="noreferrer">turul virtual AIRI</a> · {schematic ? 'schemă trasată după fotografiile furnizate, fără coordonate măsurate.' : 'pozițiile urmează modelul Matterport.'} Reperul albastru este ales sau confirmat manual.</p>
    {desk && <button type="button" className="text-button guidance-ticket-link" onClick={goToQueue}><Icon name="ticket" size={16} /> Înapoi la tichet</button>}
  </section>;
}

function AccessibilityPage({ profile, setProfile, highContrast, setHighContrast, largeText, setLargeText }: { profile: AccessibilityProfile; setProfile: (value: AccessibilityProfile) => void; highContrast: boolean; setHighContrast: (value: boolean) => void; largeText: boolean; setLargeText: (value: boolean) => void }) {
  return <section className="preferences-page" aria-labelledby="page-heading"><div className="dashboard-heading"><div><span className="eyebrow">PREFERINȚE PERSONALE</span><h1 id="page-heading" tabIndex={-1}>Accesibilitate</h1><p>Setările se păstrează pe acest dispozitiv și pot fi schimbate oricând.</p></div><span className="home-heading-icon"><Icon name="accessibility" size={27} /></span></div>
    <div className="preferences-layout"><section className="preferences-card"><span className="eyebrow">PROFIL DE DEPLASARE</span><h2>Ce ți se potrivește?</h2><p>Profilul ne ajută să alegem opțiuni de orientare potrivite atunci când traseele verificate vor fi disponibile.</p><div className="profile-options">{PROFILES.map((item) => <button type="button" key={item.value} className={`profile-option${profile === item.value ? ' selected' : ''}`} aria-pressed={profile === item.value} onClick={() => setProfile(item.value)}><span className="profile-option__radio" aria-hidden="true"/><span><strong>{item.label}</strong><small>{item.help}</small></span></button>)}</div></section>
      <section className="preferences-card"><span className="eyebrow">AFIȘARE</span><h2>Fă aplicația mai ușor de citit</h2><p>Alege contrastul și dimensiunea textului pentru acest dispozitiv.</p><PreferenceToggle title="Contrast ridicat" description="Text și elemente mai ușor de distins." checked={highContrast} onChange={setHighContrast} /><PreferenceToggle title="Text mărit" description="Mărește textul în întreaga aplicație." checked={largeText} onChange={setLargeText} /></section></div>
  </section>;
}

function PreferenceToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="preference-toggle"><span><strong>{title}</strong><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
}
