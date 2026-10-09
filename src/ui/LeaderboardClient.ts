export interface LeaderboardEntry {
  username: string;
  checkpoints: number;
  updatedAt: string;
}

export class LeaderboardClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl = '',
    private readonly request: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/u, '');
  }

  async submitRecord(username: string, checkpoints: number): Promise<LeaderboardEntry> {
    const response = await this.request(`${this.baseUrl}/api/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, checkpoints }),
    });
    const payload = await this.readPayload(response);
    if (!isObject(payload) || !isLeaderboardEntry(payload.entry)) {
      throw new Error('Сервер вернул некорректный результат.');
    }
    return payload.entry;
  }

  async getLeaderboard(): Promise<LeaderboardEntry[]> {
    const response = await this.request(`${this.baseUrl}/api/leaderboard`);
    const payload = await this.readPayload(response);
    if (!isObject(payload) || !Array.isArray(payload.entries)) {
      throw new Error('Сервер вернул некорректную таблицу лидеров.');
    }
    if (!payload.entries.every(isLeaderboardEntry)) {
      throw new Error('Сервер вернул некорректную таблицу лидеров.');
    }
    return payload.entries;
  }

  private async readPayload(response: Response): Promise<unknown> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error('Не удалось прочитать ответ сервера.');
    }
    if (!response.ok) {
      if (isObject(payload) && typeof payload.error === 'string') {
        throw new Error(payload.error);
      }
      throw new Error('Сервер временно недоступен.');
    }
    return payload;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  return (
    isObject(value) &&
    typeof value.username === 'string' &&
    typeof value.checkpoints === 'number' &&
    Number.isSafeInteger(value.checkpoints) &&
    value.checkpoints >= 0 &&
    typeof value.updatedAt === 'string'
  );
}
