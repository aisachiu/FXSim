import { DEFAULT_STARTING_HKD, EXPORT_FORMAT, EXPORT_VERSION, STORAGE_KEYS } from './constants.js';
import { normalizeSimulation } from './simulation.js';

export function getPortfolio() {
  const raw = localStorage.getItem(STORAGE_KEYS.portfolio);
  if (!raw) return null;
  try {
    const portfolio = JSON.parse(raw);
    if (portfolio && !portfolio.simulation) {
      portfolio.simulation = normalizeSimulation(null, '2010-01-05');
    }
    return portfolio;
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

export function createEmptyPortfolio(startingHkd, startDate = '2010-01-05') {
  return {
    startingHkd,
    balances: { HKD: startingHkd },
    transactions: [],
    snapshots: [],
    simulation: normalizeSimulation(null, startDate),
  };
}

function extractPortfolio(payload) {
  if (payload.portfolio) {
    return payload.portfolio;
  }

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

  portfolio.simulation = normalizeSimulation(
    portfolio.simulation,
    portfolio.snapshots[0]?.at?.slice(0, 10) ?? '2010-01-05',
  );

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

export { DEFAULT_STARTING_HKD };
