// src/schemas/apikeys.ts
import { z } from "zod";

export const createApiKeySchema = z.object({
  body: z.object({
    orgId: z.string().uuid(),
    scopes: z.array(z.string().min(1)).max(32).default([]),
  }),
});
