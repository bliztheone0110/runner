import type { Pool } from 'pg';

export interface LeaderboardEntry {
  username: string;
  checkpoints: number;
  updatedAt: string;
}

export interface LeaderboardRepository {
  saveBest(username: string, usernameKey: string, checkpoints: number): Promise<LeaderboardEntry>;
  getTopTen(): Promise<LeaderboardEntry[]>;
  checkConnection(): Promise<void>;
}

interface LeaderboardRow {
  username: string;
  checkpoints: number;
  updated_at: Date;
}

export class PostgresLeaderboardRepository implements LeaderboardRepository {
  constructor(private readonly pool: Pool) {}

  async saveBest(
    username: string,
    usernameKey: string,
    checkpoints: number,
  ): Promise<LeaderboardEntry> {
    const result = await this.pool.query<LeaderboardRow>(
      `
        INSERT INTO leaderboard_records (username_key, username, best_checkpoints)
        VALUES ($1, $2, $3)
        ON CONFLICT (username_key) DO UPDATE
        SET
          username = CASE
            WHEN EXCLUDED.best_checkpoints > leaderboard_records.best_checkpoints
              THEN EXCLUDED.username
            ELSE leaderboard_records.username
          END,
          best_checkpoints = GREATEST(
            leaderboard_records.best_checkpoints,
            EXCLUDED.best_checkpoints
          ),
          updated_at = CASE
            WHEN EXCLUDED.best_checkpoints > leaderboard_records.best_checkpoints
              THEN NOW()
            ELSE leaderboard_records.updated_at
          END
        RETURNING username, best_checkpoints AS checkpoints, updated_at
      `,
      [usernameKey, username, checkpoints],
    );
    return toEntry(result.rows[0]);
  }

  async getTopTen(): Promise<LeaderboardEntry[]> {
    const result = await this.pool.query<LeaderboardRow>(
      `
        SELECT username, best_checkpoints AS checkpoints, updated_at
        FROM leaderboard_records
        ORDER BY best_checkpoints DESC, username_key ASC
        LIMIT 10
      `,
    );
    return result.rows.map(toEntry);
  }

  async checkConnection(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

function toEntry(row: LeaderboardRow): LeaderboardEntry {
  return {
    username: row.username,
    checkpoints: row.checkpoints,
    updatedAt: row.updated_at.toISOString(),
  };
}
