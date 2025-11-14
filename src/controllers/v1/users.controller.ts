// src/controllers/users.controller.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../db/prisma";
import { getInput } from "../../middleware/validate";
import { listUsersQuerySchema, updateUserRoleBodySchema, userIdParamSchema } from "../../schemas/users";

/**
 * GET /v1/users
 * OWNER/ADMIN only; org-scoped
 */
export async function listUsers(_req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = (res.locals as any).orgId as string;

    const { query } = getInput<{ query: typeof listUsersQuerySchema }>(res);
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;

    const where = {
      orgId,
      ...(query?.role ? { role: query.role } : {}),
      ...(query?.email ? { email: query.email } : {}),
    };

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orgId: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          emailVerifiedAt: true,
          orgVerifiedAt: true,
          orgVerificationMethod: true,
        },
      }),
    ]);

    return res.status(200).json({
      users: items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /v1/users/:id
 * OWNER/ADMIN only; org-scoped
 *
 * RBAC rule:
 * - ADMIN may update USER/AUDITOR/ADMIN, but may NOT modify an OWNER nor assign OWNER role
 * - OWNER may modify anyone and assign any role (including OWNER)
 * - A user cannot change their own role (defense-in-depth; optional, but recommended)
 */
export async function updateUserRole(req: Request, res: Response, next: NextFunction) {
  try {
    const { params, body } = getInput<{
      params: typeof userIdParamSchema;
      body: typeof updateUserRoleBodySchema;
    }>(res);

    const targetUserId = params!.id;
    const newRole = body!.role;
    const orgId = (res.locals as any).orgId as string;

    // Fetch caller (must be a user JWT for role checks — requireRoles upstream ensures this)
    const caller = req.user!;
    const callerIsOwner = caller.role === "OWNER";

    // Prevent self role changes
    if (caller.sub === targetUserId) {
      return res.status(403).json({ error: { code: "CANNOT_CHANGE_SELF_ROLE", message: "Forbidden" } });
    }

    // Ensure target is in caller's org
    const target = await prisma.user.findFirst({
      where: { id: targetUserId, orgId },
      select: { id: true, role: true, orgId: true },
    });
    if (!target) {
      return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found in your organization" } });
    }

    // ADMIN cannot modify an OWNER or assign OWNER role
    if (!callerIsOwner) {
      if (target.role === "OWNER") {
        return res.status(403).json({ error: { code: "CANNOT_MODIFY_OWNER", message: "Forbidden" } });
      }
      if (newRole === "OWNER") {
        return res.status(403).json({ error: { code: "CANNOT_ASSIGN_OWNER", message: "Forbidden" } });
      }
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { role: newRole },
      select: { id: true, email: true, orgId: true, role: true, updatedAt: true },
    });

    return res.status(200).json({ user: updated });
  } catch (err) {
    return next(err);
  }
}
