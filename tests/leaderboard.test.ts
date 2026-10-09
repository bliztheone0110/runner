import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/src/app.js';
import type {
  LeaderboardEntry as ApiLeaderboardEntry,
  LeaderboardRepository,
} from '../server/src/leaderboardRepository.js';
import { LeaderboardClient } from '../src/ui/LeaderboardClient.js';
import {
  loadUsername,
  normalizeUsername,
  saveUsername,
  usernameStorageKey,
} from '../src/ui/leaderboardStorage.js';

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function entry(username: string, checkpoints: number): ApiLeaderboardEntry {
  return { username, checkpoints, updatedAt: '2026-01-01T00:00:00.000Z' };
}

class MemoryLeaderboardRepository implements LeaderboardRepository {
  readonly records = new Map<string, ApiLeaderboardEntry>();

  async saveBest(
    username: string,
    usernameKey: string,
    checkpoints: number,
  ): Promise<ApiLeaderboardEntry> {
    const current = this.records.get(usernameKey);
    if (!current || checkpoints > current.checkpoints) {
      this.records.set(usernameKey, entry(username, checkpoints));
    }
    return this.records.get(usernameKey) as ApiLeaderboardEntry;
  }

  async getTopTen(): Promise<ApiLeaderboardEntry[]> {
    return Array.from(this.records.values())
      .sort((left, right) => right.checkpoints - left.checkpoints)
      .slice(0, 10);
  }

  async checkConnection(): Promise<void> {}
}

describe('leaderboard username storage', () => {
  it('normalizes and limits names, then restores them from storage', () => {
    const data = new Map<string, string>();
    const storage: MemoryStorage = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
    };

    assert.equal(normalizeUsername('  Ａlex  '), 'Alex');
    assert.equal(normalizeUsername('x'.repeat(30)).length, 24);
    assert.equal(saveUsername(storage, '  Player  '), 'Player');
    assert.equal(data.get(usernameStorageKey), 'Player');
    assert.equal(loadUsername(storage), 'Player');
  });

  it('continues when browser storage is unavailable', () => {
    const storage: MemoryStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    assert.equal(loadUsername(storage), '');
    assert.equal(saveUsername(storage, 'Player'), 'Player');
  });
});

describe('leaderboard client', () => {
  it('submits a record as JSON and parses the returned entry', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const client = new LeaderboardClient('https://api.example/', async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return Response.json({ entry: entry('Runner', 12) });
    });

    assert.deepEqual(await client.submitRecord('Runner', 12), entry('Runner', 12));
    assert.equal(requestedUrl, 'https://api.example/api/records');
    assert.equal(requestedInit?.method, 'POST');
    assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
      username: 'Runner',
      checkpoints: 12,
    });
  });

  it('loads the leaderboard and reports API errors', async () => {
    const client = new LeaderboardClient('', async () =>
      Response.json({ entries: [entry('Runner', 12)] }),
    );
    assert.deepEqual(await client.getLeaderboard(), [entry('Runner', 12)]);

    const unavailable = new LeaderboardClient('', async () =>
      Response.json({ error: 'offline' }, { status: 503 }),
    );
    await assert.rejects(unavailable.getLeaderboard(), /offline/u);
  });
});

describe('leaderboard API', () => {
  const repository = new MemoryLeaderboardRepository();
  const app = createApp(repository, { allowedOrigins: 'http://game.example', writeLimit: 20 });
  let baseUrl = '';
  let server: ReturnType<typeof app.listen>;

  before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('validates, trims and saves only the highest score for a case-insensitive name', async () => {
    const first = await fetch(`${baseUrl}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '  Runner  ', checkpoints: 8 }),
    });
    assert.equal(first.status, 200);

    const lowerScore = await fetch(`${baseUrl}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'runner', checkpoints: 4 }),
    });
    assert.equal(lowerScore.status, 200);

    const higherScore = await fetch(`${baseUrl}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Runner', checkpoints: 10 }),
    });
    assert.equal(higherScore.status, 200);
    assert.equal(repository.records.size, 1);
    assert.equal(repository.records.get('runner')?.checkpoints, 10);
  });

  it('rejects invalid names and scores', async () => {
    const invalidBodies = [
      { username: '   ', checkpoints: 1 },
      { username: 'x'.repeat(25), checkpoints: 1 },
      { username: 'Runner', checkpoints: -1 },
      { username: 'Runner', checkpoints: 1.5 },
    ];

    for (const body of invalidBodies) {
      const response = await fetch(`${baseUrl}/api/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
    }
  });

  it('returns no more than ten ranked entries', async () => {
    for (let score = 0; score < 12; score++) {
      await repository.saveBest(`Player ${score}`, `player ${score}`, score);
    }
    const response = await fetch(`${baseUrl}/api/leaderboard`);
    const payload = (await response.json()) as { entries: ApiLeaderboardEntry[] };
    assert.equal(payload.entries.length, 10);
    assert.equal(payload.entries[0]?.checkpoints, 11);
  });
});
