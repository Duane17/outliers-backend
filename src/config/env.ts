import "dotenv/config";
import { z } from "zod";

/** CSV → string[] (trims entries, drops empties) */
const csvToStringArray = (v: unknown): string[] => {
  if (typeof v !== "string") return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const sizeRegex = /^\d+\s*(kb|mb|gb)$/i;

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  CORS_ORIGINS: z
    .string()
    .optional()
    .transform(csvToStringArray)
    .default([] as string[]),

  JSON_LIMIT: z
    .string()
    .default("1mb")
    .refine((v) => sizeRegex.test(v), {
      message: 'JSON_LIMIT must look like "512kb", "1mb", or "1 gb"',
    }),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),

  // --- NEW: Auth config ---
  JWT_ISSUER: z.string().min(1),
  JWT_SECRET: z.string().min(20, "JWT_SECRET must be at least 20 chars"),
  JWT_ACCESS_TTL: z.string().default("15m"), // parsed by jsonwebtoken

  API_KEY_PEPPER: z.string().min(12, "API_KEY_PEPPER should be at least 12 chars"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export type Env = z.infer<typeof EnvSchema>;
export const env: Env = Object.freeze(parsed.data);
