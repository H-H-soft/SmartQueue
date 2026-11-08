import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { schemas, validate } from './validation.js';
import { fail } from './domain.js';

export function apiRoutes(service, auth, notify) {
  const api = Router();
  const created = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  api.get('/services', async (req, res) => res.json(await service.listServices()));
  api.post('/services', auth.staff, validate(schemas.service), async (req, res) => {
    res.status(201).json(await service.createService(req.body));
  });
  api.patch('/services/:id', auth.staff, validate(schemas.serviceUpdate), async (req, res) => {
    const result = await service.updateService(req.params.id, req.body);
    await notify('queueChanged', req.params.id);
    res.json(result);
  });
  api.post('/tickets', created, validate(schemas.ticket), async (req, res) => {
    const ticket = await service.createTicket(req.body);
    await notify('publish', 'TICKET_CREATED', ticket);
    res.status(201).json({ ...await service.ticketState(ticket.id), accessToken: ticket.accessToken });
  });
  api.get('/tickets/:id', auth.ticket, async (req, res) => res.json(await service.ticketState(req.params.id)));
  api.delete('/tickets/:id', auth.ticket, async (req, res) => {
    const ticket = await service.changeStatus(req.params.id, 'CANCELLED');
    await notify('publish', 'TICKET_CANCELLED', ticket);
    res.json(await service.ticketState(ticket.id));
  });
  api.patch('/tickets/:id/status', auth.staff, validate(schemas.status), async (req, res) => {
    const ticket = await service.changeStatus(req.params.id, req.body.status);
    const events = { SERVING: 'TICKET_SERVING', COMPLETED: 'TICKET_COMPLETED', MISSED: 'TICKET_MISSED' };
    await notify('publish', events[ticket.status], ticket);
    res.json(await service.ticketState(ticket.id));
  });
  api.post('/tickets/:id/reassign', auth.staff, validate(schemas.reassign), async (req, res) => {
    const ticket = await service.reassign(req.params.id, req.body.deskId);
    await notify('publish', 'DESK_CHANGED', ticket);
    res.json(await service.ticketState(ticket.id));
  });
  api.get('/queues/:id', async (req, res) => res.json(await service.queueState(req.params.id)));
  api.get('/queues/:id/estimate', async (req, res) => res.json(await service.queueState(req.params.id)));
  api.get('/desks', async (req, res) => res.json(await service.listDesks()));
  api.get('/desks/:id/current-ticket', auth.staff, async (req, res) => {
    const ticket = await service.deskTicket(req.params.id);
    if (!ticket) return res.status(204).end();
    res.json(await service.ticketState(ticket.id));
  });
  api.post('/desks', auth.staff, validate(schemas.desk), async (req, res) => {
    const result = await service.createDesk(req.body);
    for (const id of req.body.serviceIds) await notify('queueChanged', id);
    res.status(201).json(result);
  });
  api.patch('/desks/:id', auth.staff, validate(schemas.deskUpdate), async (req, res) => {
    const before = (await service.listDesks()).find((d) => d.id === req.params.id);
    if (!before) fail(404, 'Desk not found.');
    const desk = await service.updateDesk(req.params.id, req.body);
    const ids = new Set([...before.services.map((s) => s.id), ...(req.body.serviceIds ?? [])]);
    for (const id of ids) await notify('queueChanged', id);
    res.json(desk);
  });
  api.post('/desks/:id/call-next', auth.staff, validate(schemas.call), async (req, res) => {
    const ticket = await service.callNext(req.params.id, req.body.serviceId);
    if (!ticket) return res.status(204).end();
    await notify('publish', 'TICKET_CALLED', ticket);
    await notify('publish', 'DESK_ASSIGNED', ticket);
    res.json(await service.ticketState(ticket.id));
  });
  return api;
}
