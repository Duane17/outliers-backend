// src/routes/v1/auth.ts
import { Router } from "express";
import { validate } from "../../middleware/validate";
import { signupSchema, loginSchema } from "../../schemas/auth";
import { signup, login } from "../../controllers/v1/auth.controller";

export const authRouter = Router();

// POST /v1/auth/signup
authRouter.post("/signup", validate({ body: signupSchema.shape.body }), signup);

// POST /v1/auth/login
authRouter.post("/login", validate({ body: loginSchema.shape.body }), login);

// OIDC stubs (left here; controller stubs optional)
authRouter.get("/oidc/:provider/start", (_req, res) =>
  res.status(501).json({ error: { code: "OIDC_NOT_IMPLEMENTED", message: "OIDC init stub" } }),
);

authRouter.get("/oidc/:provider/callback", (_req, res) =>
  res.status(501).json({ error: { code: "OIDC_NOT_IMPLEMENTED", message: "OIDC callback stub" } }),
);
