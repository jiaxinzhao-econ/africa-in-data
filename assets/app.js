"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const state = { currency: "ZAR", view: "level", range: "1Y", hoverIndex: null };
const cache = new Map();
let manifest;
let sources = [];

const byId = (id) => document.getElementById(id);
const svgElement = (name, attributes = {}) => {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
};
const utcDate = (iso) => new Date(`${iso}T00:00:00Z`);
const dayNumber = (iso) => utcDate(iso).getTime() / 86400000;
const formatDate = (iso, short = false) => new Intl.DateTimeFormat("en", {
  day: short ? undefined : "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
}).format(utcDate(iso));
const formatRate = (value) => new Intl.NumberFormat("en", {
  maximumFractionDigits: value >= 100 ? 2 : 4,
}).format(value);
const pctChange = (current, prior) => prior ? ((current / prior) - 1) * 100 : null;
const formatChange = (value) => value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

function sourceFor(currency) {
  return sources.find((source) => source.currency_iso3 === currency);
}

function coverageFor(currency) {
  return manifest.coverage.find((item) => item.currency_iso3 === currency);
}

async function rowsFor(currency) {
  if (cache.has(currency)) return cache.get(currency);
  const response = await fetch(`data/${currency.toLowerCase()}_daily.json`);
  if (!response.ok) throw new Error(`${currency} data are unavailable.`);
  const rows = (await response.json())
    .map((row) => ({ ...row, rate: Number(row.rate_lcu_per_usd) }))
    .sort((left, right) => left.observation_date.localeCompare(right.observation_date));
  cache.set(currency, rows);
  return rows;
}

function nearestOnOrBefore(rows, target) {
  const targetDay = dayNumber(target.toISOString().slice(0, 10));
  let low = 0;
  let high = rows.length - 1;
  let answer = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (dayNumber(rows[middle].observation_date) <= targetDay) {
      answer = rows[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
}

function comparison(rows, months) {
  const latest = rows.at(-1);
  const target = utcDate(latest.observation_date);
  target.setUTCMonth(target.getUTCMonth() - months);
  const prior = nearestOnOrBefore(rows.slice(0, -1), target);
  return { prior, change: prior ? pctChange(latest.rate, prior.rate) : null };
}

function renderTabs() {
  const tabs = byId("currency-tabs");
  tabs.replaceChildren();
  sources.forEach((source) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(source.currency_iso3 === state.currency));
    const code = document.createElement("strong");
    code.textContent = source.currency_iso3;
    const country = document.createElement("span");
    country.textContent = source.country_name;
    button.append(code, country);
    button.addEventListener("click", async () => {
      state.currency = source.currency_iso3;
      state.hoverIndex = null;
      const url = new URL(window.location.href);
      url.searchParams.set("currency", state.currency);
      window.history.replaceState({}, "", url);
      await render();
    });
    tabs.append(button);
  });
}

function renderMetrics(rows, coverage) {
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const oneMonth = comparison(rows, 1);
  const oneYear = comparison(rows, 12);
  const daily = previous ? pctChange(latest.rate, previous.rate) : null;
  setText("metric-latest", formatRate(latest.rate));
  setText("metric-latest-date", `Observed ${formatDate(latest.observation_date)}`);
  setText("metric-daily", formatChange(daily));
  setText("metric-daily-label", previous ? `Since ${formatDate(previous.observation_date)}` : "No prior observation");
  setText("metric-monthly", formatChange(oneMonth.change));
  setText("metric-monthly-label", oneMonth.prior ? `Since ${formatDate(oneMonth.prior.observation_date)}` : "No comparable observation");
  setText("metric-annual", formatChange(oneYear.change));
  setText("metric-annual-label", oneYear.prior ? `Since ${formatDate(oneYear.prior.observation_date)}` : "No comparable observation");
  setText("metric-coverage", `${rows.length.toLocaleString("en")} observations`);
  setText("metric-coverage-label", `${formatDate(rows[0].observation_date)} to ${formatDate(latest.observation_date)}`);
  [["metric-daily", daily], ["metric-monthly", oneMonth.change], ["metric-annual", oneYear.change]].forEach(([id, value]) => {
    byId(id).dataset.direction = value === null ? "neutral" : value > 0 ? "depreciation" : "appreciation";
  });
  setText("source-freshness", `${coverage.freshness}; latest observation is ${coverage.latest_age_days} day${coverage.latest_age_days === 1 ? "" : "s"} before cutoff`);
}

function rowsInRange(rows) {
  if (state.range === "FULL") return rows;
  const days = { "1M": 31, "1Y": 366, "5Y": 365 * 5 + 2 }[state.range];
  const threshold = dayNumber(rows.at(-1).observation_date) - days;
  const visible = rows.filter((row) => dayNumber(row.observation_date) >= threshold);
  const earlier = rows.filter((row) => dayNumber(row.observation_date) < threshold).at(-1);
  return earlier ? [earlier, ...visible] : visible;
}

function makeText(x, y, body, attributes = {}) {
  const text = svgElement("text", { x, y, ...attributes });
  text.textContent = body;
  return text;
}

function renderChart(allRows) {
  const rows = rowsInRange(allRows);
  const days = rows.map((row) => dayNumber(row.observation_date));
  const values = rows.map((row) => state.view === "indexed" ? (row.rate / rows[0].rate) * 100 : row.rate);
  const width = 1040;
  const height = 450;
  const margin = { top: 24, right: 26, bottom: 56, left: 82 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const firstDay = days[0];
  const daySpan = Math.max(days.at(-1) - firstDay, 1);
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  const rawSpan = yMax - yMin || Math.max(yMax * 0.02, 1);
  yMin -= rawSpan * 0.1;
  yMax += rawSpan * 0.1;
  const x = (day) => margin.left + ((day - firstDay) / daySpan) * innerWidth;
  const y = (value) => margin.top + ((yMax - value) / (yMax - yMin)) * innerHeight;
  const container = byId("chart");
  const tooltip = byId("chart-tooltip");
  container.replaceChildren();
  tooltip.hidden = true;

  const svg = svgElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    tabindex: "0",
    "aria-label": `${state.currency} daily exchange-rate chart. Use left and right arrow keys for exact observations.`,
  });
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = yMin + ((yMax - yMin) * tick) / 4;
    const yPosition = y(value);
    svg.append(
      svgElement("line", { x1: margin.left, y1: yPosition, x2: width - margin.right, y2: yPosition, class: "grid-line" }),
      makeText(margin.left - 12, yPosition + 4, state.view === "indexed" ? value.toFixed(1) : formatRate(value), { class: "axis-label", "text-anchor": "end" }),
    );
  }
  [0, 0.25, 0.5, 0.75, 1].forEach((fraction, position) => {
    const target = firstDay + daySpan * fraction;
    const index = days.reduce((best, day, current) => Math.abs(day - target) < Math.abs(days[best] - target) ? current : best, 0);
    svg.append(makeText(x(days[index]), height - 20, formatDate(rows[index].observation_date, true), {
      class: "axis-label",
      "text-anchor": position === 0 ? "start" : position === 4 ? "end" : "middle",
    }));
  });
  if (state.view === "indexed" && yMin <= 100 && yMax >= 100) {
    svg.append(svgElement("line", { x1: margin.left, y1: y(100), x2: width - margin.right, y2: y(100), class: "baseline" }));
  }

  let segment = [0];
  const segments = [];
  for (let index = 1; index < rows.length; index += 1) {
    if (days[index] - days[index - 1] > 10) {
      segments.push(segment);
      segment = [];
    }
    segment.push(index);
  }
  segments.push(segment);
  segments.forEach((indexes) => {
    const path = indexes.map((index, offset) => `${offset === 0 ? "M" : "L"} ${x(days[index])} ${y(values[index])}`).join(" ");
    svg.append(svgElement("path", { d: path, class: "data-line" }));
  });

  const guide = svgElement("line", { y1: margin.top, y2: height - margin.bottom, class: "hover-guide", visibility: "hidden" });
  const point = svgElement("circle", { r: 5, class: "hover-point", visibility: "hidden" });
  svg.append(guide, point);

  const showValue = (index, clientX = null, clientY = null) => {
    const bounded = Math.max(0, Math.min(rows.length - 1, index));
    state.hoverIndex = bounded;
    const row = rows[bounded];
    const xPosition = x(days[bounded]);
    const yPosition = y(values[bounded]);
    guide.setAttribute("x1", xPosition);
    guide.setAttribute("x2", xPosition);
    guide.setAttribute("visibility", "visible");
    point.setAttribute("cx", xPosition);
    point.setAttribute("cy", yPosition);
    point.setAttribute("visibility", "visible");
    tooltip.replaceChildren();
    const dateLine = document.createElement("span");
    dateLine.textContent = formatDate(row.observation_date);
    const rateLine = document.createElement("strong");
    rateLine.textContent = `${formatRate(row.rate)} ${row.currency_iso3} per USD`;
    tooltip.append(dateLine, rateLine);
    if (state.view === "indexed") {
      const indexLine = document.createElement("span");
      indexLine.textContent = `Index ${values[bounded].toFixed(2)}`;
      tooltip.append(indexLine);
    }
    tooltip.hidden = false;
    if (clientX !== null) {
      const box = container.getBoundingClientRect();
      tooltip.style.left = `${Math.min(Math.max(clientX - box.left + 12, 8), box.width - 210)}px`;
      tooltip.style.top = `${Math.max(clientY - box.top - 72, 8)}px`;
    } else {
      tooltip.style.left = `${Math.min((xPosition / width) * container.clientWidth + 12, container.clientWidth - 210)}px`;
      tooltip.style.top = `${Math.max((yPosition / height) * container.clientHeight - 70, 8)}px`;
    }
  };

  const nearestIndex = (targetDay) => {
    let low = 0;
    let high = days.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (days[middle] < targetDay) low = middle + 1;
      else high = middle;
    }
    if (low > 0 && Math.abs(days[low - 1] - targetDay) < Math.abs(days[low] - targetDay)) return low - 1;
    return low;
  };
  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * width;
    const targetDay = firstDay + ((svgX - margin.left) / innerWidth) * daySpan;
    showValue(nearestIndex(targetDay), event.clientX, event.clientY);
  });
  svg.addEventListener("pointerleave", () => {
    guide.setAttribute("visibility", "hidden");
    point.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  });
  svg.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") state.hoverIndex = 0;
    else if (event.key === "End") state.hoverIndex = rows.length - 1;
    else state.hoverIndex = Math.max(0, Math.min(rows.length - 1, (state.hoverIndex ?? rows.length - 1) + (event.key === "ArrowRight" ? 1 : -1)));
    showValue(state.hoverIndex);
  });
  container.append(svg);
}

function renderTable(rows) {
  const body = byId("recent-data-body");
  body.replaceChildren();
  rows.slice(-20).reverse().forEach((row) => {
    const index = rows.indexOf(row);
    const previous = rows[index - 1];
    const tr = document.createElement("tr");
    const dateCell = document.createElement("td");
    dateCell.textContent = formatDate(row.observation_date);
    const rateCell = document.createElement("td");
    rateCell.className = "numeric";
    rateCell.textContent = formatRate(row.rate);
    const changeCell = document.createElement("td");
    changeCell.className = "numeric";
    changeCell.textContent = previous ? formatChange(pctChange(row.rate, previous.rate)) : "—";
    tr.append(dateCell, rateCell, changeCell);
    body.append(tr);
  });
}

function renderSource(rows, source, coverage) {
  setText("source-provider", source.provider);
  setText("source-definition", source.rate_definition);
  setText("source-segment", rows.at(-1).market_segment.replaceAll("_", " "));
  setText("source-coverage", `${source.first_observation} to ${source.latest_observation}; ${Number(source.observations).toLocaleString("en")} observations`);
  const link = byId("source-link");
  link.href = source.documentation_url || source.source_url;
  const issues = coverage.data_quality_issues || {};
  const conflictCount = (issues.conflicting_dates_excluded || []).length;
  const nonpositiveCount = (issues.nonpositive_rows_excluded || []).length;
  const note = byId("source-quality-note");
  const parts = [];
  if (conflictCount) parts.push(`${conflictCount} conflicting date${conflictCount === 1 ? "" : "s"} excluded`);
  if (nonpositiveCount) parts.push(`${nonpositiveCount} non-positive source row${nonpositiveCount === 1 ? "" : "s"} excluded`);
  note.hidden = parts.length === 0;
  note.textContent = parts.length ? `${parts.join("; ")}. See the manifest for dates.` : "";
}

async function render() {
  const rows = await rowsFor(state.currency);
  const source = sourceFor(state.currency);
  const coverage = coverageFor(state.currency);
  document.querySelectorAll("[role='tab']").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.querySelector("strong").textContent === state.currency));
  });
  setText("currency-code", state.currency);
  setText("currency-country", rows[0].country_name);
  setText("currency-title", `${state.currency} per US dollar`);
  setText("chart-subtitle", `Daily ${source.rate_definition.toLowerCase()} through ${formatDate(rows.at(-1).observation_date)}.`);
  const download = byId("currency-download");
  download.href = `data/${state.currency.toLowerCase()}_daily.csv`;
  download.download = `${state.currency.toLowerCase()}_daily.csv`;
  renderMetrics(rows, coverage);
  renderChart(rows);
  renderTable(rows);
  renderSource(rows, source, coverage);
  byId("currency-panel").hidden = false;
}

function bindControls() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", async () => {
    state.view = button.dataset.view;
    document.querySelectorAll("[data-view]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    await render();
  }));
  document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", async () => {
    state.range = button.dataset.range;
    state.hoverIndex = null;
    document.querySelectorAll("[data-range]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    await render();
  }));
}

async function initialise() {
  try {
    const [manifestResponse, sourcesResponse] = await Promise.all([fetch("data/manifest.json"), fetch("data/sources.json")]);
    if (!manifestResponse.ok || !sourcesResponse.ok) throw new Error("Data files are unavailable.");
    [manifest, sources] = await Promise.all([manifestResponse.json(), sourcesResponse.json()]);
    const requested = new URL(window.location.href).searchParams.get("currency")?.toUpperCase();
    if (sources.some((source) => source.currency_iso3 === requested)) state.currency = requested;
    renderTabs();
    bindControls();
    setText("data-status", `Updated through ${manifest.as_of_date} · ${manifest.observation_count.toLocaleString("en")} observations · ${manifest.currency_count} currencies`);
    await render();
  } catch (error) {
    setText("data-status", "Data unavailable");
    byId("error-panel").hidden = false;
    byId("error-panel").textContent = error.message;
  }
}

initialise();
