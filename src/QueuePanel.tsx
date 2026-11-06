import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { AccessibilityProfile, CreatedQueueTicket, QueueDeskSummary, QueueService, QueueSummary, QueueTicket, QueueTicketStatus } from './types';

const STATUS: Record<QueueTicketStatus, string> = {
  WAITING: 'În așteptare', CALLED: 'Ești chemat la ghișeu', SERVING: 'În curs de servire',
  COMPLETED: 'Finalizat', CANCELLED: 'Anulat', MISSED: 'Neprezentat',
};
const terminal = (ticket: QueueTicket) => ['COMPLETED', 'CANCELLED', 'MISSED'].includes(ticket.status);
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

export default function QueuePanel({ profile, onNavigate }: {
  profile: AccessibilityProfile;
  onNavigate: (ticket: QueueTicket) => void;
}) {
  const [services, setServices] = useState<QueueService[]>([]);
  const [desks, setDesks] = useState<QueueDeskSummary[]>([]);
  const [selectedService, setSelectedService] = useState('');
  const serviceId = selectedService || services[0]?.id || '';
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(restore);
  const [ticket, setTicket] = useState<QueueTicket | null>(null);
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
        setServices(catalogue); setDesks(deskList); setTicket(state); setSummary(queue); setError('');
      } catch (cause) {
        if (live && current === version) setError((cause as Error).message);
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

  return <section className="queue-section" aria-labelledby="queue-heading">
    <div className="section-heading"><div><span className="eyebrow">Fără tichet de hârtie</span><h2 id="queue-heading">Locul tău la rând</h2></div>
      <span className={`connection ${connected ? 'online' : ''}`}>{connected ? 'Actualizare în timp real' : 'Actualizare periodică'}</span></div>
    {error && <p className="notice error" role="alert">{error} <button className="text-button" onClick={() => window.location.reload()}>Reîncarcă</button></p>}
    <div className="queue-grid">
      <div className="panel">
        <h3>Alege serviciul</h3>
        <label htmlFor="queue-service">Serviciu</label>
        <select id="queue-service" value={serviceId} onChange={(e) => setSelectedService(e.target.value)} disabled={loading || pending}>
          {!services.length && <option value="">{loading ? 'Se încarcă…' : 'Niciun serviciu disponibil'}</option>}
          {services.map((service) => <option key={service.id} value={service.id}>{service.name}{!service.active ? ' — închis' : ''}</option>)}
        </select>
        {summary && <div className="queue-metrics"><div><strong>{summary.waitingCount}</strong><span>persoane în așteptare</span></div><div><strong>{summary.estimatedWaitMinutes === null ? '—' : `~${summary.estimatedWaitMinutes} min`}</strong><span>așteptare estimată</span></div></div>}
        {summary?.estimatedWaitMinutes === null && <p className="muted">Estimarea nu este disponibilă momentan.</p>}
        <p className="muted">Tichetul folosește profilul de accesibilitate ales mai sus. Timpul de așteptare este aproximativ.</p>
        <button className="primary" disabled={loading || pending || Boolean(credentials) || !services.find((s) => s.id === serviceId)?.active}
          onClick={() => void visitorAction(async () => {
            const created = await api<CreatedQueueTicket>('/tickets', { method: 'POST', body: { serviceId, profile } });
            const saved = { id: created.id, accessToken: created.accessToken };
            remember(saved); setCredentials(saved); setTicket(created);
          })}>{pending ? 'Se procesează…' : 'Ia un tichet'}</button>
      </div>
      <div className="panel ticket-panel" aria-live="polite" aria-atomic="true">
        {ticket ? <>
          <span className="eyebrow">Tichetul tău · {services.find((s) => s.id === ticket.serviceId)?.name}</span>
          <div className="ticket-number">{ticket.number}</div><span className={`ticket-status status-${ticket.status.toLowerCase()}`}>{STATUS[ticket.status]}</span>
          {ticket.status === 'WAITING' && <p>Poziția <strong>{ticket.positionInQueue}</strong> · {ticket.visitorsAhead} persoane înaintea ta<br />{ticket.estimatedWaitMinutes === null ? 'Estimare indisponibilă' : `Așteptare aproximativă: ${ticket.estimatedWaitMinutes} min`}</p>}
          {ticket.desk && ['CALLED', 'SERVING'].includes(ticket.status) && <div className="destination"><strong>{ticket.desk.name}</strong><span>{ticket.desk.floor === 0 ? 'Parter' : `Etaj ${ticket.desk.floor}`}</span><button className="primary" onClick={() => onNavigate(ticket)}>Arată traseul către ghișeu</button></div>}
          {['WAITING', 'CALLED'].includes(ticket.status) && <button className="secondary" disabled={pending} onClick={() => void visitorAction(async () => {
            setTicket(await api<QueueTicket>(`/tickets/${encodeURIComponent(ticket.id)}`, { method: 'DELETE', token: credentials?.accessToken }));
          })}>Anulează tichetul</button>}
          {terminal(ticket) && <button className="secondary" onClick={() => { remember(null); setCredentials(null); setTicket(null); }}>Alege un tichet nou</button>}
        </> : <><span className="ticket-placeholder" aria-hidden="true">№</span><h3>{credentials ? 'Se recuperează tichetul…' : 'Tichetul tău apare aici'}</h3><p className="muted">{credentials ? 'Păstrează această pagină deschisă.' : 'Alege un serviciu și apasă „Ia un tichet”. Păstrează această pagină deschisă pentru actualizări.'}</p></>}
      </div>
    </div>
    <details className="staff-panel"><summary>Panou personal · administrare ghișeu</summary>
      <form className="staff-login" onSubmit={(event) => { event.preventDefault(); setStaffKey(keyInput.trim()); setKeyInput(''); setStaffMessage(''); }}>
        <label htmlFor="staff-key">Cheie de acces personal</label><input id="staff-key" type="password" autoComplete="off" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Cheia STAFF_API_KEY din .env" required />
        <button type="submit" className="secondary">Conectare</button>
        {staffKey && <button type="button" className="text-button" onClick={() => { setStaffKey(''); setStaffVerified(''); setStaffTicket(null); setStaffError(''); setStaffMessage(''); }}>Deconectare</button>}
      </form>
      {staffError && <p className="notice error" role="alert">{staffError}</p>}
      <div className="staff-controls"><label>Ghișeu<select value={deskId} onChange={(e) => { setSelectedDesk(e.target.value); setStaffMessage(''); }} disabled={staffLoading}>
        {!desks.length && <option value="">Niciun ghișeu disponibil</option>}
        {desks.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.status === 'OPEN' ? 'deschis' : d.status === 'PAUSED' ? 'pauză' : 'închis'}</option>)}
      </select></label><label>Serviciu<select value={dispatchService} onChange={(e) => setStaffService(e.target.value)} disabled={staffLoading}>
        {desk?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label></div>
      {staffKey && !staffReady && !staffError && <p role="status">Se verifică accesul…</p>}
      {staffReady && <>
        <p role="status">{staffMessage || (staffTicket ? `Tichet curent: ${staffTicket.number} · ${STATUS[staffTicket.status]}` : 'Ghișeu liber.')}</p>
        <div className="button-row"><button className="primary" disabled={staffLoading || pending || Boolean(staffTicket) || desk?.status !== 'OPEN' || !dispatchService}
          onClick={() => void staffAction(`/desks/${encodeURIComponent(deskId)}/call-next`, { serviceId: dispatchService })}>Cheamă următorul tichet</button>
          {staffTicket?.status === 'CALLED' && <><button className="secondary" disabled={staffLoading} onClick={() => void staffAction(`/tickets/${staffTicket.id}/status`, { status: 'SERVING' }, 'PATCH')}>Începe servirea</button><button className="secondary" disabled={staffLoading} onClick={() => void staffAction(`/tickets/${staffTicket.id}/status`, { status: 'MISSED' }, 'PATCH')}>Marchează neprezentat</button></>}
          {staffTicket?.status === 'SERVING' && <button className="secondary" disabled={staffLoading} onClick={() => void staffAction(`/tickets/${staffTicket.id}/status`, { status: 'COMPLETED' }, 'PATCH')}>Finalizează servirea</button>}
        </div>
      </>}
    </details>
  </section>;
}
