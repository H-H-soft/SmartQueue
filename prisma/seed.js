import { readFile } from 'node:fs/promises';
import { createDatabase } from '../src/queue/database.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const prisma = createDatabase(process.env.DATABASE_URL);

const building = JSON.parse(await readFile(new URL('../src/data/building.json', import.meta.url), 'utf8'));
try {
  await prisma.$transaction(async (tx) => {
    for (const [index, service] of building.services.entries()) {
      await tx.service.upsert({ where: { id: service.id }, update: {}, create: {
        id: service.id, name: service.name, avgMinutes: service.avgMinutes, prefix: String.fromCharCode(65 + index),
      } });
    }
    for (const desk of building.desks) {
      const node = building.nodes.find((node) => node.id === desk.nodeId);
      const floor = building.floors.find((floor) => floor.id === node.floor);
      await tx.desk.upsert({ where: { id: desk.id }, update: {}, create: {
        id: desk.id, name: node.label, buildingId: building.id, floor: floor.level,
        locationId: node.id, status: desk.status.toUpperCase(),
        services: { connect: building.services.filter((s) => s.deskIds.includes(desk.id)).map((s) => ({ id: s.id })) },
      } });
    }
  });
} finally {
  await prisma.$disconnect();
}
