import { useState, type FormEvent } from 'react';
import type { AccountSummary, AccountTicketSummary } from './account';
import type { AccessibilityProfile } from './types';
import Icon from './components/Icon';

const statusLabel: Record<AccountTicketSummary['status'], string> = {
  WAITING: 'În așteptare', CALLED: 'Chemați', SERVING: 'În curs',
  COMPLETED: 'Finalizat', CANCELLED: 'Anulat', MISSED: 'Închis',
};
const profileLabel: Record<AccessibilityProfile, string> = {
  standard: 'Standard', wheelchair: 'Scaun cu rotile', visual: 'Deficiență de vedere', reduced: 'Mobilitate redusă',
};

export default function AccountPage({
  account, tickets, loadingTickets, busy, error, onAuthenticate, onLogout, goToAccessibility,
}: {
  account: AccountSummary | null;
  tickets: AccountTicketSummary[];
  loadingTickets: boolean;
  busy: boolean;
  error: string;
  onAuthenticate: (email: string, password: string, mode: 'login' | 'register') => Promise<boolean>;
  onLogout: () => void;
  goToAccessibility: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (account) return (
    <section className="account-page" aria-labelledby="page-heading">
      <div className="dashboard-heading">
        <div><span className="eyebrow">SMARTQUEUE · CONT PERSONAL</span><h1 id="page-heading" tabIndex={-1}>Contul meu</h1><p>Preferințele și istoricul vizitelor tale.</p></div>
      </div>
      <section className="account-summary-card">
        <span className="account-avatar" aria-hidden="true">{account.email.slice(0, 1).toUpperCase()}</span>
        <div className="account-summary-card__identity"><span className="eyebrow">CONECTAT</span><strong>{account.email}</strong><small>Cont creat la {new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium' }).format(new Date(account.createdAt))}</small></div>
        <button className="secondary account-summary-card__edit" type="button" onClick={goToAccessibility}><Icon name="accessibility" size={17} /> Preferințe de acces</button>
        <button className="text-button account-summary-card__logout" type="button" onClick={onLogout}>Deconectare</button>
      </section>
      <section className="account-preferences-card" aria-label="Preferințe salvate">
        <div><span className="eyebrow">PREFERINȚE SALVATE</span><strong>{profileLabel[account.profile]}</strong><small>{[account.highContrast && 'Contrast ridicat', account.largeText && 'Text mărit'].filter(Boolean).join(' · ') || 'Afișare standard'}</small></div>
        <Icon name="accessibility" size={21} />
      </section>
      <section className="account-history" aria-labelledby="history-heading">
        <div className="account-history__heading"><div><span className="eyebrow">ACTIVITATE</span><h2 id="history-heading">Tichetele mele</h2></div><span>{tickets.length ? `${tickets.length} recente` : 'Istoric personal'}</span></div>
        {loadingTickets ? <p className="account-empty" role="status">Se încarcă istoricul…</p> : tickets.length ? <div className="account-ticket-list">{tickets.map((ticket) => <article className="account-ticket-row" key={ticket.id}>
          <span className="account-ticket-row__number">{ticket.number}</span><span className="account-ticket-row__service"><strong>{ticket.service.name}</strong><small>{new Intl.DateTimeFormat('ro-RO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ticket.createdAt))}{ticket.desk ? ` · ${ticket.desk.name}` : ''}</small></span><span className={`account-ticket-status account-ticket-status--${ticket.status.toLowerCase()}`}>{statusLabel[ticket.status]}</span>
        </article>)}</div> : <div className="account-empty"><span className="account-empty__icon"><Icon name="ticket" size={22} /></span><strong>Nu ai încă tichete</strong><p>Tichetele solicitate după conectare vor apărea aici.</p></div>}
      </section>
    </section>
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await onAuthenticate(email.trim(), password, mode)) setPassword('');
  }

  return (
    <section className="account-page account-page--auth" aria-labelledby="page-heading">
      <div className="dashboard-heading"><div><span className="eyebrow">SMARTQUEUE · CONT PERSONAL</span><h1 id="page-heading" tabIndex={-1}>{mode === 'login' ? 'Conectare' : 'Creează un cont'}</h1><p>{mode === 'login' ? 'Accesează tichetele și preferințele salvate.' : 'Salvează preferințele și păstrează istoricul tichetelor.'}</p></div></div>
      <div className="account-auth-layout">
        <section className="account-auth-card">
          <div className="account-auth-tabs" role="group" aria-label="Tipul de acces">
            <button type="button" aria-pressed={mode === 'login'} className={mode === 'login' ? 'selected' : ''} onClick={() => setMode('login')}>Conectare</button>
            <button type="button" aria-pressed={mode === 'register'} className={mode === 'register' ? 'selected' : ''} onClick={() => setMode('register')}>Cont nou</button>
          </div>
          <form className="account-auth-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="account-email">Adresă de e-mail</label><input id="account-email" type="email" autoComplete="email" required maxLength={254} disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nume@exemplu.ro" />
            <label htmlFor="account-password">Parolă</label><input id="account-password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 10 : 1} maxLength={128} disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'register' ? 'Cel puțin 10 caractere' : 'Introdu parola'} />
            {error && <p className="notice error" role="alert">{error}</p>}
            <button type="submit" className="primary account-auth-submit" disabled={busy}>{busy ? 'Se procesează…' : mode === 'login' ? 'Conectează-te' : 'Creează contul'}</button>
          </form>
          <p className="account-auth-privacy"><Icon name="info" size={17} /> Parola este păstrată sub formă criptografică. Preferințele și istoricul tichetelor sunt asociate contului tău.</p>
        </section>
        <aside className="account-benefits"><span className="eyebrow">CU UN CONT SMARTQUEUE</span><h2>Continui de unde ai rămas</h2><ul><li><span>01</span><div><strong>Preferințe salvate</strong><small>Profilul de accesibilitate, contrastul și mărimea textului.</small></div></li><li><span>02</span><div><strong>Istoricul tichetelor</strong><small>Revii la detaliile vizitelor tale de pe acest dispozitiv.</small></div></li></ul><p>Poți folosi în continuare aplicația fără cont. Tichetele noi vor fi legate de cont doar când ești conectat.</p></aside>
      </div>
    </section>
  );
}
