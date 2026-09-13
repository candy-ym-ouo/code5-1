import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

function readNumber(value: string | undefined, fallback: number): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '127.0.0.1',
  port: readNumber(process.env.PORT, 8787),
  databaseUrl: process.env.DATABASE_URL
    ? path.resolve(projectRoot, process.env.DATABASE_URL)
    : path.join(projectRoot, 'data/runtime/shanhai.db'),
  sessionSecret: process.env.SESSION_SECRET ?? 'development-only-session-secret-change-me',
  allowedOrigins: (process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  projectRoot
};

if (config.nodeEnv === 'production') {
  const insecureSecrets = new Set([
    'development-only-session-secret-change-me',
    'replace-with-at-least-32-random-characters'
  ]);
  if (!process.env.SESSION_SECRET || config.sessionSecret.length < 32 || insecureSecrets.has(config.sessionSecret)) {
    throw new Error('生产环境必须设置至少 32 个字符且非示例值的 SESSION_SECRET');
  }
  if (!process.env.APP_ORIGIN || config.allowedOrigins.length === 0) {
    throw new Error('生产环境必须设置 APP_ORIGIN');
  }
  if (config.allowedOrigins.includes('*')) {
    throw new Error('生产环境 APP_ORIGIN 不允许使用通配符');
  }
}
