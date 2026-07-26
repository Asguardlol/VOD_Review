import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { VodSession } from './types'
import {
  UnsupportedCapabilityError,
  type SessionStore,
  type SessionSummary,
  type StoreCapabilities,
} from './storage'
import { newId } from './ids'
import { normalizeSession } from './normalize'

interface VodReviewDB extends DBSchema {
  sessions: {
    key: string
    value: VodSession
    indexes: { 'by-updated': number }
  }
}

const DB_NAME = 'wow-vod-review'
/**
 * v2 replaced the v1 `reviews` store.
 *
 * v1 modelled a review as videos with per-pull offsets, which turned out to be
 * the wrong coordinate system — a stream is a whole raid night and the offset is
 * broadcast delay. Nothing shipped on v1, so the old store is dropped rather
 * than migrated; there is no user data to preserve and a migration would encode
 * a model that never worked.
 */
const DB_VERSION = 2

function openDatabase(): Promise<IDBPDatabase<VodReviewDB>> {
  return openDB<VodReviewDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (db.objectStoreNames.contains('reviews' as never)) {
        db.deleteObjectStore('reviews' as never)
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
        sessions.createIndex('by-updated', 'updatedAt')
      }
    },
  })
}

/**
 * IndexedDB-backed store. The only implementation that works on GitHub Pages,
 * which serves files and nothing else.
 *
 * Consequence worth being honest about: sessions live in one browser profile.
 * Clearing site data deletes them, and they do not follow the user to another
 * machine. Sharing is by exported JSON or an encoded URL, not by this store.
 */
export class LocalSessionStore implements SessionStore {
  readonly capabilities: StoreCapabilities = {
    remoteSharing: false,
    liveCollaboration: false,
  }

  #db: Promise<IDBPDatabase<VodReviewDB>> | undefined

  #open(): Promise<IDBPDatabase<VodReviewDB>> {
    this.#db ??= openDatabase()
    return this.#db
  }

  async listSessions(): Promise<SessionSummary[]> {
    const db = await this.#open()
    const all = await db.getAllFromIndex('sessions', 'by-updated')
    // The index is ascending; most-recently-touched first is what the UI wants.
    return all.reverse().map((s) => ({
      id: s.id,
      publicId: s.publicId,
      title: s.title,
      streamCount: s.streams?.length ?? 0,
      reportCode: s.report?.code,
      updatedAt: s.updatedAt,
    }))
  }

  async getSession(id: string): Promise<VodSession | undefined> {
    const db = await this.#open()
    const stored = await db.get('sessions', id)
    return stored ? normalizeSession(stored) : undefined
  }

  async createSession(): Promise<VodSession> {
    const now = Date.now()
    const session: VodSession = {
      id: newId(),
      title: 'Untitled night',
      streams: [],
      deaths: [],
      events: [],
      markers: [],
      createdAt: now,
      updatedAt: now,
    }
    const db = await this.#open()
    await db.put('sessions', session)
    return session
  }

  async saveSession(session: VodSession): Promise<void> {
    const db = await this.#open()
    await db.put('sessions', { ...session, updatedAt: Date.now() })
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.#open()
    await db.delete('sessions', id)
  }

  share(): Promise<string> {
    throw new UnsupportedCapabilityError('remoteSharing')
  }
}
