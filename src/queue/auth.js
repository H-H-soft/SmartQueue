import { equalSecret, fail, hashToken } from './domain.js';

export const bearer = (req) => req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];

export function createAuth(service, staffKey) {
  const isStaff = (token) => equalSecret(token, staffKey);
  async function loadAccount(req, token) {
    const tokenHash = hashToken(token);
    const session = await service.findAccountSession(tokenHash);
    if (!session || session.expiresAt <= new Date()) {
      if (session) await service.deleteAccountSession(tokenHash);
      fail(401, 'Valid account session required.');
    }
    req.account = session.account;
    req.accountTokenHash = tokenHash;
  }
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
    async account(req, res, next) {
      try {
        const token = bearer(req);
        if (!token) fail(401, 'Valid account session required.');
        await loadAccount(req, token);
        next();
      } catch (error) { next(error); }
    },
    async optionalAccount(req, res, next) {
      try {
        const token = bearer(req);
        if (token) await loadAccount(req, token);
        next();
      } catch (error) { next(error); }
    },
  };
}
