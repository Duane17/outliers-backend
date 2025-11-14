// src/controllers/auth.controller.ts
import type { Request, Response, NextFunction } from "express";
import { PrismaClient, OrgVerificationMethod, Role } from "@prisma/client";
import { getInput } from "../../middleware/validate";
import { signupSchema, loginSchema } from "../../schemas/auth";
import { hashPassword, verifyPassword, signAccessToken } from "../../lib/auth";

const prisma = new PrismaClient();

/**
 * POST /v1/auth/signup
 * - Creates a user under orgId
 * - Hashes password with argon2
 * - Auto-verify org membership if email domain is verified
 * - Returns access token
 */
export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = getInput<{ body: typeof signupSchema.shape.body }>(res);
    const { orgId, email, password } = body!;

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) return res.status(400).json({ error: { code: "ORG_NOT_FOUND", message: "Invalid orgId" } });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: { code: "EMAIL_EXISTS", message: "Email already in use" } });

    const passwordHash = await hashPassword(password);

    // Optional: domain-based org verification
    let orgVerifiedAt: Date | null = null;
    let orgVerificationMethod: OrgVerificationMethod | null = null;
    const domain = email.split("@")[1]?.toLowerCase();
    if (domain) {
      const verifiedDomain = await prisma.organizationDomain.findUnique({
        where: { orgId_domain: { orgId, domain } },
      });
      if (verifiedDomain) {
        orgVerifiedAt = new Date();
        orgVerificationMethod = "DOMAIN";
      }
    }

    const user = await prisma.user.create({
      data: {
        orgId,
        email,
        passwordHash,
        role: Role.USER,
        orgVerifiedAt,
        orgVerificationMethod,
      },
    });

    const accessToken = signAccessToken({
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      email: user.email,
    });

    return res.status(201).json({
      user: { id: user.id, orgId: user.orgId, email: user.email, role: user.role },
      accessToken,
      tokenType: "Bearer",
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /v1/auth/login
 * - Verifies credentials
 * - Returns access token
 */
export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = getInput<{ body: typeof loginSchema.shape.body }>(res);
    const { email, password } = body!;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } });

    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } });

    const accessToken = signAccessToken({
      sub: user.id,
      orgId: user.orgId,
      role: user.role,
      email: user.email,
    });

    return res.status(200).json({
      user: { id: user.id, orgId: user.orgId, email: user.email, role: user.role },
      accessToken,
      tokenType: "Bearer",
    });
  } catch (err) {
    return next(err);
  }
}
