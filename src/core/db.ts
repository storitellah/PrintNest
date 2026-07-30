import type { Project, RecentProjectEntry } from './types.ts';

/**
 * Local storage.
 *
 * Two object stores:
 *   `projects` — the JSON documents, keyed by project id.
 *   `assets`   — the binary payloads, keyed by asset id, with the owning
 *                project id indexed so deleting a project can sweep its blobs.
 *
 * A small `meta` store holds session recovery state and app preferences.
 *
 * Nothing here ever leaves the device.
 */

const DB_NAME = 'printnest';
const DB_VERSION = 1;

const STORE_PROJECTS = 'projects';
const STORE_ASSETS = 'assets';
const STORE_META = 'meta';

export interface StoredAsset {
  id: string;
  projectId: string;
  blob: Blob;
  type: string;
  name: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function isStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!isStorageAvailable()) {
      reject(new Error('This browser has no IndexedDB, so projects cannot be saved locally.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        const store = db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        store.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A second tab running a newer version needs this one to let go.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open the local project database.'));
    request.onblocked = () =>
      reject(new Error('Another PrintNest tab is holding the database open. Close it and retry.'));
  });
  return dbPromise;
}

function runTransaction<T>(
  storeNames: string[],
  mode: IDBTransactionMode,
  work: (stores: Record<string, IDBObjectStore>) => Promise<T> | T,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeNames, mode);
        const stores: Record<string, IDBObjectStore> = {};
        for (const name of storeNames) stores[name] = tx.objectStore(name);

        let result: T;
        let settled = false;
        tx.oncomplete = () => {
          if (!settled) {
            settled = true;
            resolve(result);
          }
        };
        tx.onerror = () => {
          if (!settled) {
            settled = true;
            reject(tx.error ?? new Error('The local database rejected the change.'));
          }
        };
        tx.onabort = () => {
          if (!settled) {
            settled = true;
            reject(tx.error ?? new Error('The database change was cancelled.'));
          }
        };

        Promise.resolve(work(stores))
          .then((value) => {
            result = value;
          })
          .catch((error: unknown) => {
            settled = true;
            try {
              tx.abort();
            } catch {
              /* already finished */
            }
            reject(error);
          });
      }),
  );
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Database request failed.'));
  });
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export async function saveProject(project: Project): Promise<void> {
  // Structured clone would reject anything non-serialisable; JSON round-trip
  // guarantees the stored document is exactly what an export would produce.
  const plain = JSON.parse(JSON.stringify(project)) as Project;
  await runTransaction([STORE_PROJECTS], 'readwrite', (stores) =>
    request(stores[STORE_PROJECTS]!.put(plain)),
  );
}

export async function loadProject(id: string): Promise<Project | null> {
  return runTransaction([STORE_PROJECTS], 'readonly', async (stores) => {
    const value = await request<Project | undefined>(stores[STORE_PROJECTS]!.get(id));
    return value ?? null;
  });
}

export async function deleteProject(id: string): Promise<void> {
  await runTransaction([STORE_PROJECTS, STORE_ASSETS], 'readwrite', async (stores) => {
    await request(stores[STORE_PROJECTS]!.delete(id));
    const index = stores[STORE_ASSETS]!.index('projectId');
    const keys = await request<IDBValidKey[]>(index.getAllKeys(IDBKeyRange.only(id)));
    for (const key of keys) await request(stores[STORE_ASSETS]!.delete(key as string));
  });
}

export async function listProjects(): Promise<RecentProjectEntry[]> {
  const projects = await runTransaction([STORE_PROJECTS], 'readonly', (stores) =>
    request<Project[]>(stores[STORE_PROJECTS]!.getAll()),
  );
  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      kind: project.kind,
      updatedAt: project.updatedAt,
      pinned: Boolean(project.pinned),
      pageCount: project.pages?.length ?? 0,
    }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
}

/* ------------------------------------------------------------------ *
 * Assets
 * ------------------------------------------------------------------ */

export async function putAsset(asset: StoredAsset): Promise<void> {
  await runTransaction([STORE_ASSETS], 'readwrite', (stores) =>
    request(stores[STORE_ASSETS]!.put(asset)),
  );
}

export async function getAsset(id: string): Promise<StoredAsset | null> {
  return runTransaction([STORE_ASSETS], 'readonly', async (stores) => {
    const value = await request<StoredAsset | undefined>(stores[STORE_ASSETS]!.get(id));
    return value ?? null;
  });
}

export async function getProjectAssets(projectId: string): Promise<StoredAsset[]> {
  return runTransaction([STORE_ASSETS], 'readonly', (stores) =>
    request<StoredAsset[]>(
      stores[STORE_ASSETS]!.index('projectId').getAll(IDBKeyRange.only(projectId)),
    ),
  );
}

export async function deleteAsset(id: string): Promise<void> {
  await runTransaction([STORE_ASSETS], 'readwrite', (stores) =>
    request(stores[STORE_ASSETS]!.delete(id)),
  );
}

/**
 * Remove asset blobs no longer referenced by their project. Runs after a save
 * so that deleting pages actually reclaims space.
 */
export async function pruneOrphanAssets(projectId: string, keepIds: Set<string>): Promise<number> {
  return runTransaction([STORE_ASSETS], 'readwrite', async (stores) => {
    const index = stores[STORE_ASSETS]!.index('projectId');
    const keys = await request<IDBValidKey[]>(index.getAllKeys(IDBKeyRange.only(projectId)));
    let removed = 0;
    for (const key of keys) {
      if (!keepIds.has(key as string)) {
        await request(stores[STORE_ASSETS]!.delete(key as string));
        removed += 1;
      }
    }
    return removed;
  });
}

/* ------------------------------------------------------------------ *
 * Meta / preferences / session recovery
 * ------------------------------------------------------------------ */

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await runTransaction([STORE_META], 'readwrite', (stores) =>
    request(stores[STORE_META]!.put({ key, value })),
  );
}

export async function getMeta<T>(key: string): Promise<T | null> {
  return runTransaction([STORE_META], 'readonly', async (stores) => {
    const row = await request<{ key: string; value: T } | undefined>(stores[STORE_META]!.get(key));
    return row ? row.value : null;
  });
}

export async function deleteMeta(key: string): Promise<void> {
  await runTransaction([STORE_META], 'readwrite', (stores) =>
    request(stores[STORE_META]!.delete(key)),
  );
}

/** Rough storage usage, when the browser is willing to report it. */
export async function estimateStorage(): Promise<{ usedBytes: number; quotaBytes: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const estimate = await navigator.storage.estimate();
    return { usedBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Ask the browser to keep PrintNest's data out of automatic eviction. Silently
 * does nothing where unsupported — it is a nice-to-have, not a requirement.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Test seam: drop the cached connection so a fresh `open` happens. */
export function resetDatabaseConnection(): void {
  dbPromise = null;
}
