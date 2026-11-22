import { z } from 'zod';

const booleanFromString = z.enum(['true', 'false']).transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  TEMPORAL_ADDRESS: z.string().min(1).default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default'),
  TEMPORAL_TASK_QUEUE: z.string().min(1).default('hotel-offers'),
  WORKFLOW_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(30),

  SUPPLIER_A_URL: z.string().url().default('http://localhost:3000/supplierA/hotels'),
  SUPPLIER_B_URL: z.string().url().default('http://localhost:3000/supplierB/hotels'),
  SUPPLIER_TIMEOUT_MS: z.coerce.number().int().min(100).default(3000),

  CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
  DEGRADED_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(10),

  MOCK_CHAOS_ENABLED: booleanFromString.default(true),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}
