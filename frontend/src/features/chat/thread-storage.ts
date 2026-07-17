import type { AsyncStorageLike } from "@assistant-ui/core/react";

export const STORAGE_PREFIX = "knowledge-assistant:";

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
