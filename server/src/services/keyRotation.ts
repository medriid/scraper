/**
 * Key rotation service.
 * Loads all env vars matching a given prefix pattern (e.g. OPENAI_API_KEY*)
 * and distributes requests round-robin across them.
 */

interface KeyPool {
  keys: string[];
  index: number;
}

const pools: Record<string, KeyPool> = {};

function loadKeys(prefix: string): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith(prefix) && v && v.trim().length > 0) {
      keys.push(v.trim());
    }
  }
  return keys;
}

export function getNextKey(prefix: string): string | null {
  if (!pools[prefix]) {
    const keys = loadKeys(prefix);
    pools[prefix] = { keys, index: 0 };
  }
  const pool = pools[prefix];
  if (pool.keys.length === 0) return null;
  const key = pool.keys[pool.index % pool.keys.length];
  pool.index = (pool.index + 1) % pool.keys.length;
  return key;
}

export function getKeyCount(prefix: string): number {
  if (!pools[prefix]) {
    const keys = loadKeys(prefix);
    pools[prefix] = { keys, index: 0 };
  }
  return pools[prefix].keys.length;
}

export function resetPools(): void {
  for (const k in pools) {
    delete pools[k];
  }
}

export const GEMINI_PREFIX = "GEMINI_API_KEY";
export const OPENROUTER_PREFIX = "OPENROUTER_API_KEY";
export const GROQ_PREFIX = "GROQ_API_KEY";
