// src/schemas/auth.ts
import { z } from "zod";

export const signupSchema = z.object({
  body: z.object({
    orgId: z.string().uuid(),
    email: z.string().email().max(254),
    password: z.string().min(8).max(128),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
  }),
});
