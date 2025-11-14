// src/routes/v1/orgs.ts
import { Router } from "express";
import { authenticate, requireOrg } from "../../middleware/auth";
import { getMyOrg } from "../../controllers/v1/orgs.controller";

export const orgsRouter = Router();

// Org profile for current auth principal (JWT or API key)
orgsRouter.get("/me", authenticate, requireOrg(), getMyOrg);
