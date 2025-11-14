// src/lib/audit.ts
import type { Request } from "express";
import { prisma } from "../db/prisma";
import { AuditActorType, Prisma } from "@prisma/client";

/**
 * Write an audit log entry.
 * - orgId: use res.locals.orgId from requireOrg()
 * - Actor: USER (JWT) | API_KEY (X-API-Key) | SYSTEM (fallback)
 */
export async function writeAudit(
  req: Request,
  orgId: string,
  action: string,
  details: Prisma.InputJsonValue,
): Promise<void> {
  let actorType: AuditActorType = AuditActorType.SYSTEM;
  let actorUserId: string | null = null;
  let actorApiKeyId: string | null = null;

  if (req.user) {
    actorType = AuditActorType.USER;
    actorUserId = req.user.sub;
  } else if (req.apiKeyAuth) {
    actorType = AuditActorType.API_KEY;
    actorApiKeyId = req.apiKeyAuth.apiKeyId;
  }

  await prisma.auditLog.create({
    data: {
      orgId,
      action,
      details,
      actorType,
      actorUserId,
      actorApiKeyId,
    },
  });
}
