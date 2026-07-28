import type { ExchangeRatePair } from '../types/app';

const CACHE_KEYS = {
  usd: 'exchange-usd-cache-v1',
  eur: 'exchange-eur-cache-v1',
};
const CACHE_TTL_MS = 10 * 60 * 1000;

interface ExchangeApiResponse {
  rates?: Record<string, number>;
}

function readCachedRate(pair: keyof typeof CACHE_KEYS): ExchangeRatePair | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const cached = window.localStorage.getItem(CACHE_KEYS[pair]);
  if (!cached) {
    return null;
  }

  try {
    const parsed = JSON.parse(cached) as { expiresAt: number; data: ExchangeRatePair };
    if (parsed.expiresAt > Date.now()) {
      return parsed.data;
    }
  } catch {
    window.localStorage.removeItem(CACHE_KEYS[pair]);
  }

  return null;
}

function writeCachedRate(pair: keyof typeof CACHE_KEYS, data: ExchangeRatePair): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    CACHE_KEYS[pair],
    JSON.stringify({
      expiresAt: Date.now() + CACHE_TTL_MS,
      data,
    }),
  );
}

export async function getExchangeRate(pair: keyof typeof CACHE_KEYS): Promise<ExchangeRatePair> {
  const cached = readCachedRate(pair);
  if (cached) {
    return cached;
  }

  const url = `https://api.frankfurter.app/latest?from=${pair === 'usd' ? 'USD' : 'EUR'}&to=TRY`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Exchange rate request failed');
    }

    const payload = (await response.json()) as ExchangeApiResponse;
    const rate = payload.rates?.TRY;

    if (typeof rate !== 'number') {
      throw new Error('Exchange rate missing');
    }

    const data: ExchangeRatePair = {
      code: pair.toUpperCase(),
      rate,
      updatedAt: new Date().toISOString(),
    };

    writeCachedRate(pair, data);
    return data;
  } catch {
    const fallback = readCachedRate(pair);
    if (fallback) {
      return fallback;
    }

    throw new Error('Exchange rate unavailable');
  }
}
