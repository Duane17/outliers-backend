// src/lib/jobs-events.ts
import { prisma } from "../db/prisma";
import { JobStatus, JobEventType } from "@prisma/client";

export async function appendJobEvent(args: {
  jobId: string;
  type: JobEventType;
  oldStatus?: JobStatus | null;
  newStatus?: JobStatus | null;
  data?: unknown;
}) {
  const { jobId, type, oldStatus = null, newStatus = null, data } = args;
  return prisma.jobEvent.create({
    data: { jobId, type, oldStatus, newStatus, data: data as any },
  });
}

export async function transitionJobStatus(args: {
  jobId: string;
  from: JobStatus;
  to: JobStatus;
  eventType: JobEventType;
  data?: unknown;
}) {
  const { jobId, from, to, eventType, data } = args;
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: from },
    data: { status: to },
  });
  if (updated.count !== 1) {
    throw new Error(`INVALID_TRANSITION: expected ${from} → ${to}`);
  }
  await appendJobEvent({ jobId, type: eventType, oldStatus: from, newStatus: to, data });
}
