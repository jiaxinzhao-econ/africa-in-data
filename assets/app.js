"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const state = { currency: "ZAR", view: "level", range: 24, hoverIndex: null };
let manifest;
let allRows = [];
let sources = [];

const byId = (id) => document.getElementById(id);
const svgElement = (name, attributes = {}) => {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
};

const formatMonth = (iso) =>
  new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso.slice(0, 7)}-01T00:00:00Z`),
  );

const formatLongDate = (iso) =>
  new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

const formatRate = (value) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: value >= 100 ? 2 : 4 }).format(value);

const pctChange = (current, prior) => (prior ? ((current / prior) - 1) * 100 : null);
const formatChange = (value) => (value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`);
const changeLabel = (value) => {
  if (value === null) return "Insufficient source-pure history";
  if (Math.abs(value) < 0.005) return "No material change";
  return value > 0 ? "Local currency depreciation" : "Local currency appreciation";
};

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

function currencyRows(currency) {
  return allRows
    .filter((row) => row.currency_iso3 === currency)
    .map((row) => ({ ...row, rate: Number(row.rate_lcu_per_usd) }))
    .sort((a, b) => a.period_end_date.localeCompare(b.period_end_date));
}

function activeSource(currency) {
  return sources.find((source) => source.currency_iso3 === currency);
}

function drawTabs() {
  const tabs = byId("currency-tabs");
  tabs.replaceChildren();
  sources.forEach((source) => {
    const rows = currencyRows(source.currency_iso3);
    const country = rows[0]?.country_name ?? source.country_iso3;
    const button = document.createElement("button");
    button.type = "button";
    button.id = `tab-${source.currency_iso3}`;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", "currency-panel");
    button.setAttribute("aria-selected", String(source.currency_iso3 === state.currency));
    const code = document.createElement("strong");
    code.textContent = source.currency_iso3;
    const label = document.createElement("span");
    label.textContent = country;
    button.append(code, label);
    button.addEventListener("click", () => {
      state.currency = source.currency_iso3;
      state.hoverIndex = null;
      const url = new URL(window.location.href);
      url.searchParams.set("currency", state.currency);
      window.history.replaceState({}, "", url);
      render();
    });
    tabs.append(button);
  });
}

function renderMetrics(rows, coverage) {
  const latest = rows.at(-1);
  const previousCandidate = rows.at(-2);
  const previous =
    previousCandidate?.period_end_date.slice(0, 7) === shiftMonth(latest.period_end_date, -1)
      ? previousCandidate
      : null;
  const priorYear = rows.find((row) => row.period_end_date.slice(0, 7) === shiftMonth(latest.period_end_date, -12));
  const monthly = previous ? pctChange(latest.rate, previous.rate) : null;
  const annual = priorYear ? pctChange(latest.rate, priorYear.rate) : null;
  setText("metric-latest", formatRate(latest.rate));
  setText("metric-latest-date", `Observed ${formatLongDate(latest.observation_date)}`);
  setText("metric-monthly", formatChange(monthly));
  setText("metric-monthly-label", changeLabel(monthly));
  setText("metric-annual", formatChange(annual));
  setText("metric-annual-label", changeLabel(annual));
  setText("metric-coverage", `${rows.length} months`);
  const leading = coverage?.leading_months_unavailable ?? 0;
  const gaps = coverage?.interior_missing_months?.length ?? 0;
  setText(
    "metric-coverage-label",
    leading > 0
      ? `${leading} earlier month${leading === 1 ? "" : "s"} outside source-pure coverage`
      : gaps > 0
        ? `${gaps} unfilled interior gap${gaps === 1 ? "" : "s"}`
        : "Complete within the displayed window",
  );
}

function shiftMonth(iso, offset) {
  const [year, month] = iso.slice(0, 7).split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function renderTable(rows) {
  const body = byId("recent-data-body");
  body.replaceChildren();
  rows.slice(-12).reverse().forEach((row, reverseIndex) => {
    const sourceIndex = rows.length - 1 - reverseIndex;
    const priorCandidate = rows[sourceIndex - 1];
    const prior =
      priorCandidate?.period_end_date.slice(0, 7) === shiftMonth(row.period_end_date, -1)
        ? priorCandidate
        : null;
    const tr = document.createElement("tr");
    const month = document.createElement("td");
    month.textContent = formatMonth(row.period_end_date);
    if (row.source_break === "true") {
      const badge = document.createElement("span");
      badge.className = "source-break-badge";
      badge.textContent = "source transition";
      month.append(badge);
    }
    const observed = document.createElement("td");
    observed.textContent = formatLongDate(row.observation_date);
    const rate = document.createElement("td");
    rate.className = "numeric";
    rate.textContent = formatRate(row.rate);
    const change = document.createElement("td");
    change.className = "numeric";
    change.textContent = prior ? formatChange(pctChange(row.rate, prior.rate)) : "—";
    tr.append(month, observed, rate, change);
    body.append(tr);
  });
}

function makeText(x, y, text, attributes = {}) {
  const element = svgElement("text", { x, y, ...attributes });
  element.textContent = text;
  return element;
}

function renderChart(inputRows) {
  const rows = state.range === 12 ? inputRows.slice(-12) : inputRows;
  const values = rows.map((row) =>
    state.view === "indexed" ? (row.rate / rows[0].rate) * 100 : row.rate,
  );
  const width = 980;
  const height = 420;
  const margin = { top: 28, right: 30, bottom: 56, left: 78 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  const span = yMax - yMin || Math.max(yMax * 0.05, 1);
  yMin -= span * 0.12;
  yMax += span * 0.12;
  const x = (index) => margin.left + (index / Math.max(rows.length - 1, 1)) * innerWidth;
  const y = (value) => margin.top + ((yMax - value) / (yMax - yMin)) * innerHeight;

  const container = byId("chart");
  const tooltip = byId("chart-tooltip");
  container.replaceChildren();
  tooltip.hidden = true;
  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "application",
    tabindex: "0",
    "aria-label": `${state.currency} monthly exchange-rate chart. Use left and right arrow keys for values.`,
  });

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMin + ((yMax - yMin) * tick) / 4;
    const yPosition = y(value);
    svg.append(
      svgElement("line", {
        x1: margin.left,
        y1: yPosition,
        x2: width - margin.right,
        y2: yPosition,
        stroke: "#d6dedb",
        "stroke-width": 1,
      }),
      makeText(margin.left - 12, yPosition + 4, state.view === "indexed" ? value.toFixed(1) : formatRate(value), {
        fill: "#61747a",
        "font-size": 11,
        "font-family": "ui-monospace, monospace",
        "text-anchor": "end",
      }),
    );
  }

  const labelIndexes = [...new Set([0, Math.round((rows.length - 1) / 3), Math.round(((rows.length - 1) * 2) / 3), rows.length - 1])];
  labelIndexes.forEach((index) => {
    svg.append(
      makeText(x(index), height - 20, formatMonth(rows[index].period_end_date), {
        fill: "#61747a",
        "font-size": 11,
        "font-family": "ui-sans-serif, sans-serif",
        "text-anchor": index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle",
      }),
    );
  });

  if (state.view === "indexed" && yMin <= 100 && yMax >= 100) {
    svg.append(
      svgElement("line", {
        x1: margin.left,
        y1: y(100),
        x2: width - margin.right,
        y2: y(100),
        stroke: "#8a9592",
        "stroke-width": 1,
        "stroke-dasharray": "5 5",
      }),
    );
  }

  rows.forEach((row, index) => {
    if (row.source_break !== "true" || index === 0) return;
    svg.append(
      svgElement("line", {
        x1: x(index),
        y1: margin.top,
        x2: x(index),
        y2: height - margin.bottom,
        stroke: "#d9a83e",
        "stroke-width": 1.5,
        "stroke-dasharray": "5 5",
      }),
      makeText(x(index) + 7, margin.top + 12, "Source transition", {
        fill: "#7a5b13",
        "font-size": 10,
        "font-weight": 700,
      }),
    );
  });

  const segments = [];
  let segment = [];
  rows.forEach((row, index) => {
    if (index > 0) {
      const current = new Date(`${row.period_end_date}T00:00:00Z`);
      const previous = new Date(`${rows[index - 1].period_end_date}T00:00:00Z`);
      if ((current - previous) / 86400000 > 40) {
        segments.push(segment);
        segment = [];
      }
    }
    segment.push(index);
  });
  segments.push(segment);
  segments.filter((item) => item.length).forEach((indexes) => {
    const pathData = indexes
      .map((index, position) => `${position === 0 ? "M" : "L"} ${x(index)} ${y(values[index])}`)
      .join(" ");
    svg.append(
      svgElement("path", {
        d: pathData,
        fill: "none",
        stroke: "#137d78",
        "stroke-width": 3,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );
  });

  const guide = svgElement("line", {
    y1: margin.top,
    y2: height - margin.bottom,
    stroke: "#10282f",
    "stroke-width": 1,
    "stroke-dasharray": "3 4",
    visibility: "hidden",
  });
  const point = svgElement("circle", {
    r: 5,
    fill: "#fffdf8",
    stroke: "#137d78",
    "stroke-width": 3,
    visibility: "hidden",
  });
  svg.append(guide, point);

  const showValue = (index) => {
    const bounded = Math.max(0, Math.min(rows.length - 1, index));
    state.hoverIndex = bounded;
    const row = rows[bounded];
    const value = values[bounded];
    const xPosition = x(bounded);
    const yPosition = y(value);
    guide.setAttribute("x1", xPosition);
    guide.setAttribute("x2", xPosition);
    guide.setAttribute("visibility", "visible");
    point.setAttribute("cx", xPosition);
    point.setAttribute("cy", yPosition);
    point.setAttribute("visibility", "visible");
    tooltip.replaceChildren();
    const month = document.createElement("span");
    month.textContent = formatMonth(row.period_end_date);
    const rate = document.createElement("strong");
    rate.textContent = `${formatRate(row.rate)} ${row.currency_iso3}/USD`;
    const observed = document.createElement("span");
    observed.textContent = `Observed ${formatLongDate(row.observation_date)}`;
    tooltip.append(month, rate);
    if (state.view === "indexed") {
      const indexed = document.createElement("span");
      indexed.textContent = `Index ${value.toFixed(2)} (first visible month = 100)`;
      tooltip.append(indexed);
    }
    tooltip.append(observed);
    tooltip.style.left = `${(xPosition / width) * 100}%`;
    tooltip.style.top = `${(yPosition / height) * 100}%`;
    tooltip.hidden = false;
    svg.setAttribute(
      "aria-label",
      `${state.currency}, ${formatMonth(row.period_end_date)}, ${formatRate(row.rate)} local currency units per US dollar, observed ${formatLongDate(row.observation_date)}.`,
    );
  };

  const overlay = svgElement("rect", {
    x: margin.left,
    y: margin.top,
    width: innerWidth,
    height: innerHeight,
    fill: "transparent",
    cursor: "crosshair",
  });
  overlay.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const localX = ((event.clientX - bounds.left) / bounds.width) * width;
    const index = Math.round(((localX - margin.left) / innerWidth) * (rows.length - 1));
    showValue(index);
  });
  overlay.addEventListener("pointerleave", () => {
    guide.setAttribute("visibility", "hidden");
    point.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
    state.hoverIndex = null;
  });
  svg.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let index = state.hoverIndex ?? rows.length - 1;
    if (event.key === "ArrowLeft") index -= 1;
    if (event.key === "ArrowRight") index += 1;
    if (event.key === "Home") index = 0;
    if (event.key === "End") index = rows.length - 1;
    showValue(index);
  });
  svg.append(overlay);
  container.append(svg);
}

function renderSource(source, rows, coverage) {
  setText("source-provider", source.provider);
  setText("source-definition", source.rate_definition);
  setText("source-segment", rows.at(-1).market_segment.replaceAll("_", " "));
  const link = byId("source-link");
  link.href = source.documentation_url || source.source_url;
  link.textContent = `Open ${source.provider} source →`;
  const transition = byId("source-transition-note");
  const breakPeriods = coverage?.source_break_periods ?? [];
  transition.hidden = breakPeriods.length === 0;
  if (breakPeriods.length) {
    transition.textContent =
      `Controlled source transition at ${formatMonth(breakPeriods[0])}. ` +
      "The public history uses the current national series; earlier IMF fallback rows are excluded.";
  }
}

function render() {
  const rows = currencyRows(state.currency);
  const source = activeSource(state.currency);
  const coverage = manifest.coverage.find((item) => item.currency_iso3 === state.currency);
  if (!rows.length || !source) return;
  drawTabs();
  byId("currency-panel").hidden = false;
  setText("currency-code", state.currency);
  setText("currency-country", rows[0].country_name);
  setText("currency-title", rows[0].currency_name);
  setText(
    "chart-subtitle",
    `${state.view === "indexed" ? "Indexed path; first visible month = 100" : "Official rate level"} · ${formatMonth(rows[0].period_end_date)} to ${formatMonth(rows.at(-1).period_end_date)} · local currency per US dollar`,
  );
  const download = byId("currency-download");
  download.href = `data/${state.currency.toLowerCase()}_monthly.csv`;
  download.download = `${state.currency.toLowerCase()}_monthly.csv`;
  renderMetrics(rows, coverage);
  renderChart(rows);
  renderTable(rows);
  renderSource(source, rows, coverage);

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
  });
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.range) === state.range));
  });
}

async function initialise() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.hoverIndex = null;
      render();
    });
  });
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      state.range = Number(button.dataset.range);
      state.hoverIndex = null;
      render();
    });
  });
  try {
    const [manifestResponse, rowsResponse, sourcesResponse] = await Promise.all([
      fetch("data/manifest.json"),
      fetch("data/fx_monthly.json"),
      fetch("data/sources.json"),
    ]);
    if (!manifestResponse.ok || !rowsResponse.ok || !sourcesResponse.ok) {
      throw new Error("A controlled data file could not be loaded.");
    }
    [manifest, allRows, sources] = await Promise.all([
      manifestResponse.json(),
      rowsResponse.json(),
      sourcesResponse.json(),
    ]);
    const requested = new URL(window.location.href).searchParams.get("currency")?.toUpperCase();
    if (requested && sources.some((source) => source.currency_iso3 === requested)) {
      state.currency = requested;
    }
    setText(
      "data-status",
      `Data through ${formatMonth(manifest.data_cutoff)} · ${manifest.observation_count} observations · ${manifest.site_status.replaceAll("_", " ")}`,
    );
    render();
  } catch (error) {
    const panel = byId("error-panel");
    panel.hidden = false;
    panel.textContent = `The explorer could not load its controlled dataset. ${error.message}`;
    setText("data-status", "Data unavailable");
  }
}

initialise();
