import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function createDatabase(url) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 5 }) });
}

// Retry the entire transaction on a serialization conflict (not individual queries).
export async function transaction(db, work) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error.code !== 'P2034') throw error;
      if (attempt === 4) {
        const busy = new Error('Queue is busy. Please retry.');
        busy.status = 409;
        throw busy;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
