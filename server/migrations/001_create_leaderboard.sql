CREATE TABLE IF NOT EXISTS leaderboard_records (
  username_key TEXT PRIMARY KEY,
  username VARCHAR(24) NOT NULL,
  best_checkpoints INTEGER NOT NULL CHECK (best_checkpoints >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS leaderboard_records_ranking_idx
  ON leaderboard_records (best_checkpoints DESC, username_key ASC);
