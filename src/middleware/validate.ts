// src/middleware/validate.ts
import type { RequestHandler } from "express";
import { z } from "zod";

/** Which request parts we can validate */
type Part = "body" | "query" | "params" | "headers";

/** Zod schemas for each request part (provide only what you need) */
export type RequestSchemas = Partial<Record<Part, z.ZodTypeAny>>;

/**
 * validate(schemas)
 * - Parses & validates the provided request parts using Zod
 * - On success, attaches typed values to res.locals.input
 * - On failure, throws ZodError → your centralized error handler returns 400
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, res, next) => {
    try {
      const parsed: Record<string, unknown> = {};

      if (schemas.body) {
        // Note: always parse; do not trust raw req.body
        parsed.body = schemas.body.parse(req.body);
      }

      if (schemas.query) {
        // Express query values are strings/string[]; let the schema coerce as needed
        parsed.query = schemas.query.parse(req.query);
      }

      if (schemas.params) {
        parsed.params = schemas.params.parse(req.params);
      }

      if (schemas.headers) {
        // Node lowercases all incoming header keys
        parsed.headers = schemas.headers.parse(req.headers);
      }

      // Make the parsed inputs available to downstream handlers
      (res.locals as any).input = parsed;

      return next();
    } catch (err) {
      return next(err); // ZodError handled by centralized error middleware
    }
  };
}

/**
 * Helper type to infer the parsed shapes in handlers:
 *
 *   const { body, query } = getInput<typeof MySchema>(res);
 */
export type InputOf<TSchemas extends RequestSchemas> = {
  [K in keyof TSchemas]?: TSchemas[K] extends z.ZodTypeAny ? z.infer<TSchemas[K]> : never;
};
export function getInput<TSchemas extends RequestSchemas>(res: any): InputOf<TSchemas> {
  return (res.locals?.input ?? {}) as InputOf<TSchemas>;
}

/** Common pagination schema for index/list endpoints */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(64).optional(),
  order: z.enum(["asc", "desc"]).optional().default("asc"),
});
