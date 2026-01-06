// src/config/env.ts
import "dotenv/config";
import { z } from "zod";
import path from "path";
import os from "os";

/** CSV → string[] (trims entries, drops empties) */
const csvToStringArray = (v: unknown): string[] => {
  if (typeof v !== "string") return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

const sizeRegex = /^\d+\s*(kb|mb|gb)$/i;

// Helper to get default MP-SPDZ path based on OS
const getDefaultMPSPDZPath = (): string => {
  if (process.platform === "win32") {
    // Windows (WSL) - adjust based on your WSL username
    const username = os.userInfo().username;
    return `/mnt/c/Users/${username}/MP-SPDZ`; // Alternative WSL path
  }
  // Linux/macOS
  return path.join(os.homedir(), "MP-SPDZ");
};

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

  // --- MP-SPDZ Configuration ---
  MPSPDZ_PATH: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return getDefaultMPSPDZPath();
      
      // If path is absolute, use as-is
      if (path.isAbsolute(v)) {
        return v;
      }
      
      // If relative, resolve from project root
      return path.resolve(process.cwd(), v);
    }),

  MPSPDZ_PROTOCOL: z
    .enum([
      "mascot", "shamir", "malicious-shamir", 
      "spdz2k", "semi2k", "sy", "hemi", "tem", 
      "soho", "spdz-wise", "cowgear", "chaigear"
    ])
    .default("mascot"),

  MPSPDZ_PARTIES: z.coerce.number().int().min(2).max(10).default(2),
  
  MPSPDZ_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  
  MPSPDZ_DEBUG: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1")
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
  mpspdz: {
    path: string;
    protocol: string;
    parties: number;
    timeoutMs: number;
    debug: boolean;
    binaryPath: string;
    playerDataPath: string;
  };
};

// Validate MP-SPDZ directory exists
const mpspdzPath = parsed.data.MPSPDZ_PATH;
const mpspdzBinaryPath = path.join(mpspdzPath, "mpc");
const playerDataPath = path.join(mpspdzPath, "Player-Data");

// Check if MP-SPDZ directory exists (log warning if not, but don't crash)
if (parsed.data.NODE_ENV !== "test") {
  try {
    const fs = require("fs");
    if (!fs.existsSync(mpspdzPath)) {
      console.warn(`⚠️  MP-SPDZ directory not found at: ${mpspdzPath}`);
      console.warn("   Set MPSPDZ_PATH environment variable to the correct location");
    } else if (!fs.existsSync(mpspdzBinaryPath)) {
      console.warn(`⚠️  MP-SPDZ binary not found at: ${mpspdzBinaryPath}`);
      console.warn("   Make sure you've created the 'mpc' symlink: ln -sf compile.py mpc");
    }
  } catch (error) {
    // fs might not be available in all contexts
    console.warn("Could not validate MP-SPDZ path:", error);
  }
}

export const env: Env = Object.freeze({
  ...parsed.data,
  artifact: {
    root: artifactRoot,
    publicBase: parsed.data.ARTIFACT_PUBLIC_BASE,
  },
  mpspdz: {
    path: mpspdzPath,
    protocol: parsed.data.MPSPDZ_PROTOCOL,
    parties: parsed.data.MPSPDZ_PARTIES,
    timeoutMs: parsed.data.MPSPDZ_TIMEOUT_MS,
    debug: parsed.data.MPSPDZ_DEBUG,
    binaryPath: mpspdzBinaryPath,
    playerDataPath: playerDataPath,
  },
});

// Export artifact config separately for convenience
export const artifactConfig = env.artifact;

// Export MP-SPDZ config separately for convenience
export const mpspdzConfig = env.mpspdz;

// Log MP-SPDZ config in development
if (env.NODE_ENV === "development" && env.MPSPDZ_DEBUG) {
  console.log("🔐 MP-SPDZ Configuration:");
  console.log(`   Path: ${env.mpspdz.path}`);
  console.log(`   Protocol: ${env.mpspdz.protocol}`);
  console.log(`   Parties: ${env.mpspdz.parties}`);
  console.log(`   Binary: ${env.mpspdz.binaryPath}`);
}