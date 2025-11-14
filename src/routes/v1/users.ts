// src/routes/v1/users.ts
import { Router } from "express";
import { authenticate, requireOrg, requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { listUsersQuerySchema, userIdParamSchema, updateUserRoleBodySchema } from "../../schemas/users";
import { listUsers, updateUserRole } from "../../controllers/v1/users.controller";

export const usersRouter = Router();

// List users in org (OWNER/ADMIN)
usersRouter.get(
  "/",
  authenticate,
  requireOrg(),
  requireRoles(["OWNER", "ADMIN"]),
  validate({ query: listUsersQuerySchema }),
  listUsers,
);

// Update role of a user in org (OWNER/ADMIN, with extra safeguards in controller)
usersRouter.patch(
  "/:id",
  authenticate,
  requireOrg(),
  requireRoles(["OWNER", "ADMIN"]),
  validate({ params: userIdParamSchema, body: updateUserRoleBodySchema }),
  updateUserRole,
);
