import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  HISTORY_EARLIEST,
  RANGE_PRESETS,
  addDays,
  clampDate,
  todayIso,
} from './constants.js';
import { fetchRateSeries } from './rates.js';
import {
  getDefaultChartFrom,
  getSimulation,
  stepToDate,
} from './simulation.js';

let rateChart = null;
let chartSeries = [];
let chartState = {
  base: DEFAULT_CURRENCY,
  quote: 'USD',
  from: null,
  to: null,
  preset: '1Y',
};

function formatRate(value) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatChartDate(iso) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${iso}T12:00:00Z`));
}

function getElements() {
  return {
    baseSelect: document.getElementById('chart-base'),
    quoteSelect: document.getElementById('chart-quote'),
    fromInput: document.getElementById('chart-from'),
    toInput: document.getElementById('chart-to'),
    presetButtons: document.querySelectorAll('[data-range-preset]'),
    canvas: document.getElementById('rate-chart'),
    hint: document.getElementById('chart-hint'),
    currentMarker: document.getElementById('chart-current-date'),
  };
}

function populatePairSelects() {
  const { baseSelect, quoteSelect } = getElements();
  if (!baseSelect || !quoteSelect) return;

  baseSelect.innerHTML = '';
  quoteSelect.innerHTML = '';

  for (const code of CURRENCIES) {
    baseSelect.append(new Option(code, code));
    quoteSelect.append(new Option(code, code));
  }

  baseSelect.value = chartState.base;
  quoteSelect.value = chartState.quote;
}

function syncRangeInputs() {
  const simulation = getSimulation();
  const { fromInput, toInput } = getElements();
  if (!fromInput || !toInput) return;

  if (!chartState.from || !chartState.to) {
    chartState.to = simulation.mode === 'historical' ? simulation.currentDate : todayIso();
    chartState.from = getDefaultChartFrom(simulation, RANGE_PRESETS[chartState.preset]);
  }

  fromInput.min = HISTORY_EARLIEST;
  fromInput.max = todayIso();
  toInput.min = HISTORY_EARLIEST;
  toInput.max = todayIso();
  fromInput.value = chartState.from;
  toInput.value = chartState.to;
}

function setActivePreset(preset) {
  chartState.preset = preset;
  const { presetButtons } = getElements();
  presetButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.rangePreset === preset);
  });
}

function applyPreset(preset) {
  const simulation = getSimulation();
  const end = simulation.mode === 'historical' ? simulation.currentDate : todayIso();
  const days = RANGE_PRESETS[preset] ?? RANGE_PRESETS['1Y'];

  chartState.preset = preset;
  chartState.to = end;
  chartState.from = clampDate(addDays(end, -days), simulation.startDate, end);
  setActivePreset(preset);
  syncRangeInputs();
}

function destroyChart() {
  if (rateChart) {
    rateChart.destroy();
    rateChart = null;
  }
}

function buildChartOptions(onDateSelect) {
  const simulation = getSimulation();

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'nearest',
      intersect: false,
    },
    onClick: (_event, elements) => {
      if (!elements.length) return;
      const index = elements[0].index;
      const point = chartSeries[index];
      if (point) {
        onDateSelect(point.date);
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => formatChartDate(items[0].label),
          label: (item) => `1 ${chartState.base} = ${formatRate(item.raw)} ${chartState.quote}`,
        },
      },
    },
    scales: {
      x: {
        ticks: {
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
        },
      },
      y: {
        ticks: {
          callback: (value) => formatRate(value),
        },
      },
    },
    elements: {
      point: {
        radius(context) {
          const date = chartSeries[context.dataIndex]?.date;
          if (date === simulation.currentDate) return 6;
          return chartSeries.length > 120 ? 0 : 2;
        },
        hoverRadius: 5,
      },
    },
  };
}

function renderChart(onDateSelect) {
  const { canvas, currentMarker } = getElements();
  if (!canvas) return;

  const simulation = getSimulation();
  const labels = chartSeries.map((point) => point.date);
  const values = chartSeries.map((point) => point.rate);

  destroyChart();

  rateChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `${chartState.base}/${chartState.quote}`,
          data: values,
          borderColor: '#111827',
          backgroundColor: 'rgba(17, 24, 39, 0.08)',
          fill: true,
          tension: 0.2,
          pointBackgroundColor: labels.map((date) =>
            date === simulation.currentDate ? '#047857' : '#111827',
          ),
        },
      ],
    },
    options: buildChartOptions(onDateSelect),
  });

  if (currentMarker) {
    currentMarker.textContent = simulation.mode === 'historical'
      ? `Simulation date: ${formatChartDate(simulation.currentDate)} · click a point to jump`
      : `Live mode · chart ends today`;
  }
}

export async function renderRatesView(onDateSelect) {
  const { baseSelect, quoteSelect, fromInput, toInput, hint } = getElements();
  if (!baseSelect) return;

  populatePairSelects();
  syncRangeInputs();

  const simulation = getSimulation();
  chartState.base = baseSelect.value;
  chartState.quote = quoteSelect.value;
  chartState.from = fromInput.value;
  chartState.to = toInput.value;

  if (simulation.mode === 'historical' && chartState.to < simulation.currentDate) {
    chartState.to = simulation.currentDate;
    toInput.value = chartState.to;
  }

  if (simulation.mode === 'historical' && chartState.from > simulation.currentDate) {
    chartState.from = getDefaultChartFrom(simulation, RANGE_PRESETS['1Y']);
    fromInput.value = chartState.from;
  }

  if (chartState.base === chartState.quote) {
    hint.textContent = 'Choose two different currencies.';
    destroyChart();
    return;
  }

  hint.textContent = 'Loading rates…';

  try {
    chartSeries = await fetchRateSeries({
      base: chartState.base,
      quote: chartState.quote,
      from: chartState.from,
      to: chartState.to,
    });

    if (chartSeries.length === 0) {
      hint.textContent = 'No rate data for this range.';
      destroyChart();
      return;
    }

    hint.textContent = `${chartSeries.length} trading days · click the chart to step the simulation to that date`;
    renderChart(onDateSelect);
  } catch (error) {
    hint.textContent = error.message;
    destroyChart();
  }
}

export function bindRatesView(onDateSelect) {
  const { baseSelect, quoteSelect, fromInput, toInput, presetButtons } = getElements();

  baseSelect?.addEventListener('change', () => renderRatesView(onDateSelect));
  quoteSelect?.addEventListener('change', () => renderRatesView(onDateSelect));

  fromInput?.addEventListener('change', () => {
    chartState.preset = 'custom';
    setActivePreset('custom');
    renderRatesView(onDateSelect);
  });

  toInput?.addEventListener('change', () => {
    chartState.preset = 'custom';
    setActivePreset('custom');
    renderRatesView(onDateSelect);
  });

  presetButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      applyPreset(button.dataset.rangePreset);
      await renderRatesView(onDateSelect);
    });
  });
}

export async function jumpSimulationToDate(date, refreshViews) {
  await stepToDate(date);
  await refreshViews();
}

export function resetChartState() {
  chartState = {
    base: DEFAULT_CURRENCY,
    quote: 'USD',
    from: null,
    to: null,
    preset: '1Y',
  };
}

export function refreshRatesChart(onDateSelect) {
  return renderRatesView(onDateSelect);
}
