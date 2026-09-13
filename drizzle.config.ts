import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema/app.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Usar el rol de migración (privilegio elevado)
    url: process.env.DATABASE_URL!,
  },
  schemaFilter: ['app'],
  verbose: true,
  strict: true,
} satisfies Config;
