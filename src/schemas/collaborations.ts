// src/schemas/collaborations.ts
import { z } from "zod";
import { paginationSchema } from "../middleware/validate";

export const createCollaborationBodySchema = z.object({
  ownerOrgId: z.string().uuid(),
  name: z.string().min(1).max(100),
  purpose: z.string().min(1).max(200),
});

export const collaborationIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const addParticipantBodySchema = z.object({
  orgId: z.string().uuid(),
  role: z.enum(["PROVIDER", "CONSUMER", "BOTH"]),
});


export const listCollaborationsQuerySchema = paginationSchema.extend({
  q: z.string().min(1).max(100).optional(),
  owned: z.coerce.boolean().optional(),
  role: z.enum(["PROVIDER", "CONSUMER", "BOTH"]).optional(),
  includeParticipants: z.coerce.boolean().optional().default(false),
});