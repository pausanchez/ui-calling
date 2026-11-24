import type { UiEvent, UiSession } from "./types";

/** Persistence for sessions and events. Swap the in-memory default for Postgres, Redis, etc. */
export interface UiStore {
  createSession(session: UiSession, tokenHash: string): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<UiSession | undefined>;
  getSession(id: string): Promise<UiSession | undefined>;
  updateSession(id: string, patch: Partial<UiSession>): Promise<void>;
  appendEvent(event: UiEvent): Promise<void>;
  listEvents(query: { conversationId?: string; sessionId?: string }): Promise<UiEvent[]>;
}

export class MemoryStore implements UiStore {
  private sessions = new Map<string, UiSession>();
  private byToken = new Map<string, string>();
  private events: UiEvent[] = [];

  async createSession(session: UiSession, tokenHash: string) {
    this.sessions.set(session.id, session);
    this.byToken.set(tokenHash, session.id);
  }

  async getSessionByTokenHash(tokenHash: string) {
    const id = this.byToken.get(tokenHash);
    return id ? this.sessions.get(id) : undefined;
  }

  async getSession(id: string) {
    return this.sessions.get(id);
  }

  async updateSession(id: string, patch: Partial<UiSession>) {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, ...patch });
  }

  async appendEvent(event: UiEvent) {
    this.events.push(event);
  }

  async listEvents({ conversationId, sessionId }: { conversationId?: string; sessionId?: string }) {
    return this.events.filter(
      (e) => (!conversationId || e.conversationId === conversationId) && (!sessionId || e.sessionId === sessionId),
    );
  }
}
