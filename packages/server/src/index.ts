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
import { networkInterfaces } from "node:os";
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

// CORS for dev (Vite runs on different port, possibly from LAN)
if (DEV) {
  app.use(
    "/api/*",
    cors({
      origin: (origin) => {
        // Allow requests with no origin (e.g. server-to-server, curl)
        if (!origin) return origin;
        try {
          const url = new URL(origin);
          // Allow any host on the Vite or server dev ports
          if (url.port === "5173" || url.port === String(PORT)) {
            return origin;
          }
        } catch {}
        return undefined;
      },
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
  hostname: "0.0.0.0",
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

function getLanAddress(): string | null {
  const nets = networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

const server = serve(serveOptions, (info) => {
  const lanIp = getLanAddress();
  const portStr = String(info.port);
  const lines = [
    `  ${protocol}://localhost:${portStr}`,
    ...(lanIp ? [`  ${protocol}://${lanIp}:${portStr}`] : []),
    `  ${wsProtocol}://localhost:${portStr}`,
    ...(lanIp ? [`  ${wsProtocol}://${lanIp}:${portStr}`] : []),
    `  Mode: ${DEV ? "development" : "production"}`,
    ...(useTLS ? ["  TLS: enabled"] : []),
  ];
  const maxLen = Math.max(...lines.map((l) => l.length));
  const width = Math.max(maxLen + 2, 41);
  const header = "  pi-webhost server";
  console.log(
    "\n┌" + "─".repeat(width) + "┐\n" +
    "│" + header + " ".repeat(width - header.length) + "│\n" +
    "│" + " ".repeat(width) + "│\n" +
    lines.map((l) => "│" + l + " ".repeat(width - l.length) + "│").join("\n") + "\n" +
    "└" + "─".repeat(width) + "┘\n"
  );
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
