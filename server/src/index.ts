import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createApp } from './app.js';
import { PostgresLeaderboardRepository } from './leaderboardRepository.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('Не задана переменная окружения DATABASE_URL.');
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: 5,
  connectionTimeoutMillis: 5_000,
});

const migration = await readFile(
  new URL('../migrations/001_create_leaderboard.sql', import.meta.url),
  'utf8',
);
await pool.query(migration);

const repository = new PostgresLeaderboardRepository(pool);
const app = createApp(repository);
const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, '0.0.0.0', () => {
  console.info(`Leaderboard API listening on port ${port}`);
});

async function shutdown(): Promise<void> {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
