/**
 * REST API routes for session management, model listing, and auth status.
 */

import { Hono } from "hono";
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
