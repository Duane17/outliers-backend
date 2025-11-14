import express from "express";
import helmet from "helmet";
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

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", env.TRUST_PROXY);

// Security & logging
app.use(helmet());
app.use(...createLoggingMiddleware(env.NODE_ENV === "development"));
app.use(...createSecurityMiddleware());

// Health
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true, env: env.NODE_ENV }));

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
  logger.info({ port: env.PORT }, "HTTP server listening");
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
