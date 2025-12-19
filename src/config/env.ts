import "dotenv/config";
import { z } from "zod";
import path from "path";

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

  // --- JWT ---
  JWT_ISSUER: z.string().min(1),
  JWT_SECRET: z.string().min(20, "JWT_SECRET must be at least 20 chars"),
  JWT_ACCESS_TTL: z.string().default("15m"),

  // --- API Keys ---
  API_KEY_PEPPER: z.string().min(12, "API_KEY_PEPPER should be at least 12 chars"),

  // --- NEW: Artifact Storage ---
  ARTIFACT_ROOT: z.string().min(1, "ARTIFACT_ROOT is required"),
  ARTIFACT_PUBLIC_BASE: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

// Process artifact root: resolve relative paths to absolute
const rawArtifactRoot = parsed.data.ARTIFACT_ROOT;
const artifactRoot = path.isAbsolute(rawArtifactRoot)
  ? rawArtifactRoot
  : path.resolve(process.cwd(), rawArtifactRoot);

// Create final env object with resolved artifact path
export type Env = z.infer<typeof EnvSchema> & {
  artifact: {
    root: string;
    publicBase?: string;
  };
};

export const env: Env = Object.freeze({
  ...parsed.data,
  artifact: {
    root: artifactRoot,
    publicBase: parsed.data.ARTIFACT_PUBLIC_BASE,
  },
});

// Export artifact config separately for convenience
export const artifactConfig = env.artifact;