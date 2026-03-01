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
}
