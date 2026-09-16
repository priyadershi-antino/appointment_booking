import type { Response } from 'express';
import {
  buildPaginationMeta,
  type ApiErrorDetail,
  type ApiResponse,
  type ErrorCode,
  type PaginationMeta,
} from '@booking/shared';

/**
 * Every response leaves through one of these helpers, so the envelope shape in
 * packages/shared is guaranteed rather than merely intended.
 */
export function ok<T>(res: Response, data: T, message?: string): Response {
  const body: ApiResponse<T> = { success: true, data, ...(message ? { message } : {}) };
  return res.status(200).json(body);
}

export function created<T>(res: Response, data: T, message?: string): Response {
  const body: ApiResponse<T> = { success: true, data, ...(message ? { message } : {}) };
  return res.status(201).json(body);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

export function paginated<T>(
  res: Response,
  items: T[],
  page: number,
  pageSize: number,
  total: number,
  message?: string,
): Response {
  const meta: PaginationMeta = buildPaginationMeta(page, pageSize, total);
  const body: ApiResponse<T[]> = {
    success: true,
    data: items,
    meta,
    ...(message ? { message } : {}),
  };
  return res.status(200).json(body);
}

export function fail(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: ApiErrorDetail[],
  requestId?: string,
): Response {
  const body: ApiResponse<never> = {
    success: false,
    error: {
      code,
      message,
      ...(details?.length ? { details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  };
  return res.status(status).json(body);
}
