import { DEFAULT_CURRENCY } from './constants.js';
import { getCrossRate, refreshRates, toHkd } from './rates.js';
import { getPortfolio, savePortfolio } from './storage.js';

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

export async function getPortfolioView() {
  const portfolio = getPortfolio();
  if (!portfolio) throw new Error('No portfolio found.');

  const { date, hkdRates } = await refreshRates();
  const valuation = valuePortfolio(portfolio.balances, hkdRates);
  const starting = portfolio.startingHkd;
  const pnl = roundMoney(valuation.totalHkd - starting);
  const pnlPct = starting === 0 ? 0 : (pnl / starting) * 100;

  return {
    portfolio,
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

export function recordSnapshot(portfolio, totalHkd, hkdRates) {
  portfolio.snapshots.push({
    at: new Date().toISOString(),
    totalValueHkd: totalHkd,
    rates: { ...hkdRates },
  });

  if (portfolio.snapshots.length > 200) {
    portfolio.snapshots = portfolio.snapshots.slice(-200);
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

  const available = portfolio.balances[fromCurrency] ?? 0;
  if (amount > available + 1e-9) {
    throw new Error(`Insufficient ${fromCurrency} balance.`);
  }

  const { rate, date } = await getCrossRate(fromCurrency, toCurrency);
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
    at: new Date().toISOString(),
    rateDate: date,
    fromCurrency,
    toCurrency,
    fromAmount: roundMoney(amount),
    toAmount,
    rate,
  });

  const { hkdRates } = await refreshRates({ force: true });
  const { totalHkd } = valuePortfolio(portfolio.balances, hkdRates);
  recordSnapshot(portfolio, totalHkd, hkdRates);

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

  const { hkdRates } = await refreshRates();
  const { totalHkd } = valuePortfolio(portfolio.balances, hkdRates);

  const last = portfolio.snapshots.at(-1);
  const shouldRecord =
    !last ||
    Math.abs(last.totalValueHkd - totalHkd) >= 0.01 ||
    Date.now() - new Date(last.at).getTime() > 15 * 60 * 1000;

  if (shouldRecord) {
    recordSnapshot(portfolio, totalHkd, hkdRates);
    savePortfolio(portfolio);
  }

  return totalHkd;
}

export function seedInitialSnapshot(portfolio, hkdRates) {
  const { totalHkd } = valuePortfolio(portfolio.balances, hkdRates);
  recordSnapshot(portfolio, totalHkd, hkdRates);
}
