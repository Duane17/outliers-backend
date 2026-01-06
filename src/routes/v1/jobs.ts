// src/routes/v1/jobs.ts
import { Router, type Router as RouterType } from "express";
import { authenticate, requireOrg } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { createJobBodySchema,
  jobIdParamSchema,
  jobWebhookBodySchema,
  listJobsQuerySchema,
  cancelJobBodySchema,
} from "../../schemas/jobs";
import { uploadShareBodySchema } from "../../schemas/shares";
import { 
  createJob, 
  startJob, 
  getJobById, 
  jobWebhook, 
  listJobs, 
  cancelJob 
} from "../../controllers/v1/jobs.controller";
import { 
  uploadShare, 
  getShareStatus,
  shareUploadMiddleware 
} from "../../controllers/v1/shares.controller";
import {
  downloadJobArtifact,
  getArtifactInfo,
} from "../../controllers/v1/artifacts.controller";

export const jobsRouter: RouterType = Router();


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

/** Upload share for a job */
jobsRouter.post(
  "/:id/shares",
  authenticate,
  requireOrg(),
  validate({ 
    params: jobIdParamSchema,
    body: uploadShareBodySchema 
  }),
  shareUploadMiddleware,
  uploadShare,
);

/** Get share upload status */
jobsRouter.get(
  "/:id/shares/status",
  authenticate,
  requireOrg(),
  validate({ params: jobIdParamSchema }),
  getShareStatus,
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

// Artifact endpoints
jobsRouter.get("/:id/artifact", validate({ params: jobIdParamSchema }), downloadJobArtifact);
jobsRouter.get("/:id/artifact/info", validate({ params: jobIdParamSchema }), getArtifactInfo);

/** Adapter webhook (optional for async adapters) */
jobsRouter.post(
  "/webhooks/jobs",
  // authenticate webhook with shared secret or signature in production
  validate({ body: jobWebhookBodySchema }),
  jobWebhook,
);
