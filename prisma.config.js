import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Generation and unit tests do not need a running database.
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/smartqueue',
  },
});
