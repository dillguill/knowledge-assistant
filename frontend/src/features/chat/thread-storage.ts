import type { AsyncStorageLike } from "@assistant-ui/core/react";

export const STORAGE_PREFIX = "knowledge-assistant:";
export const ACTIVE_THREAD_KEY = `${STORAGE_PREFIX}active-thread`;

/** localStorage behind the async interface assistant-ui's adapter expects. */
export const browserThreadStorage: AsyncStorageLike = {
  async getItem(key) {
    return localStorage.getItem(key);
  },
  async setItem(key, value) {
    localStorage.setItem(key, value);
  },
  async removeItem(key) {
    localStorage.removeItem(key);
  },
};

/** The thread to restore on reload; undefined = start on a fresh thread. */
export function loadActiveThreadId(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_THREAD_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveActiveThreadId(id: string | undefined): void {
  try {
    if (id === undefined) {
      localStorage.removeItem(ACTIVE_THREAD_KEY);
    } else {
      localStorage.setItem(ACTIVE_THREAD_KEY, id);
    }
  } catch {
    // storage unavailable (private mode) — restore just won't persist
  }
}
