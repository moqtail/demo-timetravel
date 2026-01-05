export interface TelemetryEntry {
  id?: number
  sessionId: string
  userId: string
  streamType: 'video' | 'audio' | 'latency'
  timestamp: number
  value: number
}

class TelemetryDB {
  private db: IDBDatabase | null = null
  private dbPromise: Promise<IDBDatabase> | null = null

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db

    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('TelemetryDB', 1)

        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          this.db = request.result
          resolve(request.result)
        }

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result
          const store = db.createObjectStore('telemetry', { keyPath: 'id', autoIncrement: true })

          store.createIndex('sessionId', 'sessionId', { unique: false })
          store.createIndex('userId', 'userId', { unique: false })
          store.createIndex('streamType', 'streamType', { unique: false })
          store.createIndex('timestamp', 'timestamp', { unique: false })
          store.createIndex('sessionUserStream', ['sessionId', 'userId', 'streamType'], { unique: false })
        }
      })
    }

    return this.dbPromise
  }

  async addEntry(entry: Omit<TelemetryEntry, 'id'>): Promise<void> {
    const db = await this.openDB()
    const transaction = db.transaction(['telemetry'], 'readwrite')
    const store = transaction.objectStore('telemetry')
    await new Promise<void>((resolve, reject) => {
      const request = store.add(entry)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getEntries(
    sessionId?: string,
    userId?: string,
    streamType?: 'video' | 'audio' | 'latency',
    limit?: number,
  ): Promise<TelemetryEntry[]> {
    const db = await this.openDB()
    const transaction = db.transaction(['telemetry'], 'readonly')
    const store = transaction.objectStore('telemetry')

    return new Promise((resolve, reject) => {
      let request: IDBRequest

      if (sessionId && userId && streamType) {
        const index = store.index('sessionUserStream')
        const range = IDBKeyRange.only([sessionId, userId, streamType])
        request = index.openCursor(range)
      } else if (sessionId) {
        const index = store.index('sessionId')
        request = index.openCursor(IDBKeyRange.only(sessionId))
      } else if (userId) {
        const index = store.index('userId')
        request = index.openCursor(IDBKeyRange.only(userId))
      } else if (streamType) {
        const index = store.index('streamType')
        request = index.openCursor(IDBKeyRange.only(streamType))
      } else {
        request = store.openCursor()
      }

      const results: TelemetryEntry[] = []

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          results.push(cursor.value)
          if (!limit || results.length < limit) {
            cursor.continue()
          } else {
            resolve(results)
          }
        } else {
          resolve(results)
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async getSessions(): Promise<string[]> {
    const db = await this.openDB()
    const transaction = db.transaction(['telemetry'], 'readonly')
    const store = transaction.objectStore('telemetry')
    const index = store.index('sessionId')

    return new Promise((resolve, reject) => {
      const request = index.openKeyCursor()
      const sessions = new Set<string>()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          sessions.add(cursor.key as string)
          cursor.continue()
        } else {
          resolve(Array.from(sessions).sort())
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async getUsers(sessionId?: string): Promise<string[]> {
    const db = await this.openDB()
    const transaction = db.transaction(['telemetry'], 'readonly')
    const store = transaction.objectStore('telemetry')

    return new Promise((resolve, reject) => {
      let request: IDBRequest

      if (sessionId) {
        const index = store.index('sessionId')
        request = index.openCursor(IDBKeyRange.only(sessionId))
      } else {
        request = store.openCursor()
      }

      const users = new Set<string>()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          users.add(cursor.value.userId)
          cursor.continue()
        } else {
          resolve(Array.from(users).sort())
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async clearOldData(keepDays: number = 30): Promise<void> {
    const db = await this.openDB()
    const transaction = db.transaction(['telemetry'], 'readwrite')
    const store = transaction.objectStore('telemetry')
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000

    return new Promise((resolve, reject) => {
      const request = store.openCursor()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          if (cursor.value.timestamp < cutoff) {
            cursor.delete()
          }
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = () => reject(request.error)
    })
  }
}

export const telemetryDB = new TelemetryDB()
