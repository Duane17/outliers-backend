// src/schemas/auth.ts
import { z } from "zod";

export const signupSchema = z.object({
  body: z
    .object({
      orgId: z.uuid(),
      email: z.email(),
      password: z.string().min(8),
      name: z.string().min(1),
    })
});


export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
  }),
});
