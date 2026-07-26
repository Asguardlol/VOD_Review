import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { VodReview } from './types'
import {
  UnsupportedCapabilityError,
  type ReviewStore,
  type ReviewSummary,
  type StoreCapabilities,
} from './storage'
import { newId } from './ids'

interface VodReviewDB extends DBSchema {
  reviews: {
    key: string
    value: VodReview
    indexes: { 'by-updated': number }
  }
}

const DB_NAME = 'wow-vod-review'
const DB_VERSION = 1

function openDatabase(): Promise<IDBPDatabase<VodReviewDB>> {
  return openDB<VodReviewDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const reviews = db.createObjectStore('reviews', { keyPath: 'id' })
      reviews.createIndex('by-updated', 'updatedAt')
    },
  })
}

/**
 * IndexedDB-backed store. The only implementation that works on GitHub Pages,
 * which serves files and nothing else.
 *
 * Consequence worth being honest about: reviews live in one browser profile.
 * Clearing site data deletes them, and they do not follow the user to another
 * machine. Sharing is by exported JSON or an encoded URL, not by this store.
 */
export class LocalReviewStore implements ReviewStore {
  readonly capabilities: StoreCapabilities = {
    remoteSharing: false,
    liveCollaboration: false,
  }

  #db: Promise<IDBPDatabase<VodReviewDB>> | undefined

  #open(): Promise<IDBPDatabase<VodReviewDB>> {
    this.#db ??= openDatabase()
    return this.#db
  }

  async listReviews(): Promise<ReviewSummary[]> {
    const db = await this.#open()
    const all = await db.getAllFromIndex('reviews', 'by-updated')
    // The index is ascending; most-recently-touched first is what the UI wants.
    return all.reverse().map((r) => ({
      id: r.id,
      publicId: r.publicId,
      title: r.title,
      povCount: r.povs.length,
      updatedAt: r.updatedAt,
    }))
  }

  async getReview(id: string): Promise<VodReview | undefined> {
    const db = await this.#open()
    return db.get('reviews', id)
  }

  async createReview(title: string): Promise<VodReview> {
    const now = Date.now()
    const review: VodReview = {
      id: newId(),
      title,
      guilds: [],
      povs: [],
      markers: [],
      createdAt: now,
      updatedAt: now,
    }
    const db = await this.#open()
    await db.put('reviews', review)
    return review
  }

  async saveReview(review: VodReview): Promise<void> {
    const db = await this.#open()
    await db.put('reviews', { ...review, updatedAt: Date.now() })
  }

  async deleteReview(id: string): Promise<void> {
    const db = await this.#open()
    await db.delete('reviews', id)
  }

  share(): Promise<string> {
    throw new UnsupportedCapabilityError('remoteSharing')
  }
}
