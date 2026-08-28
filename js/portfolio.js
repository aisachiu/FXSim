import { DEFAULT_CURRENCY } from './constants.js';
import { getCrossRate, refreshRates, toHkd } from './rates.js';
import { applyRateContext, getSimulation, simulationTimestamp } from './simulation.js';
import { getPortfolio, savePortfolio } from './storage.js';

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

async function ratesForSimulation() {
  const simulation = getSimulation();
  applyRateContext(simulation);

  if (simulation.mode === 'historical') {
    return refreshRates({ date: simulation.currentDate, force: false });
  }

  return refreshRates({ force: false });
}

export async function getPortfolioView() {
  const portfolio = getPortfolio();
  if (!portfolio) throw new Error('No portfolio found.');

  const { date, hkdRates } = await ratesForSimulation();
  const valuation = valuePortfolio(portfolio.balances, hkdRates);
  const starting = portfolio.startingHkd;
  const pnl = roundMoney(valuation.totalHkd - starting);
  const pnlPct = starting === 0 ? 0 : (pnl / starting) * 100;

  return {
    portfolio,
    simulation: getSimulation(),
    ratesDate: date,
    valuation,
    pnl,
    pnlPct,
  };
}

export function valuePortfolio(balances, hkdRates) {
  const holdings = Object.entries(balances)
    .filter(([, amount]) => amount > 0)
    .map(([currency, amount]) => {
      const valueHkd = roundMoney(toHkd(amount, currency, hkdRates));
      return { currency, amount, valueHkd };
    });

  const totalHkd = roundMoney(holdings.reduce((sum, row) => sum + row.valueHkd, 0));

  const rows = holdings.map((row) => ({
    ...row,
    weight: totalHkd === 0 ? 0 : (row.valueHkd / totalHkd) * 100,
  }));

  return { totalHkd, holdings: rows };
}

export function recordSnapshot(portfolio, totalHkd, hkdRates, at) {
  portfolio.snapshots.push({
    at,
    totalValueHkd: totalHkd,
    rates: { ...hkdRates },
  });

  if (portfolio.snapshots.length > 500) {
    portfolio.snapshots = portfolio.snapshots.slice(-500);
  }
}

export async function executeTrade({ fromCurrency, toCurrency, amount }) {
  if (fromCurrency === toCurrency) {
    throw new Error('Choose two different currencies.');
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Enter a valid amount greater than zero.');
  }

  const portfolio = getPortfolio();
  if (!portfolio) throw new Error('No portfolio found.');

  const simulation = getSimulation();
  applyRateContext(simulation);

  const available = portfolio.balances[fromCurrency] ?? 0;
  if (amount > available + 1e-9) {
    throw new Error(`Insufficient ${fromCurrency} balance.`);
  }

  const rateDate = simulation.mode === 'historical' ? simulation.currentDate : undefined;
  const { rate, date } = await getCrossRate(fromCurrency, toCurrency, { date: rateDate });
  const toAmount = roundMoney(amount * rate);

  if (toAmount <= 0) {
    throw new Error('Trade amount is too small after conversion.');
  }

  portfolio.balances[fromCurrency] = roundMoney(available - amount);
  if (portfolio.balances[fromCurrency] <= 0) {
    delete portfolio.balances[fromCurrency];
  }

  portfolio.balances[toCurrency] = roundMoney((portfolio.balances[toCurrency] ?? 0) + toAmount);

  portfolio.transactions.unshift({
    id: crypto.randomUUID(),
    at: simulationTimestamp(simulation),
    rateDate: date,
    fromCurrency,
    toCurrency,
    fromAmount: roundMoney(amount),
    toAmount,
    rate,
  });

  const { hkdRates } = await ratesForSimulation();
  const { totalHkd } = valuePortfolio(portfolio.balances, hkdRates);
  recordSnapshot(portfolio, totalHkd, hkdRates, simulationTimestamp(simulation));

  savePortfolio(portfolio);

  return {
    fromCurrency,
    toCurrency,
    fromAmount: roundMoney(amount),
    toAmount,
    rate,
    totalHkd,
  };
}

export async function snapshotOnRefresh() {
  const portfolio = getPortfolio();
  if (!portfolio) return null;

  const simulation = getSimulation();
  const { hkdRates } = await ratesForSimulation();
  const { totalHkd } = valuePortfolio(portfolio.balances, hkdRates);
  const at = simulationTimestamp(simulation);

  const last = portfolio.snapshots.at(-1);
  const lastDay = last?.at?.slice(0, 10);
  const currentDay = simulation.currentDate;
  const shouldRecord =
    !last ||
    lastDay !== currentDay ||
    Math.abs(last.totalValueHkd - totalHkd) >= 0.01;

  if (shouldRecord) {
    recordSnapshot(portfolio, totalHkd, hkdRates, at);
    savePortfolio(portfolio);
  }

  return totalHkd;
}

export function seedInitialSnapshot(portfolio, hkdRates, at) {
  const { totalHkd } = valuePortfolio(portfolio.balances, hkdRates);
  recordSnapshot(portfolio, totalHkd, hkdRates, at);
}

export async function revalueAtCurrentDate() {
  return snapshotOnRefresh();
}
