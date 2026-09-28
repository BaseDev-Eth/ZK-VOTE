// @ts-nocheck
/**
 * CSRF Origin Validation Middleware
 *
 * Validates the Origin header for sensitive endpoints (pay, swap, ramp)
 * to prevent CSRF attacks. This is in addition to the CSRF token validation.
 */

import { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

/**
 * Check if the request Origin header matches allowed CORS origins.
 */
export function csrfOriginGuard(req: Request, res: Response, next: NextFunction): void {
  // Only apply to state-changing methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin;
  const referer = req.headers.referer;

  // If no Origin header, check Referer as fallback
  const requestOrigin = origin || (referer ? new URL(referer).origin : null);

  // Allow requests with no origin/referer (e.g., curl, server-to-server)
  if (!requestOrigin) {
    return next();
  }

  const allowedOrigins = config.corsOrigins === "*" ? ["*"] : Array.isArray(config.corsOrigins) ? config.corsOrigins : [config.corsOrigins];

  // In development with wildcard, allow all
  if (allowedOrigins.includes("*") && process.env.NODE_ENV !== "production") {
    return next();
  }

  // In production, enforce strict origin checking
  if (process.env.NODE_ENV === "production") {
    if (!allowedOrigins.includes("*") && !allowedOrigins.includes(requestOrigin)) {
      res.status(403).json({
        error: "Forbidden",
        message: "Origin not allowed",
      });
      return;
    }
  }

  next();
}
