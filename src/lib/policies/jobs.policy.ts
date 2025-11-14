// src/lib/policies/jobs.policy.ts
import { prisma } from "../../db/prisma";
import type { Prisma } from "@prisma/client";

type ParticipantRole = "PROVIDER" | "CONSUMER" | "BOTH";

export type SmpcSpec = {
  operation: "COUNT" | "SUM" | "AVG";
  datasets: { datasetId: string; fields: string[] }[];
  groupBy?: string[];
  filters?: Array<{ field: string; op: string; value: unknown }>;
};

export async function authorizeJobCreation(args: {
  callerOrgId: string;
  collaborationId: string;
  type: "SMPC" | "TEE";
  spec: SmpcSpec | Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { callerOrgId, collaborationId, type } = args;

  // 1) Collaboration exists and caller is owner or participant
  const collab = await prisma.collaboration.findFirst({
    where: {
      id: collaborationId,
      OR: [{ ownerOrgId: callerOrgId }, { participants: { some: { orgId: callerOrgId } } }],
    },
    select: { id: true, ownerOrgId: true },
  });
  if (!collab) return { ok: false, reason: "COLLAB_NOT_FOUND_OR_FORBIDDEN" };

  // 2) Caller has a role that can submit jobs
  const part = await prisma.collaborationParticipant.findFirst({
    where: { collaborationId, orgId: callerOrgId },
    select: { role: true },
  });
  const role: ParticipantRole | null = part?.role ?? (collab.ownerOrgId === callerOrgId ? "BOTH" : null);
  if (!role) return { ok: false, reason: "NOT_A_PARTICIPANT" };
  if (type === "SMPC" && !["PROVIDER", "CONSUMER", "BOTH"].includes(role)) {
    return { ok: false, reason: "ROLE_FORBIDDEN" };
  }

  // 3) SMPC specific checks
  if (type === "SMPC") {
    const spec = args.spec as SmpcSpec;

    // Datasets must exist and belong to any participant org (metadata-only)
    const datasetIds = spec.datasets.map(d => d.datasetId);
    const datasets = await prisma.dataset.findMany({
      where: { id: { in: datasetIds } },
      select: { id: true, orgId: true },
    });
    if (datasets.length !== datasetIds.length) {
      return { ok: false, reason: "DATASET_NOT_FOUND" };
    }

    // All datasets orgs must be members of this collaboration
    const datasetOrgIds = [...new Set(datasets.map(d => d.orgId))];
    const memberOrgIds = await prisma.collaborationParticipant.findMany({
      where: { collaborationId, orgId: { in: datasetOrgIds } },
      select: { orgId: true },
    });
    if (new Set(memberOrgIds.map(m => m.orgId)).size !== datasetOrgIds.length) {
      return { ok: false, reason: "DATASET_ORG_NOT_PARTICIPANT" };
    }

    // Consent checks (simple MVP): ensure at least one consent exists per dataset
    const consentCounts = await prisma.consent.groupBy({
      by: ["datasetId"],
      where: { datasetId: { in: datasetIds } },
      _count: { datasetId: true },
    });
    if (consentCounts.length !== datasetIds.length) {
      return { ok: false, reason: "MISSING_CONSENT" };
    }

    // Optional: field allowlist / PII deny-list could be enforced here
  }

  return { ok: true };
}

export function sanitizeJobInputForStorage(input: unknown): Prisma.InputJsonValue {
  // Ensure only JSON-serializable, strip undefined
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}
