export interface OrgUser {
  name: string
  tag: string
  group: string[]
}

export interface UserSnapshot {
  id: number
  createdAt: string
  usersJson: string
  names: string[]
  userCount: number
}

const DB_NAME = 'feishu-org-diff'
const DB_VERSION = 1
const STORE_NAME = 'userSnapshots'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb (): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return dbPromise
}

function transactionDone (transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

export async function saveSnapshot (users: OrgUser[]): Promise<UserSnapshot> {
  const db = await openDb()
  const snapshot: UserSnapshot = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    usersJson: JSON.stringify(users),
    names: [...new Set(users.map(user => user.name).filter(Boolean))],
    userCount: users.length,
  }
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  transaction.objectStore(STORE_NAME).add(snapshot)
  await transactionDone(transaction)

  return snapshot
}

export async function getSnapshots (): Promise<UserSnapshot[]> {
  const db = await openDb()

  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .getAll()

    request.onsuccess = () => {
      resolve((request.result as UserSnapshot[]).sort((a, b) => b.id - a.id))
    }
    request.onerror = () => reject(request.error)
  })
}

export async function deleteSnapshot (id: number): Promise<void> {
  const db = await openDb()
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  transaction.objectStore(STORE_NAME).delete(id)
  await transactionDone(transaction)
}

export async function clearSnapshots (): Promise<void> {
  const db = await openDb()
  const transaction = db.transaction(STORE_NAME, 'readwrite')
  transaction.objectStore(STORE_NAME).clear()
  await transactionDone(transaction)
}

export function parseSnapshotUsers (snapshot?: UserSnapshot): OrgUser[] {
  if (!snapshot) return []

  try {
    return JSON.parse(snapshot.usersJson) as OrgUser[]
  }
  catch {
    return []
  }
}
