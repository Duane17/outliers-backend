import { z } from "zod";

export const uploadShareBodySchema = z.object({
  partyId: z.coerce.number().int().min(0).max(99).optional(),
});

export const shareIdParamSchema = z.object({
  id: z.uuid(),
});

export const ShareStatus = z.enum(["PENDING", "UPLOADED", "VERIFIED", "INVALID"]);
export type ShareStatus = z.infer<typeof ShareStatus>;