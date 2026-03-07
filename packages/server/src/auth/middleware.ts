/**
 * Optional authentication middleware.
 *
 * Activated by environment variables:
 *   PI_WEBHOST_AUTH_USER + PI_WEBHOST_AUTH_PASSWORD  → HTTP Basic Auth
 *   PI_WEBHOST_AUTH_TOKEN                            → Bearer token
 *
 * When no variables are set, all requests pass through (backward compatible).
 *
 * For WebSocket upgrade requests, auth is checked via:
 *   1. Authorization header (if the client sends one)
 *   2. ?token= query parameter (for browsers that can't set WS headers)
 */

import type { MiddlewareHandler } from "hono";

export function createAuthMiddleware(): MiddlewareHandler | null {
  const user = process.env.PI_WEBHOST_AUTH_USER;
  const password = process.env.PI_WEBHOST_AUTH_PASSWORD;
  const token = process.env.PI_WEBHOST_AUTH_TOKEN;

  const hasBasicAuth = !!(user && password);
  const hasTokenAuth = !!token;

  if (!hasBasicAuth && !hasTokenAuth) {
    return null; // No auth configured
  }

  // Pre-compute the expected Basic auth header value
  const expectedBasic = hasBasicAuth
    ? "Basic " + Buffer.from(`${user}:${password}`).toString("base64")
    : null;

  return async (c, next) => {
    const authHeader = c.req.header("Authorization");

    // Check Bearer token
    if (hasTokenAuth && authHeader === `Bearer ${token}`) {
      return next();
    }

    // Check Basic auth
    if (hasBasicAuth && authHeader === expectedBasic) {
      return next();
    }

    // Check query parameter token (for WebSocket connections)
    const queryToken = c.req.query("token");
    if (hasTokenAuth && queryToken === token) {
      return next();
    }

    // No valid credentials
    if (hasBasicAuth) {
      c.header("WWW-Authenticate", 'Basic realm="pi-webhost"');
    }
    return c.text("Unauthorized", 401);
  };
}
