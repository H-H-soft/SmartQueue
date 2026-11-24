import type { AccessibilityProfile } from './types';

export interface AccountSummary {
  id: string;
  email: string;
  profile: AccessibilityProfile;
  highContrast: boolean;
  largeText: boolean;
  createdAt: string;
}

export interface AccountTicketSummary {
  id: string;
  number: string;
  status: 'WAITING' | 'CALLED' | 'SERVING' | 'COMPLETED' | 'CANCELLED' | 'MISSED';
  profile: AccessibilityProfile;
  createdAt: string;
  service: { name: string };
  desk: { name: string; floor: number } | null;
}

const KEY = 'smartqueue.account';
export function readAccountSession(): { accessToken: string; account: AccountSummary } | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return typeof value?.accessToken === 'string' && typeof value?.account?.email === 'string' ? value : null;
  } catch { return null; }
}
export function saveAccountSession(accessToken: string, account: AccountSummary) {
  localStorage.setItem(KEY, JSON.stringify({ accessToken, account }));
}
export function clearAccountSession() { localStorage.removeItem(KEY); }

