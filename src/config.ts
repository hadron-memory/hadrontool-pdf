import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment configuration, validated once at boot. Importing this module
 * throws (and the process exits non-zero) if the environment is invalid, so a
 * misconfigured container fails fast instead of half-working.
 */
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  PDF_SERVICE_TOKEN: z.string().min(1).optional(),
  PDF_ALLOW_REMOTE: boolish.default(false),
  MAX_BODY_SIZE: z.string().default('10mb'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', z.flattenError(parsed.error).fieldErrors);
  process.exit(1);
}

const env = parsed.data;
const isProduction = env.NODE_ENV === 'production';

// Refuse to run an unauthenticated renderer in production — an open
// markdown->PDF endpoint backed by a headless browser is an SSRF foothold.
if (isProduction && !env.PDF_SERVICE_TOKEN) {
  // eslint-disable-next-line no-console
  console.error('PDF_SERVICE_TOKEN must be set when NODE_ENV=production. Refusing to start.');
  process.exit(1);
}

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction,
  port: env.PORT,
  /** Shared bearer token; when undefined, auth is disabled (dev only). */
  serviceToken: env.PDF_SERVICE_TOKEN,
  /** Allow the headless browser to fetch remote http/https resources. */
  allowRemote: env.PDF_ALLOW_REMOTE,
  maxBodySize: env.MAX_BODY_SIZE,
} as const;

export type Config = typeof config;
