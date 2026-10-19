import { invoke } from '@tauri-apps/api/core';

const MAX_ATTEMPTS = 120;
const RETRY_MS = 500;

/** Rust tarafı açılışta henüz hazır değilse ("state not managed") kısa aralıklarla yeniden dener. */
export async function invokeWhenReady<T = void>(command: string, args?: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      const message = String(error);
      if (attempt >= MAX_ATTEMPTS || !message.includes('not managed')) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, RETRY_MS));
    }
  }
}
