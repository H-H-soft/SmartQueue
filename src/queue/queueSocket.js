import { Server } from 'socket.io';
import { equalSecret, hashToken } from './domain.js';
import { z } from 'zod';

export function attachSockets(server, service, origin) {
  const io = new Server(server, { cors: { origin }, maxHttpBufferSize: 4096 });
  io.on('connection', (socket) => {
    // A reconnect creates a fresh socket. Join first, then retrieve REST state.
    socket.on('subscribe', async (input, ack) => {
      if (typeof ack !== 'function') return;
      try {
        const { serviceId, ticketId, accessToken } = z.object({
          serviceId: z.string().max(100).optional(), ticketId: z.string().max(100).optional(),
          accessToken: z.string().max(128).optional(),
        }).strict().parse(input);
        if (serviceId) {
          await service.queueState(serviceId);
          if (socket.rooms.size > 10) throw new Error('Subscription limit reached.');
          await socket.join(`queue:${serviceId}`);
        }
        if (ticketId) {
          const ticket = await service.findTicket(ticketId);
          if (!ticket || !equalSecret(ticket.tokenHash, hashToken(accessToken ?? ''))) throw new Error('Unauthorized');
          if (socket.rooms.size > 10) throw new Error('Subscription limit reached.');
          await socket.join(`ticket:${ticketId}`);
        }
        ack({ ok: true });
      } catch {
        ack({ ok: false, error: 'Invalid or unauthorized subscription.' });
      }
    });
    socket.on('unsubscribe', (input) => {
      if (typeof input?.serviceId === 'string') socket.leave(`queue:${input.serviceId}`);
      if (typeof input?.ticketId === 'string') socket.leave(`ticket:${input.ticketId}`);
    });
  });

  return {
    io,
    async publish(event, ticket) {
      // Public announcements deliberately omit ticket UUIDs, profiles and credentials.
      const payload = { event, serviceId: ticket.serviceId, ticketNumber: ticket.number,
        status: ticket.status, desk: ticket.desk ?? null };
      io.to([`queue:${ticket.serviceId}`, `ticket:${ticket.id}`]).emit(event, payload);
      const state = await service.ticketState(ticket.id);
      io.to(`ticket:${ticket.id}`).emit('TICKET_UPDATED', { event: 'TICKET_UPDATED', ...state });
      // A shared desk affects estimates in its other queues, too.
      const ids = new Set([ticket.serviceId]);
      for (const desk of await service.listDesks()) {
        if (desk.services.some((s) => s.id === ticket.serviceId)) {
          for (const supported of desk.services) ids.add(supported.id);
        }
      }
      for (const id of ids) await this.queueChanged(id);
    },
    async queueChanged(serviceId) {
      io.to(`queue:${serviceId}`).emit('QUEUE_POSITION_CHANGED', {
        event: 'QUEUE_POSITION_CHANGED', serviceId, refreshRequired: true,
      });
      io.to(`queue:${serviceId}`).emit('QUEUE_UPDATED', await service.queueState(serviceId));
    },
  };
}
