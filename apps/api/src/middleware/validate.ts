import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

/**
 * Backend validation is not a second opinion — it is the only opinion that counts.
 *
 * The same schemas are used by the web forms, so the client gets immediate feedback, but
 * nothing reaches a service without passing through here. Parsed values REPLACE the raw
 * input, so downstream code receives coerced, trimmed, normalised data (numbers as
 * numbers, emails lowercased) rather than whatever arrived on the wire.
 */
interface ValidationTargets {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function validate(schemas: ValidationTargets) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }
      if (schemas.query) {
        // Express 5 exposes `query` via a getter, so assign onto the parsed cache instead.
        Object.defineProperty(req, 'query', {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Convenience wrappers for the common single-target cases. */
export const validateBody = (schema: ZodTypeAny) => validate({ body: schema });
export const validateQuery = (schema: ZodTypeAny) => validate({ query: schema });
export const validateParams = (schema: ZodTypeAny) => validate({ params: schema });

/** Typed accessors so controllers do not need casts after validation. */
export function body<T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> {
  return req.body as z.infer<T>;
}

export function query<T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> {
  return req.query as unknown as z.infer<T>;
}

export function params<T extends ZodTypeAny>(req: Request, _schema: T): z.infer<T> {
  return req.params as unknown as z.infer<T>;
}
