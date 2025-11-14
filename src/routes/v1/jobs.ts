// src/routes/v1/jobs.ts
import { Router } from "express";
import { authenticate, requireOrg } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { createJobBodySchema,
  jobIdParamSchema,
  jobWebhookBodySchema,
  listJobsQuerySchema,
  cancelJobBodySchema,
} from "../../schemas/jobs";
import { createJob, startJob, getJobById, jobWebhook, listJobs, cancelJob } from "../../controllers/v1/jobs.controller";

export const jobsRouter = Router();


/** List/search jobs */
jobsRouter.get(
  "/",
  authenticate,
  requireOrg(),
  validate({ query: listJobsQuerySchema }),
  listJobs,
);

/** Create job (PENDING) */
jobsRouter.post(
  "/",
  authenticate,
  requireOrg(),
  validate({ body: createJobBodySchema }),
  createJob,
);

/** Start job → RUNNING and invoke adapter */
jobsRouter.post(
  "/:id/start",
  authenticate,
  requireOrg(),
  validate({ params: jobIdParamSchema }),
  startJob,
);

/** Cancel job (PENDING/RUNNING → CANCELED) */
jobsRouter.post(
  "/:id/cancel",
  authenticate,
  requireOrg(),
  validate({ params: jobIdParamSchema, body: cancelJobBodySchema }),
  cancelJob,
);

/** Get job by id (status/result/events) */
jobsRouter.get(
  "/:id",
  authenticate,
  requireOrg(),
  validate({ params: jobIdParamSchema }),
  getJobById,
);

/** Adapter webhook (optional for async adapters) */
jobsRouter.post(
  "/webhooks/jobs",
  // authenticate webhook with shared secret or signature in production
  validate({ body: jobWebhookBodySchema }),
  jobWebhook,
);
