/**
 * pi-webhost server
 *
 * Serves the web UI and provides WebSocket + REST API
 * for interacting with Pi agent sessions.
 */

import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync, existsSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { AgentManager } from "./agent/manager.js";
import { createApiRoutes } from "./api/routes.js";
import { createWSHandlers } from "./ws/handler.js";
import { createAuthMiddleware } from "./auth/middleware.js";

const PORT = parseInt(process.env.PORT ?? "3141", 10);
const DEV = process.env.NODE_ENV !== "production";

const app = new Hono();
const agentManager = new AgentManager();

// WebSocket setup
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Optional authentication
const authMiddleware = createAuthMiddleware();
if (authMiddleware) {
  app.use("*", authMiddleware);
  console.log("[auth] Authentication enabled");
}

// CORS for dev (Vite runs on different port)
if (DEV) {
  app.use(
    "/api/*",
    cors({
      origin: ["http://localhost:5173", "http://localhost:3141"],
      credentials: true,
    }),
  );
}

// REST API
app.route("/api", createApiRoutes(agentManager));

// WebSocket endpoint
app.get(
  "/ws",
  upgradeWebSocket(() => createWSHandlers(agentManager)),
);

// Serve static files in production
if (!DEV) {
  app.use("/*", serveStatic({ root: "../web/dist" }));
  // SPA fallback
  app.get("*", serveStatic({ root: "../web/dist", path: "index.html" }));
}

// Restore sessions from manifest before accepting connections
agentManager.loadManifest().then(() => {
  const restored = agentManager.listSessions().length;
  if (restored > 0) {
    console.log(`[startup] Restored ${restored} session(s) from manifest`);
  }
}).catch((err) => {
  console.warn("[startup] Manifest load error:", err);
});

// TLS configuration
const tlsCertPath = process.env.PI_WEBHOST_TLS_CERT;
const tlsKeyPath = process.env.PI_WEBHOST_TLS_KEY;
const useTLS = !!(tlsCertPath && tlsKeyPath);

if (useTLS) {
  if (!existsSync(tlsCertPath!)) {
    console.error(`[tls] Certificate file not found: ${tlsCertPath}`);
    process.exit(1);
  }
  if (!existsSync(tlsKeyPath!)) {
    console.error(`[tls] Key file not found: ${tlsKeyPath}`);
    process.exit(1);
  }
}

const serveOptions: Parameters<typeof serve>[0] = {
  fetch: app.fetch,
  port: PORT,
  ...(useTLS
    ? {
        createServer: createHttpsServer,
        serverOptions: {
          cert: readFileSync(tlsCertPath!),
          key: readFileSync(tlsKeyPath!),
        },
      }
    : {}),
};

const protocol = useTLS ? "https" : "http";
const wsProtocol = useTLS ? "wss" : "ws";

const server = serve(serveOptions, (info) => {
  console.log(`
┌─────────────────────────────────────────┐
│  pi-webhost server                      │
│                                         │
│  ${protocol}://localhost:${String(info.port).padEnd(24 - protocol.length + 4)}│
│  ${wsProtocol}://localhost:${String(info.port).padEnd(19 - wsProtocol.length + 4)}│${DEV ? "\n│  Mode: development                      │" : "\n│  Mode: production                       │"}${useTLS ? "\n│  TLS: enabled                           │" : ""}
└─────────────────────────────────────────┘
`);
});

injectWebSocket(server);

// Graceful shutdown
function shutdown() {
  console.log("\nShutting down...");
  agentManager.dispose();
  server.close(() => {
    process.exit(0);
  });
  // Force exit if close hangs (e.g. open WebSocket connections)
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
