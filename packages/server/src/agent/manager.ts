/**
 * AgentManager wraps Pi's SDK to manage the server-owned session pool.
 * Sessions persist independent of WebSocket connections — clients attach
 * and detach as observers. Sessions are only destroyed explicitly via
 * destroySession().
 */

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { nanoid } from "nanoid";
import { readFile, writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Serialize Pi events for JSON transport.
 */
function serializeEvent(event: any): any {
  try {
    return JSON.parse(JSON.stringify(event));
  } catch {
    return { type: event.type, error: "Failed to serialize event" };
  }
}

export interface ManagedSession {
  id: string;
  session: AgentSession;
  cwd: string;
  createdAt: Date;
}

/** Opaque handle for a connected client (used for broadcasting). */
export interface ClientHandle {
  send: (data: string) => void;
}

type EventBroadcaster = (sessionId: string, event: any) => void;

export class AgentManager {
  private sessions = new Map<string, ManagedSession>();
  /** Per-session subscriber sets: sessionId → Set<ClientHandle>. */
  private subscribers = new Map<string, Set<ClientHandle>>();
  /** Per-session unsubscribers for the AgentSession event subscription. */
  private sessionUnsubscribers = new Map<string, () => void>();
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;

  constructor() {
    // Use Pi's default auth storage (reads from ~/.pi/agent/auth.json + env vars)
    this.authStorage = AuthStorage.create();
    this.modelRegistry = new ModelRegistry(this.authStorage);
  }

  /**
   * Attach a client to a session. The client will receive all events
   * for this session via its send() method.
   */
  attachClient(sessionId: string, client: ClientHandle): void {
    let subs = this.subscribers.get(sessionId);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(sessionId, subs);
    }
    subs.add(client);
  }

  /**
   * Detach a client from a session. The session keeps running.
   */
  detachClient(sessionId: string, client: ClientHandle): void {
    const subs = this.subscribers.get(sessionId);
    if (subs) {
      subs.delete(client);
      if (subs.size === 0) this.subscribers.delete(sessionId);
    }
  }

  /**
   * Detach a client from ALL sessions. Called on WebSocket close.
   */
  detachAllForClient(client: ClientHandle): void {
    for (const [, subs] of this.subscribers) {
      subs.delete(client);
    }
  }

  /**
   * Broadcast a JSON event to all clients attached to a session.
   */
  broadcastEvent(sessionId: string, data: unknown): void {
    const subs = this.subscribers.get(sessionId);
    if (!subs) return;
    const json = JSON.stringify(data);
    for (const client of subs) {
      try {
        client.send(json);
      } catch {
        // Client disconnected — will be cleaned up on onClose
      }
    }
  }

  /**
   * Set up the internal event subscription for a session.
   * Called once when the session is created/opened. Broadcasts to all
   * attached clients.
   */
  private setupSessionSubscription(sessionId: string, managed: ManagedSession): void {
    // Don't double-subscribe
    if (this.sessionUnsubscribers.has(sessionId)) return;

    const unsub = managed.session.subscribe((event) => {
      this.broadcastEvent(sessionId, {
        type: "event",
        sessionId,
        event: serializeEvent(event),
      });
    });

    this.sessionUnsubscribers.set(sessionId, unsub);
  }

  getAuthStorage(): AuthStorage {
    return this.authStorage;
  }

  getModelRegistry(): ModelRegistry {
    return this.modelRegistry;
  }

  async createSession(options?: {
    cwd?: string;
    sessionId?: string;
  }): Promise<ManagedSession> {
    const id = options?.sessionId ?? nanoid();
    const cwd = options?.cwd ?? process.cwd();

    const settingsManager = SettingsManager.create(cwd);

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      settingsManager,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.create(cwd),
      settingsManager,
    });

    const managed: ManagedSession = {
      id,
      session,
      cwd,
      createdAt: new Date(),
    };

    this.sessions.set(id, managed);
    this.setupSessionSubscription(id, managed);
    this.scheduleSaveManifest();
    return managed;
  }

  getSession(id: string): ManagedSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): Array<{
    id: string;
    cwd: string;
    createdAt: Date;
    isStreaming: boolean;
    model: string | undefined;
  }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      createdAt: s.createdAt,
      isStreaming: s.session.isStreaming,
      model: s.session.model?.name,
    }));
  }

  async destroySession(id: string): Promise<void> {
    const managed = this.sessions.get(id);
    if (managed) {
      // Clean up internal subscription
      const unsub = this.sessionUnsubscribers.get(id);
      if (unsub) {
        unsub();
        this.sessionUnsubscribers.delete(id);
      }
      this.subscribers.delete(id);

      await managed.session.abort();
      managed.session.dispose();
      this.sessions.delete(id);
      this.scheduleSaveManifest();
    }
  }

  /**
   * Open an existing persisted session by file path.
   */
  async openSession(sessionPath: string, options?: {
    sessionId?: string;
  }): Promise<ManagedSession> {
    const id = options?.sessionId ?? nanoid();
    // Derive cwd from SessionManager.open if possible, default to process.cwd()
    const cwd = process.cwd();

    const settingsManager = SettingsManager.create(cwd);

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      settingsManager,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.open(sessionPath),
      settingsManager,
    });

    const managed: ManagedSession = {
      id,
      session,
      cwd,
      createdAt: new Date(),
    };

    this.sessions.set(id, managed);
    this.setupSessionSubscription(id, managed);
    this.scheduleSaveManifest();
    return managed;
  }

  /**
   * List persisted sessions from disk for a given cwd.
   */
  async listPersistedSessions(cwd?: string) {
    const dir = cwd ?? process.cwd();
    const sessions = await SessionManager.list(dir);
    return sessions.map((s) => ({
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created.toISOString(),
      modified: s.modified.toISOString(),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage,
    }));
  }

  /**
   * Rename a live session. Uses Pi's built-in session naming
   * (appends a session_info entry to the JSONL file).
   */
  renameSession(id: string, name: string): void {
    const managed = this.sessions.get(id);
    if (!managed) {
      throw new Error(`Session not found: ${id}`);
    }
    managed.session.setSessionName(name);
  }

  /**
   * Rename a persisted (not live) session by opening it temporarily,
   * setting the name, and disposing immediately.
   */
  async renamePersistedSession(sessionPath: string, name: string): Promise<void> {
    // Check if this session is already live — if so, use the live instance
    for (const managed of this.sessions.values()) {
      if (managed.session.sessionFile === sessionPath) {
        managed.session.setSessionName(name);
        return;
      }
    }

    // Not live: open temporarily, rename, dispose
    const cwd = process.cwd();
    const settingsManager = SettingsManager.create(cwd);
    const resourceLoader = new DefaultResourceLoader({ cwd, settingsManager });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.open(sessionPath),
      settingsManager,
    });

    session.setSessionName(name);
    session.dispose();
  }

  /**
   * Delete a persisted session file from disk.
   * Refuses to delete sessions that are currently live.
   */
  async deletePersistedSession(sessionPath: string): Promise<void> {
    // Block deletion of live sessions
    for (const managed of this.sessions.values()) {
      if (managed.session.sessionFile === sessionPath) {
        throw new Error("Cannot delete a session that is currently open. Close it first.");
      }
    }

    await unlink(sessionPath);
  }

  async getAvailableModels() {
    return this.modelRegistry.getAvailable();
  }

  dispose(): void {
    for (const [, unsub] of this.sessionUnsubscribers) {
      unsub();
    }
    this.sessionUnsubscribers.clear();
    this.subscribers.clear();

    for (const [, managed] of this.sessions) {
      managed.session.dispose();
    }
    this.sessions.clear();
  }

  // ── Manifest persistence ──────────────────────────────────────────

  private static MANIFEST_DIR = join(homedir(), ".pi", "agent", "pi-webhost");
  private static MANIFEST_FILE = join(AgentManager.MANIFEST_DIR, "active-sessions.json");
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Save the current active session pool to a manifest file.
   * Debounced — multiple calls within 1s are coalesced.
   */
  scheduleSaveManifest(): void {
    if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      this.saveManifest().catch((err) => {
        console.error("[manifest] Failed to save:", err);
      });
    }, 1000);
  }

  private async saveManifest(): Promise<void> {
    const manifest = {
      sessions: Array.from(this.sessions.values())
        .filter((m) => m.session.sessionFile) // Only save sessions that have persisted files
        .map((m) => ({
          sessionPath: m.session.sessionFile!,
          cwd: m.cwd,
          model: m.session.model
            ? { provider: m.session.model.provider, id: m.session.model.id }
            : null,
          thinkingLevel: m.session.thinkingLevel,
        })),
    };

    await mkdir(AgentManager.MANIFEST_DIR, { recursive: true });
    const tmpPath = AgentManager.MANIFEST_FILE + ".tmp";
    await writeFile(tmpPath, JSON.stringify(manifest, null, 2));
    await rename(tmpPath, AgentManager.MANIFEST_FILE);
  }

  /**
   * Load the manifest and reopen all sessions from it.
   * Called once on server startup.
   */
  async loadManifest(): Promise<void> {
    let data: string;
    try {
      data = await readFile(AgentManager.MANIFEST_FILE, "utf-8");
    } catch {
      // No manifest or can't read — start with empty pool
      return;
    }

    let manifest: { sessions: Array<{
      sessionPath: string;
      cwd: string;
      model?: { provider: string; id: string } | null;
      thinkingLevel?: string;
    }> };

    try {
      manifest = JSON.parse(data);
    } catch {
      console.warn("[manifest] Corrupt manifest file, starting with empty pool");
      return;
    }

    if (!Array.isArray(manifest?.sessions)) return;

    for (const entry of manifest.sessions) {
      try {
        const managed = await this.openSession(entry.sessionPath);
        console.log(`[manifest] Restored session: ${entry.sessionPath}`);

        // Restore model if specified
        if (entry.model) {
          const model = this.modelRegistry.find(entry.model.provider, entry.model.id);
          if (model) {
            await managed.session.setModel(model);
          }
        }

        // Restore thinking level
        if (entry.thinkingLevel) {
          managed.session.setThinkingLevel(entry.thinkingLevel as any);
        }
      } catch (err) {
        console.warn(`[manifest] Failed to restore session ${entry.sessionPath}:`, err);
      }
    }
  }
}
