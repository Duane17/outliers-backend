// src/controllers/apikeys.controller.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../db/prisma";
import { getInput } from "../../middleware/validate";
import { createApiKeySchema } from "../../schemas/apikeys";
import { createApiKeyMaterial } from "../../lib/auth";

/**
 * POST /v1/apikeys
 * - OWNER/ADMIN only (enforced in router)
 * - Org-scoped (router sets res.locals.orgId via requireOrg)
 * - Returns the RAW key ONCE (ak_<id>.<secret>)
 */
export async function createApiKey(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = getInput<{ body: typeof createApiKeySchema.shape.body }>(res);
    const { orgId, scopes } = body!;

    // Enforce caller's org scope
    const callerOrg = (res.locals as any).orgId as string;
    if (orgId !== callerOrg) {
      return res.status(403).json({ error: { code: "ORG_MISMATCH", message: "Forbidden" } });
    }

    const { id, rawKey, secretHash } = createApiKeyMaterial();

    await prisma.apiKey.create({
      data: {
        id,             // store the id so it matches ak_<id>
        orgId,
        keyHash: secretHash,
        scopes: scopes ?? [],
      },
    });

    return res.status(201).json({ apiKey: rawKey }); // RAW key returned once
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /v1/apikeys
 * - OWNER/ADMIN only (enforced in router)
 * - Org-scoped
 * - Lists metadata (never return hashes)
 */
export async function listApiKeys(_req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = (res.locals as any).orgId as string;

    const keys = await prisma.apiKey.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      select: { id: true, scopes: true, createdAt: true, revokedAt: true },
    });

    return res.status(200).json({ apiKeys: keys });
  } catch (err) {
    return next(err);
  }
}
