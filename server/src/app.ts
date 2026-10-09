import express, {
  type ErrorRequestHandler,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type { LeaderboardRepository } from './leaderboardRepository.js';

const maximumUsernameLength = 24;
const maximumCheckpointCount = 2_147_483_647;

export interface AppOptions {
  allowedOrigins?: string;
  writeLimit?: number;
  writeWindowMs?: number;
}

export function createApp(repository: LeaderboardRepository, options: AppOptions = {}): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createCorsMiddleware(options.allowedOrigins ?? process.env.CORS_ORIGIN));
  app.use(express.json({ limit: '4kb' }));

  const isRateLimited = createWriteRateLimiter(
    options.writeLimit ?? 10,
    options.writeWindowMs ?? 60_000,
  );

  app.get('/api/health', async (_request, response) => {
    try {
      await repository.checkConnection();
      response.json({ status: 'ok' });
    } catch {
      response.status(503).json({ error: 'База данных временно недоступна.' });
    }
  });

  app.get('/api/leaderboard', async (_request, response) => {
    try {
      const entries = await repository.getTopTen();
      response.json({ entries });
    } catch {
      response.status(503).json({ error: 'Не удалось загрузить таблицу лидеров.' });
    }
  });

  app.post('/api/records', (request, response, next) => {
    if (isRateLimited(request.ip ?? request.socket.remoteAddress ?? 'unknown')) {
      response.setHeader('Retry-After', '60');
      response.status(429).json({ error: 'Слишком много отправок. Попробуйте позже.' });
      return;
    }
    void saveRecord(repository, request, response, next);
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (isClientError(error)) {
      response.status(error.status).json({ error: 'Некорректный JSON в запросе.' });
      return;
    }
    response.status(500).json({ error: 'Внутренняя ошибка сервера.' });
  };
  app.use(errorHandler);

  return app;
}

async function saveRecord(
  repository: LeaderboardRepository,
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  const body = request.body as unknown;
  if (!isObject(body) || typeof body.username !== 'string') {
    response.status(400).json({ error: 'Укажите имя игрока и число чекпоинтов.' });
    return;
  }
  const username = body.username.normalize('NFKC').trim();
  const usernameLength = Array.from(username).length;
  if (
    usernameLength < 1 ||
    usernameLength > maximumUsernameLength ||
    /[\u0000-\u001f\u007f]/u.test(username)
  ) {
    response.status(400).json({ error: 'Имя должно содержать от 1 до 24 символов.' });
    return;
  }
  if (
    typeof body.checkpoints !== 'number' ||
    !Number.isSafeInteger(body.checkpoints) ||
    body.checkpoints < 0 ||
    body.checkpoints > maximumCheckpointCount
  ) {
    response.status(400).json({ error: 'Число чекпоинтов должно быть целым и неотрицательным.' });
    return;
  }

  try {
    const entry = await repository.saveBest(username, username.toLowerCase(), body.checkpoints);
    response.json({ entry });
  } catch (error) {
    next(error);
  }
}

function createCorsMiddleware(allowedOriginsValue: string | undefined) {
  const allowedOrigins = new Set(
    (allowedOriginsValue ?? 'http://127.0.0.1:5173,http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  return (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.get('origin');
    if (origin) {
      if (!allowedOrigins.has('*') && !allowedOrigins.has(origin)) {
        response.status(403).json({ error: 'Источник запроса не разрешён.' });
        return;
      }
      response.setHeader('Access-Control-Allow-Origin', allowedOrigins.has('*') ? '*' : origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (request.method === 'OPTIONS') {
      response.sendStatus(204);
      return;
    }
    next();
  };
}

function createWriteRateLimiter(limit: number, windowMs: number) {
  const requests = new Map<string, { count: number; startedAt: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    for (const [storedKey, value] of requests) {
      if (now - value.startedAt >= windowMs) {
        requests.delete(storedKey);
      }
    }
    const current = requests.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      requests.set(key, { count: 1, startedAt: now });
      return false;
    }
    if (current.count >= limit) {
      return true;
    }
    current.count++;
    return false;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClientError(value: unknown): value is Error & { status: number } {
  return (
    value instanceof Error &&
    'status' in value &&
    typeof value.status === 'number' &&
    value.status >= 400 &&
    value.status < 500
  );
}
