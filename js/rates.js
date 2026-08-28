import { CURRENCIES, DEFAULT_CURRENCY, RATE_CACHE_MS } from './constants.js';

const API_BASE = 'https://api.frankfurter.dev/v2';

let cache = {
  fetchedAt: 0,
  date: null,
  hkdRates: {},
};

function quotesForBase(base) {
  return CURRENCIES.filter((code) => code !== base).join(',');
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Rate request failed (${response.status}).`);
  }
  return response.json();
}

export async function refreshRates({ force = false } = {}) {
  const stale = Date.now() - cache.fetchedAt > RATE_CACHE_MS;
  if (!force && !stale && Object.keys(cache.hkdRates).length > 0) {
    return getCachedRates();
  }

  const quotes = quotesForBase(DEFAULT_CURRENCY);
  const hkdPairs = await fetchJson(`${API_BASE}/rates?base=${DEFAULT_CURRENCY}&quotes=${quotes}`);

  const hkdRates = { HKD: 1 };
  for (const pair of hkdPairs) {
    // API returns quote-per-HKD; valuation needs HKD per 1 unit of quote currency.
    hkdRates[pair.quote] = 1 / pair.rate;
  }

  for (const currency of CURRENCIES) {
    if (currency === DEFAULT_CURRENCY || hkdRates[currency] !== undefined) continue;
    const pair = await fetchJson(`${API_BASE}/rate/${currency}/${DEFAULT_CURRENCY}`);
    hkdRates[currency] = pair.rate;
  }

  cache = {
    fetchedAt: Date.now(),
    date: hkdPairs[0]?.date ?? new Date().toISOString().slice(0, 10),
    hkdRates,
  };

  return getCachedRates();
}

export function getCachedRates() {
  return {
    date: cache.date,
    fetchedAt: cache.fetchedAt,
    hkdRates: { ...cache.hkdRates },
  };
}

export async function getCrossRate(fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) {
    return { rate: 1, date: cache.date };
  }

  await refreshRates();
  const pair = await fetchJson(`${API_BASE}/rate/${fromCurrency}/${toCurrency}`);
  return { rate: pair.rate, date: pair.date };
}

export function toHkd(amount, currency, hkdRates) {
  if (currency === DEFAULT_CURRENCY) return amount;
  const rate = hkdRates[currency];
  if (rate === undefined) {
    throw new Error(`No HKD rate available for ${currency}.`);
  }
  return amount * rate;
}
