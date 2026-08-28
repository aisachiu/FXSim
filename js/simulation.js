import { addDays, clampDate, HISTORY_EARLIEST, todayIso } from './constants.js';
import { fetchTradingDays, setRateContext } from './rates.js';
import { getPortfolio, savePortfolio } from './storage.js';

const DEFAULT_SIMULATION = {
  mode: 'historical',
  currentDate: '2010-01-05',
  startDate: '2010-01-05',
  playbackSpeed: 5,
};

let tradingDays = [];
let tradingDaysRange = { from: null, to: null };
let playbackTimer = null;
let onStepCallback = null;

function defaultSimulation(startDate = '2010-01-05') {
  const date = clampDate(startDate, HISTORY_EARLIEST, todayIso());
  return {
    mode: date >= todayIso() ? 'live' : 'historical',
    currentDate: date >= todayIso() ? todayIso() : date,
    startDate: date,
    playbackSpeed: DEFAULT_SIMULATION.playbackSpeed,
  };
}

export function normalizeSimulation(simulation, fallbackStart = '2010-01-05') {
  if (!simulation) {
    return defaultSimulation(fallbackStart);
  }

  const startDate = clampDate(
    simulation.startDate ?? fallbackStart,
    HISTORY_EARLIEST,
    todayIso(),
  );
  const currentDate = clampDate(
    simulation.currentDate ?? startDate,
    startDate,
    todayIso(),
  );

  return {
    mode: simulation.mode === 'live' ? 'live' : 'historical',
    currentDate: simulation.mode === 'live' ? todayIso() : currentDate,
    startDate,
    playbackSpeed: simulation.playbackSpeed ?? DEFAULT_SIMULATION.playbackSpeed,
  };
}

export function getSimulation() {
  const portfolio = getPortfolio();
  return normalizeSimulation(portfolio?.simulation);
}

export function saveSimulation(simulation) {
  const portfolio = getPortfolio();
  if (!portfolio) return null;

  portfolio.simulation = normalizeSimulation(simulation, simulation.startDate);
  savePortfolio(portfolio);
  applyRateContext(portfolio.simulation);
  return portfolio.simulation;
}

export function initSimulation(startDate) {
  const simulation = defaultSimulation(startDate);
  const portfolio = getPortfolio();
  if (portfolio) {
    portfolio.simulation = simulation;
    savePortfolio(portfolio);
  }
  applyRateContext(simulation);
  return simulation;
}

export function applyRateContext(simulation = getSimulation()) {
  setRateContext({
    mode: simulation.mode,
    date: simulation.mode === 'historical' ? simulation.currentDate : null,
  });
}

export function isPlaying() {
  return playbackTimer !== null;
}

export function stopPlayback() {
  if (playbackTimer) {
    clearInterval(playbackTimer);
    playbackTimer = null;
  }
}

export function startPlayback(onStep) {
  stopPlayback();
  onStepCallback = onStep;

  const tick = async () => {
    const simulation = getSimulation();
    if (simulation.mode !== 'historical') {
      stopPlayback();
      return;
    }

    const advanced = await stepForward();
    if (!advanced) {
      stopPlayback();
      return;
    }

    if (onStepCallback) {
      await onStepCallback();
    }
  };

  const simulation = getSimulation();
  const intervalMs = Math.max(40, Math.round(1000 / simulation.playbackSpeed));
  playbackTimer = setInterval(() => {
    tick().catch(() => stopPlayback());
  }, intervalMs);
}

export function setPlaybackSpeed(speed) {
  const simulation = getSimulation();
  simulation.playbackSpeed = speed;
  saveSimulation(simulation);

  if (isPlaying()) {
    startPlayback(onStepCallback);
  }
}

export async function ensureTradingDays(from, to) {
  const clampedFrom = clampDate(from, HISTORY_EARLIEST, todayIso());
  const clampedTo = clampDate(to, clampedFrom, todayIso());

  if (
    tradingDaysRange.from === clampedFrom &&
    tradingDaysRange.to === clampedTo &&
    tradingDays.length > 0
  ) {
    return tradingDays;
  }

  tradingDays = await fetchTradingDays(clampedFrom, clampedTo);
  tradingDaysRange = { from: clampedFrom, to: clampedTo };
  return tradingDays;
}

function indexOfDate(date) {
  return tradingDays.indexOf(date);
}

export async function stepForward() {
  const simulation = getSimulation();
  if (simulation.mode !== 'historical') {
    return false;
  }

  await ensureTradingDays(simulation.startDate, todayIso());

  const currentIndex = indexOfDate(simulation.currentDate);
  const nextIndex = currentIndex === -1
    ? tradingDays.findIndex((day) => day > simulation.currentDate)
    : currentIndex + 1;

  if (nextIndex === -1 || nextIndex >= tradingDays.length) {
    return false;
  }

  simulation.currentDate = tradingDays[nextIndex];
  saveSimulation(simulation);
  return true;
}

export async function stepToDate(targetDate) {
  const simulation = getSimulation();
  const clamped = clampDate(targetDate, simulation.startDate, todayIso());

  if (simulation.mode === 'historical') {
    await ensureTradingDays(simulation.startDate, todayIso());
    const exactIndex = indexOfDate(clamped);
    if (exactIndex !== -1) {
      simulation.currentDate = tradingDays[exactIndex];
    } else {
      const nextIndex = tradingDays.findIndex((day) => day >= clamped);
      if (nextIndex === -1) {
        throw new Error('No trading day available on or after that date.');
      }
      simulation.currentDate = tradingDays[nextIndex];
    }
  } else {
    simulation.currentDate = todayIso();
  }

  saveSimulation(simulation);
  return simulation.currentDate;
}

export function setMode(mode) {
  const simulation = getSimulation();

  if (mode === 'live') {
    stopPlayback();
    simulation.mode = 'live';
    simulation.currentDate = todayIso();
  } else {
    simulation.mode = 'historical';
    simulation.currentDate = clampDate(
      simulation.currentDate,
      simulation.startDate,
      todayIso(),
    );
  }

  saveSimulation(simulation);
  return simulation;
}

export function simulationTimestamp(simulation = getSimulation()) {
  return `${simulation.currentDate}T12:00:00.000Z`;
}

export function canStepForward(simulation = getSimulation()) {
  if (simulation.mode !== 'historical') {
    return false;
  }
  if (simulation.currentDate >= todayIso()) {
    return false;
  }
  if (tradingDays.length === 0) {
    return true;
  }
  const currentIndex = indexOfDate(simulation.currentDate);
  if (currentIndex === -1) {
    return tradingDays.some((day) => day > simulation.currentDate);
  }
  return currentIndex < tradingDays.length - 1;
}

export function getChartRangeEnd(simulation = getSimulation()) {
  return simulation.mode === 'historical' ? simulation.currentDate : todayIso();
}

export function getDefaultChartFrom(simulation = getSimulation(), days = 365) {
  const end = getChartRangeEnd(simulation);
  const from = addDays(end, -days);
  return clampDate(from, simulation.startDate, end);
}
