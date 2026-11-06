import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');
export function equalSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string'
    && timingSafeEqual(Buffer.from(hashToken(a)), Buffer.from(hashToken(b)));
}

const transitions = {
  WAITING: ['CANCELLED'],
  CALLED: ['SERVING', 'MISSED', 'CANCELLED'],
  SERVING: ['COMPLETED'],
  COMPLETED: [], CANCELLED: [], MISSED: [],
};
export function assertTransition(from, to) {
  if (!transitions[from]?.includes(to)) fail(409, `Cannot change ${from} to ${to}.`);
}

export const activeStatuses = ['CALLED', 'SERVING'];

export function publicTicket(ticket) {
  const { tokenHash, ...safe } = ticket;
  void tokenHash;
  return safe;
}
