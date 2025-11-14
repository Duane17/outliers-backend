// src/routes/v1/collaborations.ts
import { Router } from "express";
import { authenticate, requireOrg, requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  createCollaborationBodySchema,
  collaborationIdParamsSchema,
  addParticipantBodySchema,
  listCollaborationsQuerySchema
} from "../../schemas/collaborations";
import {
  createCollaboration,
  addCollaborationParticipant,
  getCollaborationById,
  listCollaborations,
} from  "../../controllers/v1/collaborations.controllers";

export const collaborationsRouter = Router();

/**
 * POST /v1/collaborations
 * - OWNER/ADMIN user
 * - Caller must belong to ownerOrgId
 */
collaborationsRouter.post(
  "/",
  authenticate,
  requireOrg(),                 // sets res.locals.orgId (used mostly elsewhere; here we check req.user.orgId explicitly)
  requireRoles(["OWNER", "ADMIN"]),
  validate({ body: createCollaborationBodySchema }),
  createCollaboration,
);

/**
 * POST /v1/collaborations/:id/participants
 * - OWNER/ADMIN user from collaboration ownerOrg
 */
collaborationsRouter.post(
  "/:id/participants",
  authenticate,
  requireOrg(),
  requireRoles(["OWNER", "ADMIN"]),
  validate({ params: collaborationIdParamsSchema, body: addParticipantBodySchema }),
  addCollaborationParticipant,
);


/** Get collaboration by id (must be owner or participant) */
collaborationsRouter.get(
  "/:id",
  authenticate,
  requireOrg(),
  validate({ params: collaborationIdParamsSchema, query: listCollaborationsQuerySchema.partial() }),
  getCollaborationById,
);

/** List collaborations for caller’s org (owner or participant) */
collaborationsRouter.get(
  "/",
  authenticate,
  requireOrg(),
  validate({ query: listCollaborationsQuerySchema }),
  listCollaborations,
);