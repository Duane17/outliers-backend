// src/controllers/jobs.controller.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../db/prisma";
import { getInput } from "../../middleware/validate";
import { appendJobEvent, transitionJobStatus } from "../../lib/jobs-events";
import { writeAudit } from "../../lib/audit";
import {
  createJobBodySchema,
  jobIdParamSchema,
  jobWebhookBodySchema,
  listJobsQuerySchema,
  cancelJobBodySchema,
} from "../../schemas/jobs";
import { authorizeJobCreation, sanitizeJobInputForStorage } from "../../lib/policies/jobs.policy";
import { JobStatus, JobEventType, Prisma } from "@prisma/client";
import { runSMPC, type SmpcRunInput } from "../../pet/smpc";

/** POST /v1/jobs - create job (PENDING) */
export async function createJob(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = getInput<{ body: typeof createJobBodySchema }>(res);
    const callerOrgId = (res.locals as any).orgId as string;

    // Policy
    const authz = await authorizeJobCreation({
      callerOrgId,
      collaborationId: body!.collaborationId,
      type: body!.type,
      spec: body!.input.type === "SMPC" ? body!.input.spec : {},
    });
    if (!authz.ok) {
      return res
        .status(403)
        .json({ error: { code: authz.reason, message: "Job creation not permitted." } });
    }

    // Persist
    const job = await prisma.job.create({
      data: {
        collaborationId: body!.collaborationId,
        type: body!.type,
        status: JobStatus.PENDING,
        input: sanitizeJobInputForStorage(body!.input),
      },
      select: { id: true, status: true, type: true, collaborationId: true, createdAt: true },
    });

    await appendJobEvent({
      jobId: job.id,
      type: JobEventType.QUEUED,
      data: { reason: "created" },
    });
    await writeAudit(req, callerOrgId, "JOB_CREATE", { jobId: job.id, type: job.type });

    return res.status(201).json({ job });
  } catch (err) {
    return next(err);
  }
}

/** POST /v1/jobs/:id/start - PENDING -> RUNNING and invoke adapter */
export async function startJob(req: Request, res: Response, next: NextFunction) {
  try {
    const { params } = getInput<{ params: typeof jobIdParamSchema }>(res);
    const jobId = params!.id;
    const callerOrgId = (res.locals as any).orgId as string;

    // Scope check: caller must be owner or participant of the job's collaboration
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        collaboration: {
          OR: [{ ownerOrgId: callerOrgId }, { participants: { some: { orgId: callerOrgId } } }],
        },
      },
      select: { id: true, status: true, type: true, input: true },
    });
    if (!job) {
      return res.status(404).json({
        error: { code: "JOB_NOT_FOUND", message: "Not found or not permitted." },
      });
    }
    if (job.status !== JobStatus.PENDING) {
      return res
        .status(409)
        .json({ error: { code: "INVALID_STATE", message: "Job is not PENDING." } });
    }

    // Transition to RUNNING
    await transitionJobStatus({
      jobId,
      from: JobStatus.PENDING,
      to: JobStatus.RUNNING,
      eventType: JobEventType.STARTED,
    });
    await writeAudit(req, callerOrgId, "JOB_START", { jobId });

    // Call adapter (MVP: synchronous stub; later: async workers plus webhook callbacks)
    if (job.type === "SMPC") {
      const spec = (job.input as any).spec as SmpcRunInput;

      try {
        const { artifactUri, result } = await runSMPC(spec, jobId);


        // Complete successfully
        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: JobStatus.SUCCEEDED,
            artifactUri,
            result: result as any,
          },
        });

        await appendJobEvent({
          jobId,
          type: JobEventType.COMPLETED,
          oldStatus: JobStatus.RUNNING,
          newStatus: JobStatus.SUCCEEDED,
          data: { artifactUri },
        });

        await writeAudit(req, callerOrgId, "JOB_COMPLETE", {
          jobId,
          status: "SUCCEEDED",
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "SMPC job failed with an unknown error";

        // Mark job as FAILED and record a FAILED event
        await prisma.job.update({
          where: { id: jobId },
          data: { status: JobStatus.FAILED },
        });

        await appendJobEvent({
          jobId,
          type: JobEventType.FAILED,
          oldStatus: JobStatus.RUNNING,
          newStatus: JobStatus.FAILED,
          data: { error: message },
        });

        await writeAudit(req, callerOrgId, "JOB_COMPLETE", {
          jobId,
          status: "FAILED",
          error: message,
        });
      }
    } else {
      // TEE stub not implemented yet
      await appendJobEvent({
        jobId,
        type: JobEventType.PROGRESS,
        data: { note: "TEE stub not implemented" },
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

/** GET /v1/jobs/:id - status and result */
export async function getJobById(req: Request, res: Response, next: NextFunction) {
  try {
    const { params } = getInput<{ params: typeof jobIdParamSchema }>(res);
    const jobId = params!.id;
    const callerOrgId = (res.locals as any).orgId as string;

    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        collaboration: {
          OR: [{ ownerOrgId: callerOrgId }, { participants: { some: { orgId: callerOrgId } } }],
        },
      },
      select: {
        id: true,
        collaborationId: true,
        type: true,
        status: true,
        artifactUri: true,
        result: true,
        createdAt: true,
        updatedAt: true,
        events: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            type: true,
            oldStatus: true,
            newStatus: true,
            data: true,
            createdAt: true,
          },
        },
      },
    });

    if (!job) {
      return res.status(404).json({
        error: { code: "JOB_NOT_FOUND", message: "Not found or not permitted." },
      });
    }

    return res.status(200).json({ job });
  } catch (err) {
    return next(err);
  }
}

/** POST /v1/webhooks/jobs - adapter callbacks (MVP: basic) */
export async function jobWebhook(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = getInput<{ body: typeof jobWebhookBodySchema }>(res);
    const { jobId, event } = body!;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, status: true },
    });
    if (!job) {
      return res
        .status(404)
        .json({ error: { code: "JOB_NOT_FOUND", message: "Unknown job." } });
    }

    if (event.type === "PROGRESS") {
      await appendJobEvent({ jobId, type: JobEventType.PROGRESS, data: event.data });
    } else if (event.type === "COMPLETED") {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.SUCCEEDED },
      });
      await appendJobEvent({
        jobId,
        type: JobEventType.COMPLETED,
        oldStatus: job.status,
        newStatus: JobStatus.SUCCEEDED,
        data: event.data,
      });
    } else if (event.type === "FAILED") {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.FAILED },
      });
      await appendJobEvent({
        jobId,
        type: JobEventType.FAILED,
        oldStatus: job.status,
        newStatus: JobStatus.FAILED,
        data: event.data,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return next(err);
  }
}

export async function listJobs(_req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = (res.locals as any).orgId as string;
    const { query } = getInput<{ query: typeof listJobsQuerySchema }>(res);
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;

    // Scope: jobs whose collaboration is owned by caller org OR where caller org participates
    const scope: Prisma.JobWhereInput = {
      collaboration: {
        OR: [{ ownerOrgId: orgId }, { participants: { some: { orgId } } }],
      },
    };

    if (query?.type) scope.type = query.type;
    if (query?.status) scope.status = query.status;
    if (query?.collaborationId) scope.collaborationId = query.collaborationId;
    if (query?.createdAfter || query?.createdBefore) {
      scope.createdAt = {
        gte: query?.createdAfter,
        lte: query?.createdBefore,
      };
    }
    // For MVP, q is ignored or could match by id prefix
    if (query?.q) {
      // simple heuristic: id contains
      scope.id = { contains: query.q };
    }

    const [total, items] = await Promise.all([
      prisma.job.count({ where: scope }),
      prisma.job.findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          collaborationId: true,
          type: true,
          status: true,
          artifactUri: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    await writeAudit(_req, orgId, "JOB_LIST", {
      filters: {
        ...query,
        createdAfter: query?.createdAfter?.toISOString(),
        createdBefore: query?.createdBefore?.toISOString(),
      },
      page,
      pageSize,
      total,
    });

    return res.status(200).json({
      jobs: items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    return next(err);
  }
}

export async function cancelJob(req: Request, res: Response, next: NextFunction) {
  try {
    const { params, body } = getInput<{
      params: typeof jobIdParamSchema;
      body: typeof cancelJobBodySchema;
    }>(res);
    const jobId = params!.id;
    const reason = body?.reason;
    const orgId = (res.locals as any).orgId as string;

    // Scope plus current status
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        collaboration: {
          OR: [{ ownerOrgId: orgId }, { participants: { some: { orgId } } }],
        },
      },
      select: { id: true, status: true },
    });
    if (!job) {
      return res.status(404).json({
        error: { code: "JOB_NOT_FOUND", message: "Not found or not permitted." },
      });
    }

    if (
      job.status === JobStatus.SUCCEEDED ||
      job.status === JobStatus.FAILED ||
      job.status === JobStatus.CANCELED
    ) {
      return res.status(409).json({
        error: { code: "INVALID_STATE", message: `Job already ${job.status}.` },
      });
    }

    // Transition: PENDING|RUNNING -> CANCELED
    await prisma.$transaction(async (tx) => {
      // Force compare-and-set to avoid races
      const updated = await tx.job.updateMany({
        where: {
          id: jobId,
          status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
        },
        data: { status: JobStatus.CANCELED },
      });
      if (updated.count !== 1) {
        throw new Error("INVALID_TRANSITION");
      }

      await tx.jobEvent.create({
        data: {
          jobId,
          type: JobEventType.STATUS_CHANGE,
          oldStatus: job.status,
          newStatus: JobStatus.CANCELED,
          data: reason ? { reason } : undefined,
        },
      });
    });

    await writeAudit(req, orgId, "JOB_CANCEL", { jobId, reason });

    return res.status(200).json({ ok: true });
  } catch (err) {
    if ((err as any)?.message === "INVALID_TRANSITION") {
      return res.status(409).json({
        error: {
          code: "INVALID_STATE",
          message: "Job state changed concurrently.",
        },
      });
    }
    return next(err);
  }
}
