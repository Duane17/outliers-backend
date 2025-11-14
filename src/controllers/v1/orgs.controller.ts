// src/controllers/orgs.controller.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../db/prisma";

/**
 * GET /v1/orgs/me
 * Works for both User (JWT) and API key auth.
 * Uses res.locals.orgId set by requireOrg().
 */
export async function getMyOrg(_req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = (res.locals as any).orgId as string;
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!org) {
      return res.status(404).json({ error: { code: "ORG_NOT_FOUND", message: "Organization not found" } });
    }
    return res.status(200).json({ org });
  } catch (err) {
    return next(err);
  }
}
