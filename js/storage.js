import { EXPORT_FORMAT, EXPORT_VERSION, STORAGE_KEYS } from './constants.js';

export function getPortfolio() {
  const raw = localStorage.getItem(STORAGE_KEYS.portfolio);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function savePortfolio(portfolio) {
  localStorage.setItem(STORAGE_KEYS.portfolio, JSON.stringify(portfolio));
}

export function clearPortfolio() {
  localStorage.removeItem(STORAGE_KEYS.portfolio);
}

export function createEmptyPortfolio(startingHkd) {
  return {
    startingHkd,
    balances: { HKD: startingHkd },
    transactions: [],
    snapshots: [],
  };
}

function extractPortfolio(payload) {
  if (payload.portfolio) {
    return payload.portfolio;
  }

  // v1 exports wrapped portfolio inside account
  if (payload.account?.portfolio) {
    return payload.account.portfolio;
  }

  return null;
}

function validatePortfolio(portfolio) {
  if (
    !portfolio ||
    typeof portfolio.startingHkd !== 'number' ||
    !portfolio.balances ||
    typeof portfolio.balances !== 'object'
  ) {
    throw new Error('Export file is missing a valid portfolio.');
  }

  if (!Array.isArray(portfolio.transactions)) {
    portfolio.transactions = [];
  }

  if (!Array.isArray(portfolio.snapshots)) {
    portfolio.snapshots = [];
  }

  return portfolio;
}

export function exportPortfolio() {
  const portfolio = getPortfolio();
  if (!portfolio) {
    throw new Error('No portfolio to export.');
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    portfolio,
  };
}

export function importPortfolio(payload) {
  if (!payload || payload.format !== EXPORT_FORMAT) {
    throw new Error('Invalid export file. Expected an FX Sim JSON backup.');
  }

  const portfolio = validatePortfolio(extractPortfolio(payload));
  savePortfolio(portfolio);
  return portfolio;
}
