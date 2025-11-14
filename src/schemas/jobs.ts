// src/schemas/jobs.ts
import { z } from "zod";

export const JobTypeEnum = z.enum(["SMPC", "TEE"]);
export const JobStatusEnum = z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]);

export const jobDatasetRefSchema = z.object({
  datasetId: z.string().uuid(),
  fields: z.array(z.string().min(1)).min(1).max(50),
});

export const jobFilterSchema = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "in"]).default("eq"),
  value: z.any(),
});

export const smpcSpecSchema = z.object({
  operation: z.enum(["COUNT", "SUM", "AVG"]),
  datasets: z.array(jobDatasetRefSchema).min(1).max(10),
  groupBy: z.array(z.string().min(1)).max(5).optional(),
  filters: z.array(jobFilterSchema).max(20).optional(),
});

export const createJobBodySchema = z.object({
  collaborationId: z.string().uuid(),
  type: JobTypeEnum,
  input: z.union([
    z.object({ type: z.literal("SMPC"), spec: smpcSpecSchema }),
    z.object({ type: z.literal("TEE"), spec: z.any() }),
  ]),
});

export const jobIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const jobWebhookBodySchema = z.object({
  jobId: z.string().uuid(),
  event: z.object({
    type: z.enum(["PROGRESS", "COMPLETED", "FAILED"]),
    data: z.unknown().optional(),
  }),
});

export const listJobsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: JobTypeEnum.optional(),
  status: JobStatusEnum.optional(),
  collaborationId: z.string().uuid().optional(),
  createdAfter: z.coerce.date().optional(),
  createdBefore: z.coerce.date().optional(),
  q: z.string().min(1).max(100).optional(),
});

export const cancelJobBodySchema = z.object({
  reason: z.string().max(200).optional(),
});