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
import { AgentManager } from "./agent/manager.js";
import { createApiRoutes } from "./api/routes.js";
import { createWSHandlers } from "./ws/handler.js";

const PORT = parseInt(process.env.PORT ?? "3141", 10);
const DEV = process.env.NODE_ENV !== "production";

const app = new Hono();
const agentManager = new AgentManager();

// WebSocket setup
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

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

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`
┌─────────────────────────────────────────┐
│  pi-webhost server                      │
│                                         │
│  http://localhost:${String(info.port).padEnd(24)}│
│  WebSocket: ws://localhost:${String(info.port).padEnd(13)}│${DEV ? "\n│  Mode: development                      │" : "\n│  Mode: production                       │"}
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
