import { invoke } from '@tauri-apps/api/core';

// Storage seam of the frontend. The feature code never calls Tauri commands
// directly; it goes through this document-store interface so a future backend
// can be swapped in one place. The default client persists JSON documents in
// the app-data directory through the Rust document commands, whose backend is
// selected by storage.json (backend: "local" | "mongodb").
export interface DocumentStoreClient {
  /** Returns null when the document does not exist. */
  read(filename: string): Promise<string | null>;
  write(filename: string, content: string): Promise<void>;
  remove(filename: string): Promise<void>;
  /** Lists document keys below the prefix, sorted. */
  list(prefix: string): Promise<string[]>;
}

export class LocalDocumentStore implements DocumentStoreClient {
  async read(filename: string): Promise<string | null> {
    try {
      return await invoke<string>('load_local_file', { filename });
    } catch {
      return null;
    }
  }

  async write(filename: string, content: string): Promise<void> {
    await invoke('save_local_file', { filename, content });
  }

  async remove(filename: string): Promise<void> {
    await invoke('delete_local_file', { filename });
  }

  async list(prefix: string): Promise<string[]> {
    try {
      return await invoke<string[]>('list_local_files', { prefix });
    } catch {
      return [];
    }
  }
}

// Single seam to extend: once the MongoDB backend exists (MongoDocumentStore
// on the Rust side, or a direct driver client), select it here - ideally by
// reading the same storage.json through a `get_storage_config` invoke.
export function createDocumentStore(): DocumentStoreClient {
  return new LocalDocumentStore();
}
