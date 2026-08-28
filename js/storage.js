import {
  DEFAULT_STARTING_HKD,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  STORAGE_KEYS,
  slugify,
} from './constants.js';
import { normalizeSimulation } from './simulation.js';

function readStore() {
  const raw = localStorage.getItem(STORAGE_KEYS.scenarios);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return migrateLegacyPortfolio();
}

function migrateLegacyPortfolio() {
  const raw = localStorage.getItem(STORAGE_KEYS.portfolio);
  if (!raw) return null;

  try {
    const legacy = JSON.parse(raw);
    const scenario = buildScenario('Scenario 1', validatePortfolioData(legacy));
    localStorage.removeItem(STORAGE_KEYS.portfolio);
    const store = {
      version: 1,
      activeId: scenario.id,
      scenarios: [scenario],
    };
    writeStore(store);
    return store;
  } catch {
    localStorage.removeItem(STORAGE_KEYS.portfolio);
    return null;
  }
}

function writeStore(store) {
  localStorage.setItem(STORAGE_KEYS.scenarios, JSON.stringify(store));
}

function buildScenario(name, portfolioData) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled scenario',
    createdAt: now,
    updatedAt: now,
    ...portfolioData,
  };
}

function validatePortfolioData(portfolio, fallbackStart = '2010-01-05') {
  if (
    !portfolio ||
    typeof portfolio.startingHkd !== 'number' ||
    !portfolio.balances ||
    typeof portfolio.balances !== 'object'
  ) {
    throw new Error('Invalid portfolio data.');
  }

  if (!Array.isArray(portfolio.transactions)) {
    portfolio.transactions = [];
  }

  if (!Array.isArray(portfolio.snapshots)) {
    portfolio.snapshots = [];
  }

  portfolio.simulation = normalizeSimulation(
    portfolio.simulation,
    portfolio.snapshots[0]?.at?.slice(0, 10) ?? fallbackStart,
  );

  return {
    startingHkd: portfolio.startingHkd,
    balances: portfolio.balances,
    transactions: portfolio.transactions,
    snapshots: portfolio.snapshots,
    simulation: portfolio.simulation,
  };
}

function getActiveScenarioRecord(store = readStore()) {
  if (!store?.scenarios?.length) return null;
  return store.scenarios.find((scenario) => scenario.id === store.activeId) ?? store.scenarios[0];
}

export function hasScenarios() {
  const store = readStore();
  return Boolean(store?.scenarios?.length);
}

export function listScenarios() {
  const store = readStore();
  if (!store) return [];

  return store.scenarios.map(({ id, name, updatedAt, createdAt }) => ({
    id,
    name,
    updatedAt,
    createdAt,
  }));
}

export function getActiveScenarioId() {
  return readStore()?.activeId ?? null;
}

export function getActiveScenarioMeta() {
  const scenario = getActiveScenarioRecord();
  if (!scenario) return null;
  return {
    id: scenario.id,
    name: scenario.name,
    createdAt: scenario.createdAt,
    updatedAt: scenario.updatedAt,
  };
}

export function getPortfolio() {
  const scenario = getActiveScenarioRecord();
  if (!scenario) return null;

  if (!scenario.simulation) {
    scenario.simulation = normalizeSimulation(null, '2010-01-05');
  }

  return scenario;
}

export function savePortfolio(portfolio) {
  const store = readStore();
  if (!store) return;

  const index = store.scenarios.findIndex((scenario) => scenario.id === store.activeId);
  if (index === -1) return;

  const existing = store.scenarios[index];
  store.scenarios[index] = {
    ...existing,
    startingHkd: portfolio.startingHkd,
    balances: portfolio.balances,
    transactions: portfolio.transactions,
    snapshots: portfolio.snapshots,
    simulation: portfolio.simulation,
    updatedAt: new Date().toISOString(),
  };

  writeStore(store);
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

export function createScenario(name, startingHkd, startDate = '2010-01-05') {
  const portfolioData = createEmptyPortfolio(startingHkd, startDate);
  const scenario = buildScenario(name, portfolioData);

  const store = readStore() ?? { version: 1, activeId: scenario.id, scenarios: [] };
  store.scenarios.push(scenario);
  store.activeId = scenario.id;
  writeStore(store);

  return scenario;
}

export function switchScenario(id) {
  const store = readStore();
  if (!store) throw new Error('No scenarios saved.');

  const scenario = store.scenarios.find((entry) => entry.id === id);
  if (!scenario) throw new Error('Scenario not found.');

  store.activeId = id;
  writeStore(store);
  return scenario;
}

export function deleteScenario(id) {
  const store = readStore();
  if (!store) throw new Error('No scenarios saved.');

  const index = store.scenarios.findIndex((scenario) => scenario.id === id);
  if (index === -1) throw new Error('Scenario not found.');

  const [removed] = store.scenarios.splice(index, 1);

  if (store.scenarios.length === 0) {
    localStorage.removeItem(STORAGE_KEYS.scenarios);
    return { removed, remaining: 0, activeId: null };
  }

  if (store.activeId === id) {
    store.activeId = store.scenarios[0].id;
  }

  writeStore(store);
  return {
    removed,
    remaining: store.scenarios.length,
    activeId: store.activeId,
  };
}

export function renameActiveScenario(name) {
  const store = readStore();
  if (!store) return null;

  const scenario = getActiveScenarioRecord(store);
  if (!scenario) return null;

  scenario.name = name.trim() || scenario.name;
  scenario.updatedAt = new Date().toISOString();
  writeStore(store);
  return scenario.name;
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

export function exportPortfolio() {
  const scenario = getPortfolio();
  if (!scenario) {
    throw new Error('No scenario to export.');
  }

  const portfolio = validatePortfolioData({
    startingHkd: scenario.startingHkd,
    balances: scenario.balances,
    transactions: scenario.transactions,
    snapshots: scenario.snapshots,
    simulation: scenario.simulation,
  });

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    scenarioName: scenario.name,
    exportedAt: new Date().toISOString(),
    portfolio,
  };
}

export function exportFilename(payload) {
  const stamp = new Date().toISOString().slice(0, 10);
  const name = slugify(payload.scenarioName ?? 'scenario');
  return `fxsim-${name}-${stamp}.json`;
}

export function importPortfolio(payload) {
  if (!payload || payload.format !== EXPORT_FORMAT) {
    throw new Error('Invalid export file. Expected an FX Sim JSON backup.');
  }

  const portfolio = validatePortfolioData(extractPortfolio(payload));
  const store = readStore();

  if (!store || !store.scenarios.length) {
    const scenario = buildScenario(payload.scenarioName ?? 'Imported scenario', portfolio);
    writeStore({
      version: 1,
      activeId: scenario.id,
      scenarios: [scenario],
    });
    return scenario;
  }

  const active = getActiveScenarioRecord(store);
  const index = store.scenarios.findIndex((scenario) => scenario.id === active.id);

  store.scenarios[index] = {
    ...active,
    ...portfolio,
    name: payload.scenarioName?.trim() || active.name,
    updatedAt: new Date().toISOString(),
  };

  writeStore(store);
  return store.scenarios[index];
}

export { DEFAULT_STARTING_HKD };
