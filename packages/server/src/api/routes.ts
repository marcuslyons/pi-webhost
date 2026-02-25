/**
 * REST API routes for session management, model listing, and auth status.
 */

import { Hono } from "hono";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { AgentManager } from "../agent/manager.js";

export function createApiRoutes(agentManager: AgentManager) {
  const api = new Hono();

  // Health check
  api.get("/health", (c) => c.json({ status: "ok" }));

  // List available models (ones with valid API keys)
  api.get("/models", async (c) => {
    try {
      const models = await agentManager.getAvailableModels();
      return c.json({
        models: models.map((m) => ({
          provider: m.provider,
          id: m.id,
          name: m.name,
          reasoning: m.reasoning,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          cost: m.cost,
        })),
      });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // List active sessions
  api.get("/sessions", (c) => {
    return c.json({ sessions: agentManager.listSessions() });
  });

  // Auth status — which providers have credentials
  api.get("/auth/status", async (c) => {
    const authStorage = agentManager.getAuthStorage();
    const providers = ["anthropic", "openai", "google", "github-copilot"];
    const status: Record<string, { hasCredentials: boolean }> = {};

    for (const provider of providers) {
      try {
        const key = await authStorage.getApiKey(provider);
        status[provider] = { hasCredentials: !!key };
      } catch {
        status[provider] = { hasCredentials: false };
      }
    }

    return c.json({ providers: status });
  });

  // Server's default cwd and home directory
  api.get("/cwd", (c) => {
    return c.json({
      cwd: process.cwd(),
      home: homedir(),
    });
  });

  // Validate a directory path
  api.get("/validate-path", (c) => {
    const path = c.req.query("path");
    if (!path) {
      return c.json({ valid: false, error: "No path provided" });
    }
    try {
      const resolved = resolve(path.replace(/^~/, homedir()));
      if (!existsSync(resolved)) {
        return c.json({ valid: false, resolved, error: "Path does not exist" });
      }
      const stat = statSync(resolved);
      if (!stat.isDirectory()) {
        return c.json({ valid: false, resolved, error: "Path is not a directory" });
      }
      return c.json({ valid: true, resolved });
    } catch (err) {
      return c.json({ valid: false, error: String(err) });
    }
  });

  // List persisted sessions from disk
  api.get("/sessions/persisted", async (c) => {
    try {
      const cwd = c.req.query("cwd") ?? undefined;
      const sessions = await agentManager.listPersistedSessions(cwd);
      return c.json({ sessions });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  // Set a runtime API key (not persisted to disk)
  api.post("/auth/api-key", async (c) => {
    try {
      const body = await c.req.json<{ provider: string; apiKey: string }>();
      if (!body.provider || !body.apiKey) {
        return c.json({ error: "provider and apiKey required" }, 400);
      }
      agentManager.getAuthStorage().setRuntimeApiKey(body.provider, body.apiKey);
      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });

  return api;
}
