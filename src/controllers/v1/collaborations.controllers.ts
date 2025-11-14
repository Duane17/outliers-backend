// src/controllers/collaborations.controller.ts
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../../db/prisma";
import { getInput } from "../../middleware/validate";
import {
  createCollaborationBodySchema,
  collaborationIdParamsSchema,
  addParticipantBodySchema,
  listCollaborationsQuerySchema
} from "../../schemas/collaborations";
import { Prisma } from "@prisma/client";
import { writeAudit } from "../../lib/audit";

/**
 * POST /v1/collaborations
 * - OWNER/ADMIN user only
 * - Caller must belong to ownerOrgId
 * - Creates collaboration owned by caller's org
 */
export async function createCollaboration(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = getInput<{ body: typeof createCollaborationBodySchema }>(res);
    const { ownerOrgId, name, purpose } = body!;
    const caller = req.user!; // guaranteed by upstream requireRoles on user JWT

    // Enforce caller's org
    if (caller.orgId !== ownerOrgId) {
      return res.status(403).json({
        error: { code: "ORG_MISMATCH", message: "You can only create collaborations for your own organization." },
      });
    }

    // Ensure org exists (defense-in-depth)
    const ownerOrg = await prisma.organization.findUnique({ where: { id: ownerOrgId }, select: { id: true } });
    if (!ownerOrg) {
      return res.status(400).json({ error: { code: "ORG_NOT_FOUND", message: "ownerOrgId is invalid." } });
    }

    const collab = await prisma.collaboration.create({
      data: {
        ownerOrgId,
        name,
        purpose,
        // Optional: auto-add owner org as BOTH to simplify permissions
        participants: {
          create: [{ orgId: ownerOrgId, role: "BOTH" }],
        },
      },
      select: {
        id: true,
        ownerOrgId: true,
        name: true,
        purpose: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Optional: write an audit row (if you’ve added an audit helper)
    // await writeAudit(req, { action: "COLLAB_CREATE", details: { collaborationId: collab.id } });

    return res.status(201).json({ collaboration: collab });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /v1/collaborations/:id/participants
 * - OWNER/ADMIN user from the collaboration ownerOrg
 * - Adds (orgId, role) as a participant (unique per collaboration)
 */
export async function addCollaborationParticipant(req: Request, res: Response, next: NextFunction) {
  try {
    const { params, body } = getInput<{
      params: typeof collaborationIdParamsSchema;
      body: typeof addParticipantBodySchema;
    }>(res);
    const collaborationId = params!.id;
    const { orgId, role } = body!;
    const caller = req.user!;

    // Load collaboration and ensure caller belongs to its ownerOrg
    const collab = await prisma.collaboration.findUnique({
      where: { id: collaborationId },
      select: { id: true, ownerOrgId: true },
    });
    if (!collab) {
      return res.status(404).json({ error: { code: "COLLAB_NOT_FOUND", message: "Collaboration not found." } });
    }
    if (caller.orgId !== collab.ownerOrgId) {
      return res.status(403).json({
        error: { code: "NOT_COLLAB_OWNER", message: "Only the owner organization can add participants." },
      });
    }

    // Ensure target org exists
    const targetOrg = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!targetOrg) {
      return res.status(400).json({ error: { code: "ORG_NOT_FOUND", message: "Participant orgId is invalid." } });
    }

    // Create participant (unique on (collaborationId, orgId) at DB level)
    const participant = await prisma.collaborationParticipant.create({
      data: {
        collaborationId,
        orgId,
        role,
      },
      select: {
        id: true,
        collaborationId: true,
        orgId: true,
        role: true,
        createdAt: true,
      },
    });

    // Optional audit
    // await writeAudit(req, { action: "COLLAB_ADD_PARTICIPANT", details: { collaborationId, orgId, role } });

    return res.status(201).json({ participant });
  } catch (err) {
    // Friendly message for unique constraint collisions
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({
        error: { code: "PARTICIPANT_EXISTS", message: "This organization is already a participant." },
      });
    }
    return next(err);
  }
}

export async function getCollaborationById(req: Request, res: Response, next: NextFunction) {
  try {
    const { params, query } = getInput<{
      params: typeof collaborationIdParamsSchema;
      query: typeof listCollaborationsQuerySchema;
    }>(res);
    const id = params!.id;
    const orgId = (res.locals as any).orgId as string;
    const includeParticipants = Boolean(query?.includeParticipants);

    // Ensure membership (owner or participant)
    const collab = await prisma.collaboration.findFirst({
      where: {
        id,
        OR: [
          { ownerOrgId: orgId },
          { participants: { some: { orgId } } },
        ],
      },
      select: {
        id: true,
        ownerOrgId: true,
        name: true,
        purpose: true,
        createdAt: true,
        updatedAt: true,
        participants: includeParticipants
          ? { select: { id: true, orgId: true, role: true, createdAt: true } }
          : false,
      },
    });

    if (!collab) {
      return res.status(404).json({ error: { code: "COLLAB_NOT_FOUND", message: "Not found or not in your org scope." } });
    }

    await writeAudit(req, orgId, "COLLAB_VIEW", { collaborationId: id });

    return res.status(200).json({ collaboration: collab });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /v1/collaborations
 * - Lists collaborations your org owns or participates in.
 * - Filters: q (name contains), owned, role; pagination via paginationSchema.
 */
export async function listCollaborations(_req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = (res.locals as any).orgId as string;
    const { query } = getInput<{ query: typeof listCollaborationsQuerySchema }>(res);
    const page = query?.page ?? 1;
    const pageSize = query?.pageSize ?? 20;

    // Base scope: owner or participant
    const scope: Prisma.CollaborationWhereInput = {
      OR: [{ ownerOrgId: orgId }, { participants: { some: { orgId } } }],
    };

    // Search by name
    if (query?.q) {
      scope.name = { contains: query.q, mode: "insensitive" };
    }
    // Owned only
    if (query?.owned) {
      scope.OR = undefined;
      scope.ownerOrgId = orgId;
    }
    // Filter by the caller’s participant role (only makes sense when not "owned only")
    if (query?.role) {
      scope.participants = { some: { orgId, role: query.role } };
    }

    const [total, items] = await Promise.all([
      prisma.collaboration.count({ where: scope }),
      prisma.collaboration.findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          ownerOrgId: true,
          name: true,
          purpose: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    await writeAudit(_req, orgId, "COLLAB_LIST", {
      filters: { q: query?.q, owned: query?.owned, role: query?.role },
      page,
      pageSize,
      total,
    });

    return res.status(200).json({
      collaborations: items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    return next(err);
  }
}