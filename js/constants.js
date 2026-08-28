export const STORAGE_KEYS = {
  portfolio: 'fxsim:portfolio',
};

export const EXPORT_FORMAT = 'fxsim-export';
export const EXPORT_VERSION = 3;

export const CURRENCIES = [
  'HKD',
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'AUD',
  'CAD',
  'SGD',
  'CHF',
];

export const DEFAULT_CURRENCY = 'HKD';
export const DEFAULT_STARTING_HKD = 10000;
export const MIN_STARTING_HKD = 1000;
export const RATE_CACHE_MS = 5 * 60 * 1000;

export const HISTORY_EARLIEST = '1981-01-02';
export const EUR_START = '1999-01-04';

export const SPEED_MIN = 1;
export const SPEED_MAX = 50;
export const SPEED_DEFAULT = 5;

export const RANGE_PRESETS = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
  '3Y': 365 * 3,
  '5Y': 365 * 5,
};

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function currenciesForDate(date) {
  if (date < EUR_START) {
    return CURRENCIES.filter((code) => code !== 'EUR');
  }
  return CURRENCIES;
}

export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function clampDate(isoDate, min, max) {
  if (isoDate < min) return min;
  if (isoDate > max) return max;
  return isoDate;
}
