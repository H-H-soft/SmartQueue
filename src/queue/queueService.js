import { transaction } from './database.js';
import { estimateWait } from './estimationService.js';
import { activeStatuses, assertTransition, fail, hashToken, newToken, publicTicket } from './domain.js';

export function createQueueService(db) {
  const get = async (tx, model, id) => {
    const row = await tx[model].findUnique({ where: { id } });
    return row ?? fail(404, `${model} not found.`);
  };
  const openDesks = (tx, serviceId) => tx.desk.findMany({
    where: { status: 'OPEN', services: { some: { id: serviceId } } },
    include: { tickets: { where: { status: { in: activeStatuses } } } },
  });
  const availableDesk = async (tx, deskId, serviceId) => {
    const desk = await tx.desk.findUnique({ where: { id: deskId }, include: { services: true } });
    if (!desk) fail(404, 'Desk not found.');
    if (desk.status !== 'OPEN') fail(409, 'Desk is not open.');
    if (!desk.services.some((s) => s.id === serviceId)) fail(409, 'Desk does not support this service.');
    if (await tx.ticket.count({ where: { deskId, status: { in: activeStatuses } } })) fail(409, 'Desk is busy.');
    return desk;
  };

  return {
    listServices: () => db.service.findMany({ select: {
      id: true, name: true, prefix: true, avgMinutes: true, active: true,
    }, orderBy: { id: 'asc' } }),
    listDesks: () => db.desk.findMany({ include: {
      services: { select: { id: true, name: true } },
      tickets: { where: { status: { in: activeStatuses } }, select: { number: true, status: true } },
    }, orderBy: { id: 'asc' } }),
    createService: (input) => db.service.create({ data: input }),
    updateService: (id, input) => transaction(db, async (tx) => {
      await get(tx, 'service', id);
      return tx.service.update({ where: { id }, data: input });
    }),
    createDesk: (input) => transaction(db, async (tx) => {
      const { serviceIds, ...data } = input;
      for (const id of serviceIds) await get(tx, 'service', id);
      return tx.desk.create({ data: { ...data, services: { connect: serviceIds.map((id) => ({ id })) } } });
    }),
    updateDesk: (id, input) => transaction(db, async (tx) => {
      await get(tx, 'desk', id);
      // Pausing/closing preserves an existing assignment; finish it before editing compatibility/location.
      const { serviceIds, ...data } = input;
      const affectsAssignment = serviceIds || ['buildingId', 'floor', 'locationId'].some((key) => key in data);
      if (affectsAssignment && await tx.ticket.count({ where: { deskId: id, status: { in: activeStatuses } } })) {
        fail(409, 'Finish or reassign the current ticket before changing desk location or services.');
      }
      if (serviceIds) {
        for (const serviceId of serviceIds) await get(tx, 'service', serviceId);
        data.services = { set: serviceIds.map((id) => ({ id })) };
      }
      return tx.desk.update({ where: { id }, data });
    }),
    createTicket: (input) => transaction(db, async (tx) => {
      const service = await get(tx, 'service', input.serviceId);
      if (!service.active) fail(409, 'Queue is closed.');
      const counter = await tx.service.update({ where: { id: service.id }, data: { nextNumber: { increment: 1 } } });
      const accessToken = newToken();
      const ticket = await tx.ticket.create({ data: {
        ...input, sequence: counter.nextNumber,
        number: `${service.prefix}${String(counter.nextNumber).padStart(3, '0')}`,
        tokenHash: hashToken(accessToken),
      } });
      return { ...publicTicket(ticket), accessToken };
    }),
    // Kept internal: never return tokenHash through an API or socket.
    findTicket: (id) => db.ticket.findUnique({ where: { id } }),
    deskTicket: async (id) => {
      await get(db, 'desk', id);
      return db.ticket.findFirst({ where: { deskId: id, status: { in: activeStatuses } } });
    },
    ticketState: (id) => transaction(db, async (tx) => {
      const ticket = await tx.ticket.findUnique({ where: { id }, include: { desk: true } });
      if (!ticket) fail(404, 'Ticket not found.');
      const service = await get(tx, 'service', ticket.serviceId);
      const ahead = ticket.status === 'WAITING'
        ? await tx.ticket.count({ where: { serviceId: ticket.serviceId, status: 'WAITING', sequence: { lt: ticket.sequence } } }) : 0;
      return { ...publicTicket(ticket), visitorsAhead: ahead,
        positionInQueue: ticket.status === 'WAITING' ? ahead + 1 : null,
        estimatedWaitMinutes: ticket.status === 'WAITING' && service.active
          ? estimateWait(ahead, await openDesks(tx, ticket.serviceId), service.avgMinutes) : null,
        estimateIsApproximate: true,
      };
    }),
    queueState: (id) => transaction(db, async (tx) => {
      const service = await get(tx, 'service', id);
      const waitingCount = await tx.ticket.count({ where: { serviceId: id, status: 'WAITING' } });
      const desks = await openDesks(tx, id);
      return { id, name: service.name, active: service.active, waitingCount,
        activeDesks: desks.length, availableDesks: desks.filter((d) => !d.tickets.length).length,
        avgMinutes: service.avgMinutes,
        estimatedWaitMinutes: service.active ? estimateWait(waitingCount, desks, service.avgMinutes) : null,
        estimateIsApproximate: true,
      };
    }),
    callNext: (deskId, serviceId) => transaction(db, async (tx) => {
      const service = await get(tx, 'service', serviceId);
      if (!service.active) fail(409, 'Queue is closed.');
      await availableDesk(tx, deskId, serviceId);
      const next = await tx.ticket.findFirst({ where: { serviceId, status: 'WAITING' }, orderBy: { sequence: 'asc' } });
      if (!next) return null;
      return publicTicket(await tx.ticket.update({ where: { id: next.id }, data: {
        status: 'CALLED', deskId, calledAt: new Date(),
      }, include: { desk: true } }));
    }),
    changeStatus: (id, status) => transaction(db, async (tx) => {
      const ticket = await get(tx, 'ticket', id);
      assertTransition(ticket.status, status);
      return publicTicket(await tx.ticket.update({ where: { id }, data: {
        status, ...(status === 'SERVING' ? { startedAt: new Date() } : { endedAt: new Date() }),
      }, include: { desk: true } }));
    }),
    reassign: (id, deskId) => transaction(db, async (tx) => {
      const ticket = await get(tx, 'ticket', id);
      if (ticket.status !== 'CALLED') fail(409, 'Only called tickets can be reassigned.');
      await availableDesk(tx, deskId, ticket.serviceId);
      return publicTicket(await tx.ticket.update({ where: { id }, data: { deskId }, include: { desk: true } }));
    }),
  };
}
