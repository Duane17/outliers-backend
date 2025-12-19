// src/index.ts
import express from "express";
import helmet from "helmet";
import cors from "cors";
import fs from "fs/promises";
import { env } from "./config/env";
import { logger } from "./logger";
import { createLoggingMiddleware } from "./middleware/logging";
import { createSecurityMiddleware } from "./middleware/security";
import { notFound, errorHandler } from "./middleware/error";
import { authRouter } from "./routes/v1/auth";
import { apiKeysRouter } from "./routes/v1/apikeys";
import { orgsRouter } from "./routes/v1/orgs";
import { usersRouter } from "./routes/v1/users";
import { collaborationsRouter } from "./routes/v1/collaborations";
import { jobsRouter } from "./routes/v1/jobs";

// Ensure artifact directory exists on startup
async function ensureArtifactDirectory() {
  try {
    await fs.access(env.artifact.root);
    logger.info({ path: env.artifact.root }, "Artifact directory exists");
  } catch {
    await fs.mkdir(env.artifact.root, { recursive: true });
    logger.info({ path: env.artifact.root }, "Created artifact directory");
  }
}

// Initialize application
async function init() {
  await ensureArtifactDirectory();
  
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  // --- CORS configuration ---
  const allowedOrigins = (env.CORS_ORIGINS ?? [])
    .map((o: string) => o.trim())
    .filter((o) => o.length > 0);

  app.use(
    cors({
      origin(origin, callback) {
        // Allow no origin (for example curl or health checks)
        if (!origin) {
          return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        return callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    }),
  );

  // Security and logging
  app.use(helmet());
  app.use(...createLoggingMiddleware(env.NODE_ENV === "development"));
  app.use(...createSecurityMiddleware());

  // Health endpoint
  app.get("/healthz", (_req, res) =>
    res.status(200).json({ ok: true, env: env.NODE_ENV }),
  );

  // --- Routes ---
  app.use("/v1/auth", authRouter);
  app.use("/v1/apikeys", apiKeysRouter);
  app.use("/v1/orgs", orgsRouter);
  app.use("/v1/users", usersRouter);
  app.use("/v1/collaborations", collaborationsRouter);
  app.use("/v1/jobs", jobsRouter);

  // 404 then centralized error handler
  app.use(notFound);
  app.use(errorHandler);

  const server = app.listen(env.PORT, () => {
    logger.info({ 
      port: env.PORT, 
      artifactRoot: env.artifact.root,
      nodeEnv: env.NODE_ENV 
    }, "HTTP server listening");
  });

  const shutdown = (signal: string) => () => {
    logger.warn({ signal }, "Shutting down...");
    server.close(() => {
      logger.info("HTTP server closed");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown("SIGINT"));
  process.on("SIGTERM", shutdown("SIGTERM"));
}

// Start the application
init().catch((error) => {
  logger.error({ error }, "Failed to initialize application");
  process.exit(1);
});