import { readFile } from 'node:fs/promises';
import { createDatabase } from '../src/queue/database.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const prisma = createDatabase(process.env.DATABASE_URL);

const support = JSON.parse(await readFile(new URL('../src/data/airi-support.json', import.meta.url), 'utf8'));
try {
  await prisma.$transaction(async (tx) => {
    for (const service of support.services) {
      const { id, ...data } = service;
      await tx.service.upsert({ where: { id }, update: data, create: {
        id, ...data,
      } });
    }
    const desk = support.desk;
    const deskData = {
      name: desk.name, buildingId: support.buildingId, floor: desk.floor,
      locationId: desk.locationId, status: desk.status,
    };
    const serviceLinks = desk.serviceIds.map((id) => ({ id }));
    await tx.desk.upsert({ where: { id: desk.id }, update: {
      ...deskData, services: { set: serviceLinks },
    }, create: {
      id: desk.id, ...deskData, services: { connect: serviceLinks },
    } });
    for (const id of support.retiredDeskIds ?? []) {
      const existing = await tx.desk.findUnique({ where: { id }, select: { id: true } });
      if (existing) await tx.desk.update({ where: { id }, data: {
        status: 'CLOSED', services: { set: [] },
      } });
    }
  });
} finally {
  await prisma.$disconnect();
}
