/**
 * AgentManager wraps Pi's SDK to manage agent sessions.
 * Each WebSocket connection gets its own AgentSession.
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

export interface ManagedSession {
  id: string;
  session: AgentSession;
  cwd: string;
  createdAt: Date;
}

export class AgentManager {
  private sessions = new Map<string, ManagedSession>();
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;

  constructor() {
    // Use Pi's default auth storage (reads from ~/.pi/agent/auth.json + env vars)
    this.authStorage = AuthStorage.create();
    this.modelRegistry = new ModelRegistry(this.authStorage);
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
    for (const [id] of this.sessions) {
      const managed = this.sessions.get(id);
      if (managed) {
        managed.session.dispose();
      }
    }
    this.sessions.clear();
  }
}
