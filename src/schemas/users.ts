// src/schemas/users.ts
import { z } from "zod";
import { paginationSchema } from "../middleware/validate";

export const listUsersQuerySchema = paginationSchema.extend({
  role: z.enum(["OWNER", "ADMIN", "USER", "AUDITOR"]).optional(),
  email: z.string().email().optional(), // exact match filter (keep simple for now)
});

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const updateUserRoleBodySchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "USER", "AUDITOR"]),
});
