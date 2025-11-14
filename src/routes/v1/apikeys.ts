// src/routes/v1/apikeys.ts
import { Router } from "express";
import { validate } from "../../middleware/validate";
import { createApiKeySchema } from "../../schemas/apikeys";
import { authenticate, requireOrg, requireRoles } from "../../middleware/auth";
import { createApiKey, listApiKeys } from "../../controllers/v1/apikeys.controller";

export const apiKeysRouter = Router();

/**
 * POST /v1/apikeys
 * - Requires user JWT (OWNER/ADMIN) within org scope
 * - Returns the RAW key ONCE (ak_<id>.<secret>)
 */
apiKeysRouter.post(
  "/",
  authenticate,
  requireOrg(),
  requireRoles(["OWNER", "ADMIN"]),
  validate({ body: createApiKeySchema.shape.body }),
  createApiKey,
);

/**
 * GET /v1/apikeys
 * - Requires user JWT (OWNER/ADMIN) within org scope
 * - Lists metadata (never show hashes)
 */
apiKeysRouter.get(
  "/",
  authenticate,
  requireOrg(),
  requireRoles(["OWNER", "ADMIN"]),
  listApiKeys,
);
