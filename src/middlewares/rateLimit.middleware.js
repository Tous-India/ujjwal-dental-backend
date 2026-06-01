import rateLimit from "express-rate-limit";
import { RateLimitError } from "../utils/AppError.js";

/**
 * RATE LIMITING MIDDLEWARE
 *
 * - authLimiter:   strict limiter for authentication endpoints (brute-force / credential-stuffing protection)
 * - globalLimiter: looser limiter applied across the whole API surface
 *
 * Both bypass the test environment so the vitest suite (which logs in many times
 * from the same IP) is not throttled. Limit breaches are routed through the
 * existing RateLimitError -> global error middleware for a consistent response shape.
 */

const skipInTest = () => process.env.NODE_ENV === "test";

// Strict: 5 attempts per 15 minutes per IP
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: (req, res, next) => {
    next(new RateLimitError("Too many attempts. Please try again in 15 minutes."));
  },
});

// Loose: 300 requests per 15 minutes per IP
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  handler: (req, res, next) => {
    next(new RateLimitError());
  },
});
