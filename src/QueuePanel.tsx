import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { readAccountSession } from './account';
import airiGroundFloor from './data/airi-ground-floor.json';
import type { AccessibilityProfile, CreatedQueueTicket, QueueDeskSummary, QueueService, QueueSummary, QueueTicket, QueueTicketStatus } from './types';

const STATUS: Record<QueueTicketStatus, string> = {
  WAITING: 'În așteptare', CALLED: 'Ești chemat la ghișeu', SERVING: 'În curs de servire',
  COMPLETED: 'Finalizat', CANCELLED: 'Anulat', MISSED: 'Neprezentat',
};
const terminal = (ticket: QueueTicket) => ['COMPLETED', 'CANCELLED', 'MISSED'].includes(ticket.status);
const floorPlan = airiGroundFloor;
const normalizeText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('ro-RO').trim();
type Credentials = { id: string; accessToken: string };
const storageKey = 'smartqueue.ticket';
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
    if (response.status === 401) throw new Error('Acces refuzat. Verifică cheia de acces sau tichetul salvat.');
    if (response.status >= 500) throw new Error('Serverul nu este disponibil. Verifică dacă backend-ul este pornit.');
    throw new Error(data?.error?.message ?? 'Operația nu a reușit. Încearcă din nou.');
  }
  return data;
}

export default function QueuePanel({ profile, onNavigate, mode = 'visitor' }: {
  profile: AccessibilityProfile;
  onNavigate: (ticket: QueueTicket) => void;
  mode?: 'visitor' | 'staff';
}) {
  const [services, setServices] = useState<QueueService[]>([]);
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
  const [staffKey, setStaffKey] = useState('');
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
        setServices(catalogue); setDesks(deskList.filter((desk) => desk.buildingId === floorPlan.id)); setTicket(state); setSummary(queue); setError('');
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

  return <section id={mode === 'visitor' ? 'queue' : 'staff-page'} className={`queue-section queue-page queue-page--${mode}`} aria-labelledby="queue-heading">
    {mode === 'visitor' && <>
    <div className="section-heading"><div><span className="eyebrow">SPRIJIN PENTRU VIZITATORI · AIRI</span><h2 id="queue-heading">{ticket && !terminal(ticket) ? 'Urmărește solicitarea' : 'Solicită sprijin'}</h2><p className="section-description">{ticket && !terminal(ticket) ? 'Păstrează pagina deschisă pentru actualizări despre tichet.' : 'Alege motivul solicitării. Nu trebuie să oferi date personale.'}</p></div>
      <span className={`connection ${connected ? 'online' : ''}`}>{connected ? 'Actualizare în timp real' : 'Actualizare periodică'}</span></div>
    {error && <p className="notice error" role="alert">{error} <button className="text-button" onClick={() => window.location.reload()}>Reîncarcă</button></p>}
    {ticket && terminal(ticket) ? <section className="ticket-finished" aria-live="polite">
      <span className="ticket-finished__mark" aria-hidden="true">✓</span><div><span className="eyebrow">TICHET {ticket.number}</span><h3>{ticket.status === 'COMPLETED' ? 'Servirea a fost finalizată' : ticket.status === 'CANCELLED' ? 'Tichetul a fost anulat' : 'Tichetul a fost închis'}</h3><p>{ticket.status === 'COMPLETED' ? 'Dacă mai ai nevoie de ajutor, poți solicita un tichet nou.' : 'Poți solicita un tichet nou când ești pregătit.'}</p></div><button className="primary" type="button" onClick={() => { remember(null); setCredentials(null); setTicket(null); }}>Solicită alt tichet</button>
    </section> : credentials && loading && !ticket ? <div className="ticket-loading" role="status"><span className="ticket-placeholder" aria-hidden="true">…</span><p>Se verifică tichetul salvat…</p></div> : !ticket ? <div className="queue-grid">
      <div className="panel service-panel">
        <div className="service-panel__heading"><div><span className="eyebrow">PASUL 1</span><h3>Alege serviciul</h3></div><span className="service-panel__privacy">Fără date personale</span></div>
        {loading && !services.length ? <p className="muted">Se încarcă serviciile…</p> : services.length ? <div className="service-options" role="group" aria-label="Servicii disponibile">
          {services.map((service) => <button key={service.id} type="button" className={`service-option${serviceId === service.id ? ' selected' : ''}`} aria-pressed={serviceId === service.id} disabled={!service.active || pending} onClick={() => setSelectedService(service.id)}>
            <span className="service-option__mark" aria-hidden="true">{service.prefix}</span><span className="service-option__body"><strong>{service.name}</strong><small>{service.active ? `Durată medie: ${service.avgMinutes} min / persoană` : 'Momentan indisponibil'}</small></span><span className="service-option__radio" aria-hidden="true" />
          </button>)}
        </div> : <p className="muted">Nu sunt servicii disponibile momentan.</p>}
        {summary && <div className="queue-metrics"><div><strong>{summary.waitingCount}</strong><span>persoane în așteptare</span></div><div><strong>{summary.estimatedWaitMinutes === null ? '—' : `~${summary.estimatedWaitMinutes} min`}</strong><span>estimare orientativă</span></div></div>}
        <p className="queue-note">Estimarea se poate schimba în funcție de ritmul de lucru la ghișee. Profilul de accesibilitate ales va fi folosit pentru traseu.</p>
        <button className="primary request-ticket" disabled={loading || pending || Boolean(credentials) || !services.find((service) => service.id === serviceId)?.active}
          onClick={() => void visitorAction(async () => {
            const created = await api<CreatedQueueTicket>('/tickets', { method: 'POST', body: { serviceId, profile }, token: readAccountSession()?.accessToken });
            const saved = { id: created.id, accessToken: created.accessToken };
            remember(saved); setCredentials(saved); setTicket(created);
          })}>{pending ? 'Se creează tichetul…' : `Confirmă și ia tichet${services.length ? `ul ${services.find((service) => service.id === serviceId)?.prefix ?? ''}` : ''}`}</button>
      </div>
      <aside className="queue-howto"><span className="queue-howto__icon" aria-hidden="true">↗</span><span className="eyebrow">CUM FUNCȚIONEAZĂ</span><h3>Solicitarea ta ajunge în coada SmartQueue</h3><ol><li>Alegi „Ajutor pentru orientare” sau trimiți o întrebare despre vizită.</li><li>Primești un număr și urmărești poziția pe acest dispozitiv.</li><li>Când operatorul preia tichetul, verifici aici indicațiile lui.</li></ol><p>Punctul echipei nu este încă marcat pe planul parterului AIRI. Aplicația nu va inventa un traseu până acolo.</p></aside>
    </div> : <div className="ticket-tracking">
      <section className="ticket-panel ticket-panel--active" aria-live="polite" aria-atomic="true">
        <span className="ticket-panel__label">TICHETUL TĂU · {services.find((service) => service.id === ticket.serviceId)?.name}</span>
        <div className="ticket-number">{ticket.number}</div><span className={`ticket-status status-${ticket.status.toLowerCase()}`}>{STATUS[ticket.status]}</span>
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
    {mode === 'staff' && <div className="dashboard-heading staff-heading"><div><span className="eyebrow">ZONĂ SECURIZATĂ · PERSONAL</span><h1 id="queue-heading">Administrare solicitări AIRI</h1><p>Autentifică-te pentru a prelua și gestiona cererile vizitatorilor.</p></div><span className="staff-secure-badge">♙ Acces personal</span></div>}
    <details id="staff-panel" className={`staff-panel${mode === 'staff' ? ' staff-panel--page' : ''}`} open={mode === 'staff'}><summary>Panou operator · coada de sprijin</summary>
      <form className="staff-login" onSubmit={(event) => { event.preventDefault(); setStaffKey(keyInput.trim()); setKeyInput(''); setStaffMessage(''); }}>
        <label htmlFor="staff-key">Cheie de acces personal</label><input id="staff-key" type="password" autoComplete="off" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Cheia STAFF_API_KEY din .env" required />
        <button type="submit" className="secondary">Conectare</button>
        {staffKey && <button type="button" className="text-button" onClick={() => { setStaffKey(''); setStaffVerified(''); setStaffTicket(null); setStaffError(''); setStaffMessage(''); }}>Deconectare</button>}
      </form>
      {staffError && <p className="notice error" role="alert">{staffError}</p>}
      <div className="staff-controls"><label>Echipă de sprijin<select value={deskId} onChange={(e) => { setSelectedDesk(e.target.value); setStaffMessage(''); }} disabled={staffLoading}>
        {!desks.length && <option value="">Nicio echipă disponibilă</option>}
        {desks.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.status === 'OPEN' ? 'deschis' : d.status === 'PAUSED' ? 'pauză' : 'închis'}</option>)}
      </select></label><label>Serviciu<select value={dispatchService} onChange={(e) => setStaffService(e.target.value)} disabled={staffLoading}>
        {desk?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label></div>
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
  </section>;
}
