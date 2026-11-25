import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { readAccountSession } from './account';
import airiGroundFloor from './data/airi-ground-floor.json';
import { floorTwoBuilding } from './data/airi-floor-2';
import type { AccessibilityProfile, AdminSession, AdminTicket, CreatedQueueTicket, QueueDeskSummary, QueueService, QueueSummary, QueueTicket, QueueTicketStatus } from './types';

const STATUS: Record<QueueTicketStatus, string> = {
  WAITING: 'În așteptare', CALLED: 'Ești chemat la ghișeu', SERVING: 'În curs de servire',
  COMPLETED: 'Finalizat', CANCELLED: 'Anulat', MISSED: 'Neprezentat',
};
const terminal = (ticket: Pick<QueueTicket, 'status'>) => ['COMPLETED', 'CANCELLED', 'MISSED'].includes(ticket.status);
const floorPlan = {
  ...airiGroundFloor,
  floors: [...airiGroundFloor.floors, ...floorTwoBuilding.floors],
  nodes: [...airiGroundFloor.nodes, ...floorTwoBuilding.nodes],
};
const normalizeText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('ro-RO').trim();
const building = floorPlan;
const locationLandmarks = building.nodes.filter((node) => node.label?.trim());
type Credentials = { id: string; accessToken: string };
const storageKey = 'smartqueue.ticket';
const adminStorageKey = 'smartqueue.admin';
function restoreAdmin(): AdminSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(adminStorageKey) ?? 'null');
    return typeof value?.accessToken === 'string' && typeof value?.id === 'string' && new Date(value.expiresAt).getTime() > Date.now() ? value : null;
  } catch { return null; }
}
function rememberAdmin(value: AdminSession | null) {
  try {
    if (value) sessionStorage.setItem(adminStorageKey, JSON.stringify(value));
    else sessionStorage.removeItem(adminStorageKey);
  } catch { /* The session still works in memory. */ }
}
function LocationOptions({ savedId }: { savedId?: string | null }) {
  const savedTechnicalPoint = savedId && !locationLandmarks.some((node) => node.id === savedId);
  return <>
    <option value="">Alege un reper pe care îl recunoști</option>
    {savedTechnicalPoint && <option value={savedId} disabled>Punct salvat anterior — alege un reper apropiat</option>}
    {building.floors.map((floor) => <optgroup label={floor.name} key={floor.id}>{locationLandmarks.filter((node) => node.floor === floor.id).map((node) => <option value={node.id} key={node.id}>{node.label} · {floor.name}</option>)}</optgroup>)}
  </>;
}
function restore(): Credentials | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
    return typeof value?.id === 'string' && typeof value?.accessToken === 'string' ? value : null;
  } catch { return null; }
}
function remember(value: Credentials | null) {
  try {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
  } catch { /* The current tab still works when browser storage is disabled. */ }
}
async function api<T>(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch { throw new Error('Nu putem contacta serverul. Verifică conexiunea și încearcă din nou.'); }
  if (response.status === 204) return null as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) throw Object.assign(new Error('Acces refuzat. Verifică cheia de acces sau autentifică-te din nou.'), { status: 401 });
    if (response.status >= 500) throw new Error('Serverul nu este disponibil. Verifică dacă backend-ul este pornit.');
    throw new Error(data?.error?.message ?? 'Operația nu a reușit. Încearcă din nou.');
  }
  return data;
}

export default function QueuePanel({ profile, onNavigate, mode = 'visitor', visible = true, requesterLocationId, onLocateRequester, onOpenAdmin, onAdminChange }: {
  profile: AccessibilityProfile;
  onNavigate: (ticket: QueueTicket) => void;
  mode?: 'visitor' | 'staff';
  visible?: boolean;
  requesterLocationId: string;
  onLocateRequester: (locationId: string, profile: AccessibilityProfile) => void;
  onOpenAdmin: () => void;
  onAdminChange: (name: string) => void;
}) {
  const [services, setServices] = useState<QueueService[]>([]);
  const [now, setNow] = useState(Date.now);
  const [desks, setDesks] = useState<QueueDeskSummary[]>([]);
  const [selectedService, setSelectedService] = useState('');
  const serviceId = selectedService || services[0]?.id || '';
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(restore);
  const [ticket, setTicket] = useState<QueueTicket | null>(null);
  const deskIsOnPlan = Boolean(ticket?.desk && ticket.desk.buildingId === floorPlan.id &&
    floorPlan.floors.some((floor) => floor.level === ticket.desk?.floor) &&
    floorPlan.nodes.some((node) => node.id === ticket.desk?.locationId));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const [keyInput, setKeyInput] = useState('');
  const [admin, setAdmin] = useState<AdminSession | null>(restoreAdmin);
  const staffKey = admin?.accessToken ?? '';
  const [adminName, setAdminName] = useState('');
  const [inbox, setInbox] = useState<AdminTicket[]>([]);
  const [inboxFilter, setInboxFilter] = useState('open');
  const [inboxError, setInboxError] = useState('');
  const [adminLive, setAdminLive] = useState(false);
  const [notifications, setNotifications] = useState<AdminTicket[]>([]);
  const [helpSummary, setHelpSummary] = useState('');
  const [helpRequirements, setHelpRequirements] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const locationId = selectedLocation ?? ticket?.requesterLocationId ?? '';
  const locationConfirmed = locationLandmarks.some((node) => node.id === locationId);
  const suggestedLocation = locationLandmarks.find((node) => node.id === requesterLocationId);
  const [staffError, setStaffError] = useState('');
  const [staffMessage, setStaffMessage] = useState('');
  const [selectedDesk, setSelectedDesk] = useState('');
  const deskId = selectedDesk || desks[0]?.id || '';
  const desk = desks.find((item) => item.id === deskId);
  const [staffService, setStaffService] = useState('');
  const dispatchService = desk?.services.some((s) => s.id === staffService) ? staffService : desk?.services[0]?.id ?? '';
  const [staffTicket, setStaffTicket] = useState<QueueTicket | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffVerified, setStaffVerified] = useState('');
  const staffReady = Boolean(staffKey && staffVerified === `${staffKey}:${deskId}`);

  useEffect(() => { onAdminChange(admin?.name ?? ''); }, [admin, onAdminChange]);

  useEffect(() => {
    if (!admin) return;
    let live = true;
    let initialized = false;
    let version = 0;
    const known = new Set<string>();
    function announce(ticket: AdminTicket) {
      if (known.has(ticket.id)) return;
      known.add(ticket.id);
      if (live) setNotifications((items) => [ticket, ...items]);
    }
    async function refreshInbox() {
      const current = ++version;
      try {
        const rows = await api<AdminTicket[]>('/admin/tickets', { token: admin!.accessToken });
        if (!live || current !== version) return;
        if (initialized) rows.slice().reverse().forEach(announce);
        else { rows.forEach((ticket) => known.add(ticket.id)); initialized = true; }
        setInbox(rows); setInboxError(''); setNow(Date.now());
      } catch (cause) {
        if (!live) return;
        if ((cause as { status?: number }).status === 401) {
          rememberAdmin(null); setAdmin(null); setInbox([]); setNotifications([]); setStaffVerified('');
          setInboxError('Sesiunea de administrator a expirat. Autentifică-te din nou.');
        } else setInboxError((cause as Error).message);
      }
    }
    const socket = io({ auth: { adminToken: admin.accessToken } });
    socket.on('connect', () => { if (live) setAdminLive(true); void refreshInbox(); });
    socket.on('disconnect', () => { if (live) setAdminLive(false); });
    socket.on('connect_error', () => { if (live) setAdminLive(false); void refreshInbox(); });
    socket.on('ADMIN_TICKET_CREATED', (event: { ticket: AdminTicket }) => { announce(event.ticket); void refreshInbox(); });
    socket.on('ADMIN_TICKET_UPDATED', () => void refreshInbox());
    const timer = window.setInterval(refreshInbox, 5000);
    void refreshInbox();
    return () => { live = false; socket.disconnect(); window.clearInterval(timer); };
  }, [admin]);

  useEffect(() => {
    let live = true;
    let version = 0;
    async function refresh() {
      const current = ++version;
      try {
        const [catalogue, deskList, state, queue] = await Promise.all([
          api<QueueService[]>('/services'), api<QueueDeskSummary[]>('/desks'),
          credentials ? api<QueueTicket>(`/tickets/${encodeURIComponent(credentials.id)}`, { token: credentials.accessToken }) : null,
          serviceId ? api<QueueSummary>(`/queues/${encodeURIComponent(serviceId)}`) : null,
        ]);
        if (!live || current !== version) return;
        setServices(catalogue); setDesks(deskList.filter((desk) => desk.buildingId === floorPlan.id)); setTicket(state); setSummary(queue); setError(''); setNow(Date.now());
      } catch (cause) {
        if (live && current === version) {
          const message = (cause as Error).message;
          if (credentials && message.startsWith('Acces refuzat')) {
            remember(null);
            setCredentials(null);
            setTicket(null);
            setError('Tichetul salvat nu mai este valabil. Poți solicita unul nou.');
          } else {
            setError(message);
          }
        }
      } finally { if (live) setLoading(false); }
    }
    const socket = io();
    socket.on('connect', async () => {
      if (live) setConnected(true);
      try {
        const ack = await socket.timeout(5000).emitWithAck('subscribe', {
          ...(serviceId ? { serviceId } : {}),
          ...(credentials ? { ticketId: credentials.id, accessToken: credentials.accessToken } : {}),
        });
        if (live && !ack.ok) setConnected(false);
      } catch { if (live) setConnected(false); }
      await refresh();
    });
    socket.on('disconnect', () => { if (live) setConnected(false); });
    socket.on('TICKET_UPDATED', refresh);
    socket.on('QUEUE_POSITION_CHANGED', refresh);
    // Also recover state when an event is missed or the connection is unavailable.
    const timer = window.setInterval(refresh, 5000);
    void refresh();
    return () => { live = false; socket.disconnect(); window.clearInterval(timer); };
  }, [credentials, serviceId]);

  useEffect(() => {
    if (mode !== 'visitor' || !services.length) return;
    const selectRequestedService = (name: string) => {
      const requested = services.find((item) => normalizeText(item.name) === normalizeText(name));
      if (!requested) return false;
      setSelectedService(requested.id);
      try { sessionStorage.removeItem('smartqueue-pending-service'); } catch {}
      return true;
    };
    try {
      const pendingName = sessionStorage.getItem('smartqueue-pending-service');
      if (pendingName) selectRequestedService(pendingName);
    } catch { /* The user can still select a service manually. */ }
    const onServiceRequest = (event: Event) => {
      const name = (event as CustomEvent<{ name?: string }>).detail?.name;
      if (name) selectRequestedService(name);
    };
    window.addEventListener('smartqueue-service-request', onServiceRequest);
    return () => window.removeEventListener('smartqueue-service-request', onServiceRequest);
  }, [mode, services]);

  useEffect(() => {
    if (!staffKey || !deskId) return;
    let live = true;
    let version = 0;
    async function refreshStaff() {
      const current = ++version;
      try {
        const state = await api<QueueTicket | null>(`/desks/${encodeURIComponent(deskId)}/current-ticket`, { token: staffKey });
        if (!live || current !== version) return;
        setStaffTicket(state); setStaffVerified(`${staffKey}:${deskId}`); setStaffError('');
      } catch (cause) {
        if (live && current === version) { setStaffError((cause as Error).message); setStaffVerified(''); }
      }
    }
    void refreshStaff();
    const timer = window.setInterval(refreshStaff, 3000);
    return () => { live = false; window.clearInterval(timer); };
  }, [staffKey, deskId]);

  async function visitorAction(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError('');
    try { await action(); }
    catch (cause) { setError((cause as Error).message); }
    finally { lock.current = false; setPending(false); }
  }
  async function staffAction(path: string, body: unknown, method = 'POST') {
    if (lock.current || !staffReady) return;
    lock.current = true; setStaffLoading(true); setStaffError(''); setStaffMessage('');
    try {
      const state = await api<QueueTicket | null>(path, { method, body, token: staffKey });
      setStaffTicket(state && !terminal(state) ? state : null);
      setStaffMessage(state ? `Tichet ${state.number}: ${STATUS[state.status]}.` : 'Nu există tichete în așteptare pentru acest serviciu.');
      setDesks(await api<QueueDeskSummary[]>('/desks'));
    } catch (cause) { setStaffError((cause as Error).message); }
    finally { lock.current = false; setStaffLoading(false); }
  }

  async function loginAdmin(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setStaffLoading(true); setStaffError(''); setInboxError('');
    try {
      const session = await api<AdminSession>('/admin/session', { method: 'POST', token: keyInput.trim(), body: { name: adminName.trim() } });
      rememberAdmin(session); setAdmin(session); setKeyInput(''); setNotifications([]); setInbox([]);
    } catch (cause) { setStaffError((cause as Error).message); }
    finally { lock.current = false; setStaffLoading(false); }
  }
  async function logoutAdmin() {
    if (!admin || lock.current) return;
    lock.current = true; setStaffLoading(true);
    try {
      await api('/admin/session', { method: 'DELETE', token: admin.accessToken });
      rememberAdmin(null); setAdmin(null); setStaffVerified(''); setStaffTicket(null); setInbox([]); setNotifications([]); setStaffError(''); setStaffMessage('');
    } catch (cause) { setStaffError((cause as Error).message); }
    finally { lock.current = false; setStaffLoading(false); }
  }
  async function helpAction(id: string, action: 'claim' | 'release' | 'complete') {
    if (!admin || lock.current) return;
    lock.current = true; setStaffLoading(true); setInboxError('');
    try {
      await api(`/admin/tickets/${encodeURIComponent(id)}/${action}`, { method: 'POST', token: admin.accessToken });
    } catch (cause) { setInboxError((cause as Error).message); }
    finally {
      try { setInbox(await api<AdminTicket[]>('/admin/tickets', { token: admin.accessToken })); }
      catch (cause) { setInboxError((cause as Error).message); }
      lock.current = false; setStaffLoading(false);
    }
  }
  const ownerActive = (row: AdminTicket) => Boolean(row.claimedBy && !row.claimedBy.revokedAt && new Date(row.claimedBy.expiresAt).getTime() > now);
  const needsHelp = (row: AdminTicket) => !terminal(row) && !row.helpCompletedAt;
  const filteredInbox = inbox.filter((row) => inboxFilter === 'all' || (inboxFilter === 'mine' ? row.claimedById === admin?.id && needsHelp(row) : needsHelp(row)));

  return <>
    {admin && notifications.length > 0 && <aside className="ticket-admin-notification" aria-label="Notificări cereri de ajutor">
      <div role="status" aria-live="polite"><strong>{notifications.length} {notifications.length === 1 ? 'tichet nou' : 'tichete noi'}</strong><p>{notifications[0].number} · {notifications[0].helpSummary ?? 'Solicitare de serviciu'}</p><p>{notifications[0].requesterLocation ? `${notifications[0].requesterLocation.name} · ${notifications[0].requesterLocation.floorName}` : 'Locație nespecificată'}</p>{notifications[0].helpRequirements && <p>Nevoi: {notifications[0].helpRequirements}</p>}</div>
      <div className="button-row"><button className="primary" type="button" onClick={onOpenAdmin}>Vezi cererile</button><button className="text-button" type="button" onClick={() => setNotifications([])}>Marchează citite</button></div>
      {notifications.length > 1 && <details><summary>Toate notificările ({notifications.length})</summary>{notifications.map((row) => <p key={row.id}><strong>{row.number}</strong> · {row.helpSummary ?? 'Solicitare de serviciu'}<br />{row.requesterLocation?.name ?? 'Locație nespecificată'} · {row.requesterLocation?.floorName}<br />{row.helpRequirements || 'Fără cerințe suplimentare'}</p>)}</details>}
    </aside>}
    <section hidden={!visible} id={mode === 'visitor' ? 'queue' : 'staff-page'} className={`queue-section queue-page queue-page--${mode}`} aria-labelledby="queue-heading">
    {mode === 'visitor' && <>
    <div className="section-heading"><div><span className="eyebrow">SPRIJIN PENTRU VIZITATORI · AIRI</span><h2 id="queue-heading">{ticket && !terminal(ticket) ? 'Urmărește solicitarea' : 'Solicită sprijin'}</h2><p className="section-description">{ticket && !terminal(ticket) ? 'Păstrează pagina deschisă pentru actualizări despre tichet.' : 'Alege motivul solicitării. Nu trebuie să oferi date personale.'}</p></div>
      <span className={`connection ${connected ? 'online' : ''}`}>{connected ? 'Actualizare în timp real' : 'Actualizare periodică'}</span></div>
    {error && <p className="notice error" role="alert">{error} <button className="text-button" onClick={() => window.location.reload()}>Reîncarcă</button></p>}
    {ticket && terminal(ticket) ? <section className="ticket-finished" aria-live="polite">
      <span className="ticket-finished__mark" aria-hidden="true">✓</span><div><span className="eyebrow">TICHET {ticket.number}</span><h3>{ticket.status === 'COMPLETED' ? 'Servirea a fost finalizată' : ticket.status === 'CANCELLED' ? 'Tichetul a fost anulat' : 'Tichetul a fost închis'}</h3><p>{ticket.status === 'COMPLETED' ? 'Dacă mai ai nevoie de ajutor, poți solicita un tichet nou.' : 'Poți solicita un tichet nou când ești pregătit.'}</p></div><button className="primary" type="button" onClick={() => { remember(null); setCredentials(null); setTicket(null); setSelectedLocation(null); }}>Solicită alt tichet</button>
    </section> : credentials && loading && !ticket ? <div className="ticket-loading" role="status"><span className="ticket-placeholder" aria-hidden="true">…</span><p>Se verifică tichetul salvat…</p></div> : !ticket ? <div className="queue-grid">
      <div className="panel service-panel">
        <div className="service-panel__heading"><div><span className="eyebrow">PASUL 1</span><h3>Alege serviciul</h3></div><span className="service-panel__privacy">Fără date personale</span></div>
        {loading && !services.length ? <p className="muted">Se încarcă serviciile…</p> : services.length ? <div className="service-options" role="group" aria-label="Servicii disponibile">
          {services.map((service) => <button key={service.id} type="button" className={`service-option${serviceId === service.id ? ' selected' : ''}`} aria-pressed={serviceId === service.id} disabled={!service.active || pending} onClick={() => setSelectedService(service.id)}>
            <span className="service-option__mark" aria-hidden="true">{service.prefix}</span><span className="service-option__body"><strong>{service.name}</strong><small>{service.active ? `Durată medie: ${service.avgMinutes} min / persoană` : 'Momentan indisponibil'}</small></span><span className="service-option__radio" aria-hidden="true" />
          </button>)}
        </div> : <p className="muted">Nu sunt servicii disponibile momentan.</p>}
        {summary && <div className="queue-metrics"><div><strong>{summary.waitingCount}</strong><span>persoane în așteptare</span></div><div><strong>{summary.estimatedWaitMinutes === null ? '—' : `~${summary.estimatedWaitMinutes} min`}</strong><span>estimare orientativă</span></div></div>}
        <div className="ticket-help-form">
          <label htmlFor="help-summary">Cu ce ai nevoie de ajutor?</label>
          <input id="help-summary" value={helpSummary} onChange={(event) => setHelpSummary(event.target.value)} maxLength={160} placeholder="De exemplu: am nevoie de însoțire până la recepție" required disabled={pending} />
          <label htmlFor="help-requirements">Ce trebuie să știe persoana care te ajută? <span>(opțional)</span></label>
          <textarea id="help-requirements" value={helpRequirements} onChange={(event) => setHelpRequirements(event.target.value)} maxLength={1000} rows={3} placeholder="De exemplu: am nevoie de însoțire și de un traseu fără scări" disabled={pending} />
          <label htmlFor="help-location">Reperul lângă care mă aflu</label>
          <select id="help-location" aria-describedby="help-location-note" value={locationId} onChange={(event) => setSelectedLocation(event.target.value)} disabled={pending}><LocationOptions /></select>
          <p className="queue-note" id="help-location-note">Alege reperul pe care îl vezi lângă tine. Aplicația nu îți detectează poziția. Reperele provin din planul orientativ AIRI și trebuie confirmate la fața locului. Nu introduce date personale.</p>
          {!locationConfirmed && suggestedLocation && <div className="queue-note"><p>Punctul de plecare din planificator: <strong>{suggestedLocation.label}</strong>. Confirmă-l doar dacă ești acolo.</p><button type="button" className="secondary" disabled={pending} onClick={() => setSelectedLocation(suggestedLocation.id)}>Sunt lângă acest reper</button></div>}
        </div>
        <button className="primary request-ticket" disabled={loading || pending || Boolean(credentials) || helpSummary.trim().length < 5 || !locationConfirmed || !services.find((service) => service.id === serviceId)?.active}
          onClick={() => void visitorAction(async () => {
            const created = await api<CreatedQueueTicket>('/tickets', { method: 'POST', body: { serviceId, profile, helpSummary: helpSummary.trim(), helpRequirements: helpRequirements.trim(), requesterLocationId: locationId }, token: readAccountSession()?.accessToken });
            const saved = { id: created.id, accessToken: created.accessToken };
            remember(saved); setCredentials(saved); setTicket(created);
          })}>{pending ? 'Se creează tichetul…' : `Confirmă și ia tichet${services.length ? `ul ${services.find((service) => service.id === serviceId)?.prefix ?? ''}` : ''}`}</button>
      </div>
      <aside className="queue-howto"><span className="queue-howto__icon" aria-hidden="true">↗</span><span className="eyebrow">CUM FUNCȚIONEAZĂ</span><h3>Cere ajutor la locul unde ești</h3><ol><li>Descrie pe scurt ajutorul necesar și confirmă punctul de pe hartă.</li><li>Administratorii primesc cererea și unul dintre ei o poate prelua.</li><li>Vezi aici cine te ajută și urmărești în continuare rândul la ghișeu.</li></ol><p>Păstrează pagina deschisă și actualizează locul dacă te muți.</p></aside>
    </div> : <div className="ticket-tracking">
      <section className="ticket-panel ticket-panel--active" aria-live="polite" aria-atomic="true">
        <span className="ticket-panel__label">TICHETUL TĂU · {services.find((service) => service.id === ticket.serviceId)?.name}</span>
        <div className="ticket-number">{ticket.number}</div><span className={`ticket-status status-${ticket.status.toLowerCase()}`}>{STATUS[ticket.status]}</span>
        <div className="ticket-help-details">
          <h3>{ticket.helpSummary ?? 'Solicitarea ta'}</h3>
          {ticket.helpRequirements && <p><strong>Nevoi:</strong> {ticket.helpRequirements}</p>}
          <p><strong>Loc declarat:</strong> {ticket.requesterLocation ? `${ticket.requesterLocation.name} · ${ticket.requesterLocation.floorName}` : 'Nespecificat'}</p>
          <p role="status">{ticket.helpCompletedAt ? `Ajutor finalizat de ${ticket.claimedBy?.name ?? 'personal'}.` : ticket.claimedBy && !ticket.claimedBy.revokedAt && new Date(ticket.claimedBy.expiresAt).getTime() > now ? `${ticket.claimedBy.name} a preluat cererea și te va ajuta.` : 'Cererea de ajutor a fost trimisă administratorilor.'}</p>
          <label htmlFor="update-help-location">Reperul lângă care mă aflu acum</label><select id="update-help-location" value={locationId} onChange={(event) => setSelectedLocation(event.target.value)} disabled={pending}><LocationOptions savedId={ticket.requesterLocationId} /></select>
          <button className="secondary" type="button" disabled={pending || !locationConfirmed || ticket.requesterLocationId === locationId} onClick={() => void visitorAction(async () => {
            setTicket(await api<QueueTicket>(`/tickets/${encodeURIComponent(ticket.id)}/location`, { method: 'PATCH', token: credentials?.accessToken, body: { requesterLocationId: locationId } }));
          })}>Actualizează locul</button>
        </div>
        {ticket.status === 'WAITING' && <div className="ticket-position"><div><span>Poziția ta</span><strong>{ticket.positionInQueue ?? '—'}</strong></div><div><span>Înaintea ta</span><strong>{ticket.visitorsAhead}</strong></div><div><span>Timp estimat</span><strong>{ticket.estimatedWaitMinutes === null ? '—' : `~${ticket.estimatedWaitMinutes} min`}</strong></div></div>}
        {ticket.desk && ['CALLED', 'SERVING'].includes(ticket.status) && <div className="destination"><strong>{ticket.desk.name}</strong><span>{deskIsOnPlan ? (ticket.desk.floor === 0 ? 'Parter · punct marcat pe plan' : `Etaj ${ticket.desk.floor} · punct marcat pe plan`) : 'Punctul de întâlnire nu este marcat pe plan'}</span>{deskIsOnPlan && <button className="primary" onClick={() => onNavigate(ticket)}>Deschide planul parterului</button>}</div>}
        {ticket.status === 'WAITING' && <p className="ticket-live-note"><span aria-hidden="true" /> Cererea este înregistrată. Vei vedea aici când operatorul SmartQueue preia tichetul.</p>}
        {ticket.status === 'CALLED' && <p className="ticket-live-note ticket-live-note--called">Tichetul a fost preluat. Punctul echipei nu este încă marcat pe plan; cere operatorului indicații clare înainte să pornești.</p>}
        {ticket.status === 'SERVING' && <p className="ticket-live-note">Solicitarea ta este în curs. Dacă ai nevoie de ghidaj, cere operatorului indicații pas cu pas.</p>}
        {['WAITING', 'CALLED'].includes(ticket.status) && <button className="text-button ticket-cancel" disabled={pending} onClick={() => void visitorAction(async () => {
          setTicket(await api<QueueTicket>(`/tickets/${encodeURIComponent(ticket.id)}`, { method: 'DELETE', token: credentials?.accessToken }));
        })}>Anulează tichetul</button>}
      </section>
      <aside className="ticket-next-step"><span className="eyebrow">CE URMEAZĂ</span><h3>{ticket.status === 'WAITING' ? 'Cererea ta este înregistrată' : ticket.status === 'CALLED' ? 'Operatorul a preluat tichetul' : 'Solicitarea este în curs'}</h3><p>{ticket.status === 'WAITING' ? 'Urmărește numărul, poziția și estimarea orientativă aici. Când operatorul actualizează tichetul, vei vedea schimbarea pe ecran.' : deskIsOnPlan ? `Punctul ${ticket.desk?.name} este marcat pe planul parterului. Traseul afișat rămâne estimativ și trebuie confirmat pe teren.` : 'Locația punctului de sprijin nu este încă verificată și marcată pe planul AIRI. Cere operatorului locul exact și indicații pas cu pas; nu urma un traseu estimativ ca pe unul confirmat.'}</p>{ticket.status === 'CALLED' && deskIsOnPlan && <button className="secondary" onClick={() => onNavigate(ticket)}>Deschide planul parterului <span aria-hidden="true">→</span></button>}</aside>
    </div>}
    </>}
    {mode === 'staff' && <div className="dashboard-heading staff-heading"><div><span className="eyebrow">ZONĂ SECURIZATĂ · ADMINISTRATORI</span><h1 id="queue-heading">Cereri de ajutor</h1><p>Vezi nevoile și locul fiecărui vizitator, apoi preia cererea pe care o poți rezolva.</p></div><span className="staff-secure-badge">{admin ? `${admin.name} · ${adminLive ? 'notificări live' : 'actualizare periodică'}` : 'Acces personal'}</span></div>}
    {mode === 'staff' && inboxError && <p className="notice error" role="alert">{inboxError}</p>}
    {mode === 'staff' && admin && <section className="admin-help-inbox" aria-labelledby="admin-inbox-title">
      <div className="section-heading"><h2 id="admin-inbox-title">Tichetele vizitatorilor</h2><span>{inbox.filter(needsHelp).length} cereri active</span></div>
      <div className="button-row" role="group" aria-label="Filtrează cererile"><button className="secondary" aria-pressed={inboxFilter === 'open'} onClick={() => setInboxFilter('open')}>Active</button><button className="secondary" aria-pressed={inboxFilter === 'mine'} onClick={() => setInboxFilter('mine')}>Preluate de mine</button><button className="secondary" aria-pressed={inboxFilter === 'all'} onClick={() => setInboxFilter('all')}>Toate / istoric</button></div>
      {!filteredInbox.length && <p role="status">Nu există cereri în această categorie.</p>}
      <div className="admin-help-list">{filteredInbox.map((row) => <article className="admin-help-ticket" key={row.id} aria-label={`Cerere ${row.number}`}>
        <div className="admin-help-ticket__heading"><strong>{row.number} · {row.service?.name}</strong><span>{STATUS[row.status]}</span></div>
        <h3>{row.helpSummary ?? row.service?.name ?? 'Solicitare de serviciu'}</h3>
        <p className="ticket-requirements"><strong>Cerințe:</strong> {row.helpRequirements || 'Fără cerințe suplimentare'}</p>
        <p><strong>Loc declarat de vizitator:</strong> {row.requesterLocation ? `${row.requesterLocation.name} · ${row.requesterLocation.floorName} · ${row.requesterLocation.buildingName}` : 'Nespecificat pentru acest tichet'}</p>
        {row.requesterLocation && <p className="ticket-location-coordinates">Punct {row.requesterLocation.id} · x: {row.requesterLocation.x}, y: {row.requesterLocation.y}</p>}
        <p><strong>Ajutor:</strong> {row.helpCompletedAt ? `Finalizat de ${row.claimedBy?.name ?? 'personal'}` : row.claimedById && ownerActive(row) ? `Preluat de ${row.claimedBy?.name}` : terminal(row) ? 'Tichet închis' : 'Disponibil pentru preluare'}</p>
        <p className="ticket-created-at">Creat {new Date(row.createdAt).toLocaleString('ro-RO')}</p>
        <div className="button-row">
          {row.requesterLocation && <button className="secondary" onClick={() => onLocateRequester(row.requesterLocation!.id, row.profile)}>Vezi reperul pe hartă</button>}
          {needsHelp(row) && !ownerActive(row) && <button className="primary" disabled={staffLoading} onClick={() => void helpAction(row.id, 'claim')}>Preia cererea</button>}
          {!row.helpCompletedAt && row.claimedById === admin.id && <><button className="primary" disabled={staffLoading} onClick={() => void helpAction(row.id, 'complete')}>Ajutor finalizat</button><button className="secondary" disabled={staffLoading} onClick={() => void helpAction(row.id, 'release')}>Eliberează cererea</button></>}
        </div>
      </article>)}</div>
    </section>}
    <details id="staff-panel" className={`staff-panel${mode === 'staff' ? ' staff-panel--page' : ''}`} open={mode === 'staff'}><summary>Panou personal · administrare ghișeu</summary>
      {!admin ? <form className="staff-login" onSubmit={(event) => void loginAdmin(event)}>
        <label htmlFor="admin-name">Numele afișat vizitatorilor</label><input id="admin-name" autoComplete="name" value={adminName} onChange={(event) => setAdminName(event.target.value)} required maxLength={120} />
        <label htmlFor="staff-key">Cheie de acces personal</label><input id="staff-key" type="password" autoComplete="off" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Cheia STAFF_API_KEY din .env" required />
        <button type="submit" className="secondary" disabled={staffLoading}>{staffLoading ? 'Se verifică…' : 'Conectare administrator'}</button>
      </form> : <div className="staff-login"><strong>Autentificat: {admin.name}</strong><p>Notificările pentru toate tichetele rămân active inclusiv pe hartă. La deconectare, cererile neterminate devin disponibile altor administratori.</p><button type="button" className="text-button" disabled={staffLoading} onClick={() => void logoutAdmin()}>Deconectare</button></div>}
      {staffError && <p className="notice error" role="alert">{staffError}</p>}
      {admin && <div className="staff-controls"><label>Ghișeu<select value={deskId} onChange={(e) => { setSelectedDesk(e.target.value); setStaffMessage(''); }} disabled={staffLoading}>
        {!desks.length && <option value="">Niciun ghișeu disponibil</option>}
        {desks.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.status === 'OPEN' ? 'deschis' : d.status === 'PAUSED' ? 'pauză' : 'închis'}</option>)}
      </select></label><label>Serviciu<select value={dispatchService} onChange={(e) => setStaffService(e.target.value)} disabled={staffLoading}>
        {desk?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label></div>}
      {staffKey && !staffReady && !staffError && <p role="status">Se verifică accesul…</p>}
      {staffReady && <>
        <p role="status">{staffMessage || (staffTicket ? `Tichet curent: ${staffTicket.number} · ${STATUS[staffTicket.status]}` : 'Nu există un tichet preluat momentan.')}</p>
        <div className="button-row"><button className="primary" disabled={staffLoading || pending || Boolean(staffTicket) || desk?.status !== 'OPEN' || !dispatchService}
          onClick={() => void staffAction(`/desks/${encodeURIComponent(deskId)}/call-next`, { serviceId: dispatchService })}>Cheamă următorul tichet</button>
          {staffTicket?.status === 'CALLED' && <><button className="secondary" disabled={staffLoading} onClick={() => void staffAction(`/tickets/${staffTicket.id}/status`, { status: 'SERVING' }, 'PATCH')}>Începe servirea</button><button className="secondary" disabled={staffLoading} onClick={() => void staffAction(`/tickets/${staffTicket.id}/status`, { status: 'MISSED' }, 'PATCH')}>Marchează neprezentat</button></>}
          {staffTicket?.status === 'SERVING' && <button className="secondary" disabled={staffLoading} onClick={() => void staffAction(`/tickets/${staffTicket.id}/status`, { status: 'COMPLETED' }, 'PATCH')}>Finalizează servirea</button>}
        </div>
      </>}
    </details>
  </section></>;
}
