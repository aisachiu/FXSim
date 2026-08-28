import { CURRENCIES, DEFAULT_CURRENCY, RATE_CACHE_MS } from './constants.js';

const API_BASE = 'https://api.frankfurter.dev/v2';

const spotCache = new Map();
const seriesCache = new Map();

let context = {
  mode: 'live',
  date: null,
};

let latestSpot = {
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

function normalizeHkdRates(rows) {
  const hkdRates = { HKD: 1 };

  for (const pair of rows) {
    if (pair.base === DEFAULT_CURRENCY) {
      hkdRates[pair.quote] = 1 / pair.rate;
    } else if (pair.quote === DEFAULT_CURRENCY) {
      hkdRates[pair.base] = pair.rate;
    }
  }

  return hkdRates;
}

async function fillMissingHkdRates(hkdRates, date) {
  for (const currency of CURRENCIES) {
    if (currency === DEFAULT_CURRENCY || hkdRates[currency] !== undefined) {
      continue;
    }

    const suffix = date ? `?date=${date}` : '';
    const pair = await fetchJson(`${API_BASE}/rate/${currency}/${DEFAULT_CURRENCY}${suffix}`);
    hkdRates[currency] = pair.rate;
  }

  return hkdRates;
}

export function setRateContext({ mode, date }) {
  context = {
    mode,
    date: mode === 'historical' ? date : null,
  };
}

export function getRateContext() {
  return { ...context };
}

export async function refreshRates({ force = false, date } = {}) {
  const targetDate = date ?? context.date;
  const cacheKey = targetDate ?? 'latest';

  if (!force) {
    if (targetDate && spotCache.has(cacheKey)) {
      return spotCache.get(cacheKey);
    }
    if (!targetDate) {
      const stale = Date.now() - latestSpot.fetchedAt > RATE_CACHE_MS;
      if (!stale && Object.keys(latestSpot.hkdRates).length > 0) {
        return {
          date: latestSpot.date,
          fetchedAt: latestSpot.fetchedAt,
          hkdRates: { ...latestSpot.hkdRates },
        };
      }
    }
  }

  const quotes = quotesForBase(DEFAULT_CURRENCY);
  const url = targetDate
    ? `${API_BASE}/rates?base=${DEFAULT_CURRENCY}&quotes=${quotes}&date=${targetDate}`
    : `${API_BASE}/rates?base=${DEFAULT_CURRENCY}&quotes=${quotes}`;

  const rows = await fetchJson(url);
  const hkdRates = await fillMissingHkdRates(normalizeHkdRates(rows), targetDate);
  const resolvedDate = rows[0]?.date ?? targetDate ?? new Date().toISOString().slice(0, 10);

  const payload = {
    date: resolvedDate,
    fetchedAt: Date.now(),
    hkdRates,
  };

  if (targetDate) {
    spotCache.set(cacheKey, payload);
  } else {
    latestSpot = payload;
  }

  return payload;
}

export function getCachedRates() {
  if (context.date && spotCache.has(context.date)) {
    const cached = spotCache.get(context.date);
    return {
      date: cached.date,
      fetchedAt: cached.fetchedAt,
      hkdRates: { ...cached.hkdRates },
    };
  }

  return {
    date: latestSpot.date,
    fetchedAt: latestSpot.fetchedAt,
    hkdRates: { ...latestSpot.hkdRates },
  };
}

export async function getCrossRate(fromCurrency, toCurrency, { date } = {}) {
  if (fromCurrency === toCurrency) {
    const resolved = date ?? context.date ?? latestSpot.date;
    return { rate: 1, date: resolved };
  }

  const targetDate = date ?? context.date;
  const suffix = targetDate ? `?date=${targetDate}` : '';
  const pair = await fetchJson(`${API_BASE}/rate/${fromCurrency}/${toCurrency}${suffix}`);
  return { rate: pair.rate, date: pair.date };
}

export async function fetchRateSeries({ base, quote, from, to }) {
  const cacheKey = `${base}-${quote}-${from}-${to}`;
  if (seriesCache.has(cacheKey)) {
    return seriesCache.get(cacheKey);
  }

  const rows = await fetchJson(
    `${API_BASE}/rates?base=${base}&quotes=${quote}&from=${from}&to=${to}`,
  );

  const series = rows
    .filter((row) => row.quote === quote)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({ date: row.date, rate: row.rate }));

  seriesCache.set(cacheKey, series);
  return series;
}

export async function fetchTradingDays(from, to) {
  const series = await fetchRateSeries({
    base: DEFAULT_CURRENCY,
    quote: 'USD',
    from,
    to,
  });
  return series.map((point) => point.date);
}

export function toHkd(amount, currency, hkdRates) {
  if (currency === DEFAULT_CURRENCY) return amount;
  const rate = hkdRates[currency];
  if (rate === undefined) {
    throw new Error(`No HKD rate available for ${currency}.`);
  }
  return amount * rate;
}
