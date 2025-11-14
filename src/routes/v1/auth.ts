// src/routes/v1/auth.ts
import { Router } from "express";
import { validate } from "../../middleware/validate";
import { signupSchema, loginSchema } from "../../schemas/auth";
import { signup, login, me, logout } from "../../controllers/v1/auth.controller";
import { authenticate } from "../../middleware/auth";

export const authRouter = Router();


authRouter.post("/signup", validate({ body: signupSchema.shape.body }), signup);
authRouter.post("/login", validate({ body: loginSchema.shape.body }), login);
authRouter.get("/me", authenticate, me);
authRouter.post("/logout", authenticate, logout);

// OIDC stubs (left here; controller stubs optional)
authRouter.get("/oidc/:provider/start", (_req, res) =>
  res
    .status(501)
    .json({ error: { code: "OIDC_NOT_IMPLEMENTED", message: "OIDC init stub" } }),
);

authRouter.get("/oidc/:provider/callback", (_req, res) =>
  res
    .status(501)
    .json({ error: { code: "OIDC_NOT_IMPLEMENTED", message: "OIDC callback stub" } }),
);
