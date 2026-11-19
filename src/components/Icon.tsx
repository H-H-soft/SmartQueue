import type { ReactNode } from 'react';

type IconName = 'home' | 'ticket' | 'map' | 'staff' | 'accessibility' | 'plus' | 'qr' | 'arrow' | 'route' | 'info';

const paths: Record<IconName, ReactNode> = {
  home: <><path d="m3.5 10 8.5-7 8.5 7" /><path d="M5.5 9v11h13V9M9 20v-6h6v6" /></>,
  ticket: <><path d="M4 5.5h16v4a2.5 2.5 0 0 0 0 5v4H4v-4a2.5 2.5 0 0 0 0-5z" /><path d="M12 8v1m0 3v1m0 3v1" /></>,
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15m6-12v15" /></>,
  staff: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-1.5a7 7 0 0 1 14 0V21z" /></>,
  accessibility: <><circle cx="12" cy="4" r="1.5" /><path d="M5 8h5l2 4h5m-9-4-1 5 4 2 2 5m-5-7-3 5m7-7 3 7h3" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  qr: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2v2h-2zm4 0h2m-6 4h2m2 0h2v2h-2z" /></>,
  arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
  route: <><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h2a4 4 0 0 0 4-4v-4a4 4 0 0 1 4-4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></>,
};

export default function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
