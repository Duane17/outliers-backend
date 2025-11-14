// src/types/express.d.ts
import "express";

declare global {
  namespace Express {
    interface UserJwt {
      sub: string;       // user id
      orgId: string;
      role: "OWNER" | "ADMIN" | "USER" | "AUDITOR";
      email: string;
    }

    interface ApiKeyAuth {
      apiKeyId: string;  // ApiKey.id
      orgId: string;
      scopes: string[];
    }

    interface Request {
      user?: UserJwt;
      apiKeyAuth?: ApiKeyAuth;
    }
  }
}
