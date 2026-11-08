import { equalSecret, fail, hashToken } from './domain.js';

export const bearer = (req) => req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];

export function createAuth(service, staffKey) {
  const isStaff = (token) => equalSecret(token, staffKey);
  return {
    isStaff,
    staff(req, res, next) {
      if (!isStaff(bearer(req))) fail(401, 'Staff authorization required.');
      next();
    },
    async ticket(req, res, next) {
      if (!isStaff(bearer(req))) {
        const ticket = await service.findTicket(req.params.id);
        if (!ticket || !equalSecret(ticket.tokenHash, hashToken(bearer(req) ?? ''))) {
          fail(401, 'Valid ticket token required.');
        }
      }
      next();
    },
  };
}
