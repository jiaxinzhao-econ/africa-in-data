"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const SERIES_STYLE = {
  ZAR: { color: "#2563a8", dash: "" },
  EGP: { color: "#c38b1f", dash: "8 4" },
  NGN: { color: "#d66c2c", dash: "2 3" },
  GHS: { color: "#6f7c38", dash: "10 3 2 3" },
  ETB: { color: "#b34f7a", dash: "5 3" },
};
const state = { currency: "ALL", view: "indexed", range: "1Y", hoverIndex: null };
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
const formatChange = (value) => {
  if (value === null) return "—";
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
};

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

function makeText(x, y, body, attributes = {}) {
  const text = svgElement("text", { x, y, ...attributes });
  text.textContent = body;
  return text;
}

function chartFrame(values, firstDay, lastDay) {
  const width = 1040;
  const height = 450;
  const margin = { top: 24, right: 26, bottom: 56, left: 82 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const daySpan = Math.max(lastDay - firstDay, 1);
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  const rawSpan = yMax - yMin || Math.max(Math.abs(yMax) * 0.02, 1);
  yMin -= rawSpan * 0.1;
  yMax += rawSpan * 0.1;
  return {
    width,
    height,
    margin,
    innerWidth,
    innerHeight,
    firstDay,
    daySpan,
    yMin,
    yMax,
    x: (day) => margin.left + ((day - firstDay) / daySpan) * innerWidth,
    y: (value) => margin.top + ((yMax - value) / (yMax - yMin)) * innerHeight,
  };
}

function addAxes(svg, frame, dates, indexed) {
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = frame.yMin + ((frame.yMax - frame.yMin) * tick) / 4;
    const yPosition = frame.y(value);
    svg.append(
      svgElement("line", {
        x1: frame.margin.left,
        y1: yPosition,
        x2: frame.width - frame.margin.right,
        y2: yPosition,
        class: "grid-line",
      }),
      makeText(
        frame.margin.left - 12,
        yPosition + 4,
        indexed ? value.toFixed(1) : formatRate(value),
        { class: "axis-label", "text-anchor": "end" },
      ),
    );
  }
  const days = dates.map(dayNumber);
  [0, 0.25, 0.5, 0.75, 1].forEach((fraction, position) => {
    const target = frame.firstDay + frame.daySpan * fraction;
    const index = days.reduce(
      (best, day, current) => Math.abs(day - target) < Math.abs(days[best] - target) ? current : best,
      0,
    );
    svg.append(makeText(frame.x(days[index]), frame.height - 20, formatDate(dates[index], true), {
      class: "axis-label",
      "text-anchor": position === 0 ? "start" : position === 4 ? "end" : "middle",
    }));
  });
  if (indexed && frame.yMin <= 100 && frame.yMax >= 100) {
    svg.append(svgElement("line", {
      x1: frame.margin.left,
      y1: frame.y(100),
      x2: frame.width - frame.margin.right,
      y2: frame.y(100),
      class: "baseline",
    }));
  }
}

function segmentsFor(rows) {
  if (!rows.length) return [];
  let segment = [rows[0]];
  const segments = [];
  for (let index = 1; index < rows.length; index += 1) {
    if (dayNumber(rows[index].observation_date) - dayNumber(rows[index - 1].observation_date) > 10) {
      segments.push(segment);
      segment = [];
    }
    segment.push(rows[index]);
  }
  segments.push(segment);
  return segments;
}

function nearestIndex(days, targetDay) {
  let low = 0;
  let high = days.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (days[middle] < targetDay) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(days[low - 1] - targetDay) < Math.abs(days[low] - targetDay)) return low - 1;
  return low;
}

function nearestRow(rows, targetDay) {
  const days = rows.map((row) => dayNumber(row.observation_date));
  return rows[nearestIndex(days, targetDay)];
}

function positionTooltip(tooltip, container, clientX, clientY, svgX, svgY, width) {
  if (clientX !== null) {
    const box = container.getBoundingClientRect();
    tooltip.style.left = `${Math.min(Math.max(clientX - box.left + 12, 8), Math.max(box.width - width, 8))}px`;
    tooltip.style.top = `${Math.max(clientY - box.top - 72, 8)}px`;
  } else {
    tooltip.style.left = `${Math.min((svgX / 1040) * container.clientWidth + 12, Math.max(container.clientWidth - width, 8))}px`;
    tooltip.style.top = `${Math.max((svgY / 450) * container.clientHeight - 70, 8)}px`;
  }
}

function rowsInRange(rows) {
  if (state.range === "FULL") return rows;
  const days = { "1M": 31, "1Y": 366, "5Y": 365 * 5 + 2 }[state.range];
  const threshold = dayNumber(rows.at(-1).observation_date) - days;
  const visible = rows.filter((row) => dayNumber(row.observation_date) >= threshold);
  const earlier = rows.filter((row) => dayNumber(row.observation_date) < threshold).at(-1);
  return earlier ? [earlier, ...visible] : visible;
}

function renderSingleChart(allRows) {
  const rows = rowsInRange(allRows);
  const days = rows.map((row) => dayNumber(row.observation_date));
  const values = rows.map((row) => state.view === "indexed" ? (row.rate / rows[0].rate) * 100 : row.rate);
  const frame = chartFrame(values, days[0], days.at(-1));
  const container = byId("chart");
  const tooltip = byId("chart-tooltip");
  container.replaceChildren();
  tooltip.hidden = true;
  tooltip.classList.remove("combined-tooltip");

  const svg = svgElement("svg", {
    viewBox: `0 0 ${frame.width} ${frame.height}`,
    tabindex: "0",
    "aria-label": `${state.currency} daily exchange-rate chart. Use left and right arrow keys for exact observations.`,
  });
  addAxes(svg, frame, rows.map((row) => row.observation_date), state.view === "indexed");
  segmentsFor(rows).forEach((segment) => {
    const path = segment.map((row, offset) => {
      const value = state.view === "indexed" ? (row.rate / rows[0].rate) * 100 : row.rate;
      return `${offset === 0 ? "M" : "L"} ${frame.x(dayNumber(row.observation_date))} ${frame.y(value)}`;
    }).join(" ");
    svg.append(svgElement("path", { d: path, class: "data-line" }));
  });

  const guide = svgElement("line", {
    y1: frame.margin.top,
    y2: frame.height - frame.margin.bottom,
    class: "hover-guide",
    visibility: "hidden",
  });
  const point = svgElement("circle", { r: 5, class: "hover-point", visibility: "hidden" });
  svg.append(guide, point);

  const showValue = (index, clientX = null, clientY = null) => {
    const bounded = Math.max(0, Math.min(rows.length - 1, index));
    state.hoverIndex = bounded;
    const row = rows[bounded];
    const xPosition = frame.x(days[bounded]);
    const yPosition = frame.y(values[bounded]);
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
    positionTooltip(tooltip, container, clientX, clientY, xPosition, yPosition, 210);
  };

  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * frame.width;
    const targetDay = frame.firstDay + ((svgX - frame.margin.left) / frame.innerWidth) * frame.daySpan;
    showValue(nearestIndex(days, targetDay), event.clientX, event.clientY);
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
    else state.hoverIndex = Math.max(
      0,
      Math.min(rows.length - 1, (state.hoverIndex ?? rows.length - 1) + (event.key === "ArrowRight" ? 1 : -1)),
    );
    showValue(state.hoverIndex);
  });
  container.append(svg);
}

async function combinedSeries() {
  const rowLists = await Promise.all(sources.map((source) => rowsFor(source.currency_iso3)));
  const dateCounts = new Map();
  rowLists.forEach((rows) => {
    rows.forEach((row) => dateCounts.set(row.observation_date, (dateCounts.get(row.observation_date) || 0) + 1));
  });
  const commonDates = [...dateCounts.entries()]
    .filter(([, count]) => count === sources.length)
    .map(([date]) => date)
    .sort();
  if (!commonDates.length) throw new Error("The five source series have no shared observation date.");
  const commonEndDate = commonDates.at(-1);
  const horizonDays = state.range === "1M" ? 31 : 366;
  const threshold = dayNumber(commonEndDate) - horizonDays;
  const commonBaseDate = commonDates.find((date) => dayNumber(date) >= threshold);
  if (!commonBaseDate) throw new Error("A shared base date is unavailable for this horizon.");

  const series = sources.map((source, index) => {
    const rows = rowLists[index];
    const base = rows.find((row) => row.observation_date === commonBaseDate);
    return {
      currency: source.currency_iso3,
      rows: rows
        .filter((row) => row.observation_date >= commonBaseDate && row.observation_date <= commonEndDate)
        .map((row) => ({ ...row, indexValue: (row.rate / base.rate) * 100 })),
    };
  });
  return {
    series,
    commonBaseDate,
    commonEndDate,
    commonDates: commonDates.filter((date) => date >= commonBaseDate && date <= commonEndDate),
  };
}

function renderCombinedLegend() {
  const legend = byId("chart-legend");
  legend.replaceChildren();
  sources.forEach((source) => {
    const item = document.createElement("span");
    item.className = "legend-item";
    const sample = svgElement("svg", { viewBox: "0 0 30 8", "aria-hidden": "true" });
    const style = SERIES_STYLE[source.currency_iso3];
    sample.append(svgElement("line", {
      x1: 1,
      y1: 4,
      x2: 29,
      y2: 4,
      stroke: style.color,
      "stroke-width": 3,
      "stroke-dasharray": style.dash,
    }));
    const label = document.createElement("span");
    label.textContent = source.currency_iso3;
    item.append(sample, label);
    legend.append(item);
  });
  legend.hidden = false;
}

async function renderCombinedChart() {
  const combined = await combinedSeries();
  const allValues = combined.series.flatMap((item) => item.rows.map((row) => row.indexValue));
  const frame = chartFrame(allValues, dayNumber(combined.commonBaseDate), dayNumber(combined.commonEndDate));
  const container = byId("chart");
  const tooltip = byId("chart-tooltip");
  container.replaceChildren();
  tooltip.hidden = true;
  tooltip.classList.add("combined-tooltip");

  const svg = svgElement("svg", {
    viewBox: `0 0 ${frame.width} ${frame.height}`,
    tabindex: "0",
    "aria-label": "Indexed daily exchange-rate comparison for five currencies. Use left and right arrow keys for shared dates.",
  });
  addAxes(svg, frame, combined.commonDates, true);
  combined.series.forEach((item) => {
    const style = SERIES_STYLE[item.currency];
    segmentsFor(item.rows).forEach((segment) => {
      const path = segment.map((row, index) => (
        `${index === 0 ? "M" : "L"} ${frame.x(dayNumber(row.observation_date))} ${frame.y(row.indexValue)}`
      )).join(" ");
      svg.append(svgElement("path", {
        d: path,
        class: "combined-line",
        stroke: style.color,
        "stroke-dasharray": style.dash,
      }));
    });
  });

  const guide = svgElement("line", {
    y1: frame.margin.top,
    y2: frame.height - frame.margin.bottom,
    class: "hover-guide",
    visibility: "hidden",
  });
  const points = new Map();
  combined.series.forEach((item) => {
    const point = svgElement("circle", {
      r: 4.5,
      fill: "#fff",
      stroke: SERIES_STYLE[item.currency].color,
      "stroke-width": 3,
      visibility: "hidden",
    });
    points.set(item.currency, point);
    svg.append(point);
  });
  svg.append(guide);

  const showValues = (index, clientX = null, clientY = null) => {
    const bounded = Math.max(0, Math.min(combined.commonDates.length - 1, index));
    state.hoverIndex = bounded;
    const selectedDate = combined.commonDates[bounded];
    const selectedDay = dayNumber(selectedDate);
    const xPosition = frame.x(selectedDay);
    guide.setAttribute("x1", xPosition);
    guide.setAttribute("x2", xPosition);
    guide.setAttribute("visibility", "visible");
    tooltip.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = formatDate(selectedDate);
    tooltip.append(heading);
    let firstY = frame.margin.top;
    combined.series.forEach((item) => {
      const row = nearestRow(item.rows, selectedDay);
      const yPosition = frame.y(row.indexValue);
      if (item === combined.series[0]) firstY = yPosition;
      const point = points.get(item.currency);
      point.setAttribute("cx", frame.x(dayNumber(row.observation_date)));
      point.setAttribute("cy", yPosition);
      point.setAttribute("visibility", "visible");
      const line = document.createElement("span");
      line.className = "tooltip-series";
      const code = document.createElement("b");
      code.textContent = item.currency;
      code.style.color = SERIES_STYLE[item.currency].color;
      const value = document.createElement("span");
      value.textContent = `${row.indexValue.toFixed(2)} · ${formatDate(row.observation_date)}`;
      line.append(code, value);
      tooltip.append(line);
    });
    tooltip.hidden = false;
    positionTooltip(tooltip, container, clientX, clientY, xPosition, firstY, 282);
  };

  const sharedDays = combined.commonDates.map(dayNumber);
  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * frame.width;
    const targetDay = frame.firstDay + ((svgX - frame.margin.left) / frame.innerWidth) * frame.daySpan;
    showValues(nearestIndex(sharedDays, targetDay), event.clientX, event.clientY);
  });
  svg.addEventListener("pointerleave", () => {
    guide.setAttribute("visibility", "hidden");
    points.forEach((point) => point.setAttribute("visibility", "hidden"));
    tooltip.hidden = true;
  });
  svg.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") state.hoverIndex = 0;
    else if (event.key === "End") state.hoverIndex = combined.commonDates.length - 1;
    else state.hoverIndex = Math.max(
      0,
      Math.min(
        combined.commonDates.length - 1,
        (state.hoverIndex ?? combined.commonDates.length - 1) + (event.key === "ArrowRight" ? 1 : -1),
      ),
    );
    showValues(state.hoverIndex);
  });
  container.append(svg);
  return combined;
}

function renderTableHead(columns) {
  const head = byId("recent-data-head");
  head.replaceChildren();
  const row = document.createElement("tr");
  columns.forEach((column, index) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column;
    if (index > 0) cell.className = "numeric";
    row.append(cell);
  });
  head.append(row);
}

function renderSingleDetails(rows, source, coverage) {
  setText("source-provider", source.provider);
  setText("source-definition", source.rate_definition);
  setText("source-segment", rows.at(-1).market_segment.replaceAll("_", " "));
  setText(
    "source-coverage",
    `${formatDate(rows[0].observation_date)} to ${formatDate(rows.at(-1).observation_date)}; ${rows.length.toLocaleString("en")} observations`,
  );
  setText(
    "source-freshness",
    `${coverage.freshness}; latest observation is ${coverage.latest_age_days} day${coverage.latest_age_days === 1 ? "" : "s"} before cutoff`,
  );

  const issues = coverage.data_quality_issues || {};
  const conflictCount = (issues.conflicting_dates_excluded || []).length;
  const nonpositiveCount = (issues.nonpositive_rows_excluded || []).length;
  const noteParts = [];
  if (conflictCount) noteParts.push(`${conflictCount} conflicting date${conflictCount === 1 ? "" : "s"} excluded`);
  if (nonpositiveCount) noteParts.push(`${nonpositiveCount} non-positive source row${nonpositiveCount === 1 ? "" : "s"} excluded`);
  const qualityNote = byId("source-quality-note");
  qualityNote.hidden = noteParts.length === 0;
  qualityNote.textContent = noteParts.length ? `${noteParts.join("; ")}.` : "";

  byId("official-source-list").hidden = true;
  const sourceLink = byId("source-link");
  sourceLink.hidden = false;
  sourceLink.href = source.documentation_url || source.source_url;

  setText("recent-description", "Most recent 20 source observations.");
  setText("recent-unit", "LCU per USD");
  renderTableHead(["Date", "Rate", "Change"]);
  const body = byId("recent-data-body");
  body.replaceChildren();
  rows.slice(-20).reverse().forEach((row) => {
    const index = rows.indexOf(row);
    const previous = rows[index - 1];
    const tableRow = document.createElement("tr");
    const dateCell = document.createElement("td");
    dateCell.textContent = formatDate(row.observation_date);
    const rateCell = document.createElement("td");
    rateCell.className = "numeric";
    rateCell.textContent = formatRate(row.rate);
    const changeCell = document.createElement("td");
    changeCell.className = "numeric";
    changeCell.textContent = previous ? formatChange(pctChange(row.rate, previous.rate)) : "—";
    tableRow.append(dateCell, rateCell, changeCell);
    body.append(tableRow);
  });
}

function renderCombinedDetails(combined) {
  setText("source-provider", "SARB, CBE, CBN, BoG and NBE");
  setText("source-definition", "Five source-native official/reference rates, normalized to one shared base date.");
  setText("source-segment", "Source-specific official/reference market segments");
  setText(
    "source-coverage",
    `${formatDate(combined.commonBaseDate)} to ${formatDate(combined.commonEndDate)}; ${manifest.observation_count.toLocaleString("en")} downloadable observations`,
  );
  setText("source-freshness", `Common endpoint: ${formatDate(combined.commonEndDate)}, the latest date reported by all five sources.`);
  const qualityNote = byId("source-quality-note");
  qualityNote.hidden = false;
  qualityNote.textContent = "Source definitions and fixing conventions differ by country. Indexing aligns the base and direction, not the underlying market definition.";

  const sourceLink = byId("source-link");
  sourceLink.hidden = true;
  const sourceList = byId("official-source-list");
  sourceList.replaceChildren();
  sources.forEach((source) => {
    const link = document.createElement("a");
    link.href = source.documentation_url || source.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${source.currency_iso3}: ${source.provider}`;
    sourceList.append(link);
  });
  sourceList.hidden = false;

  setText("recent-description", "Up to 20 most recent dates observed by all five sources.");
  setText("recent-unit", "Index (base = 100)");
  renderTableHead(["Date", ...combined.series.map((item) => item.currency)]);
  const rowMaps = new Map(combined.series.map((item) => [
    item.currency,
    new Map(item.rows.map((row) => [row.observation_date, row.indexValue])),
  ]));
  const body = byId("recent-data-body");
  body.replaceChildren();
  combined.commonDates.slice(-20).reverse().forEach((date) => {
    const tableRow = document.createElement("tr");
    const dateCell = document.createElement("td");
    dateCell.textContent = formatDate(date);
    tableRow.append(dateCell);
    combined.series.forEach((item) => {
      const valueCell = document.createElement("td");
      valueCell.className = "numeric";
      valueCell.textContent = rowMaps.get(item.currency).get(date).toFixed(2);
      tableRow.append(valueCell);
    });
    body.append(tableRow);
  });
}

function renderTabs() {
  const tabs = byId("currency-tabs");
  tabs.replaceChildren();
  [{ currency_iso3: "ALL", country_name: "Index 100" }, ...sources].forEach((source) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(source.currency_iso3 === state.currency));
    const code = document.createElement("strong");
    code.textContent = source.currency_iso3 === "ALL" ? "All" : source.currency_iso3;
    const country = document.createElement("span");
    country.textContent = source.country_name;
    button.append(code, country);
    button.addEventListener("click", async () => {
      state.currency = source.currency_iso3;
      state.hoverIndex = null;
      if (state.currency === "ALL") {
        state.view = "indexed";
        if (!["1M", "1Y"].includes(state.range)) state.range = "1Y";
      } else if (state.view === "indexed") {
        state.view = "level";
      }
      const url = new URL(window.location.href);
      url.searchParams.set("currency", state.currency);
      window.history.replaceState({}, "", url);
      await render();
    });
    tabs.append(button);
  });
}

function syncControls() {
  const combined = state.currency === "ALL";
  byId("value-control").hidden = combined;
  document.querySelectorAll(".extended-range").forEach((button) => { button.hidden = combined; });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
  });
  document.querySelectorAll("[data-range]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.range === state.range));
  });
}

async function render() {
  document.querySelectorAll("[role='tab']").forEach((tab) => {
    const code = tab.querySelector("strong").textContent.toUpperCase();
    tab.setAttribute("aria-selected", String(code === state.currency));
  });
  syncControls();
  if (state.currency === "ALL") {
    const combined = await renderCombinedChart();
    setText("currency-code", "ALL");
    setText("currency-country", "5 currencies");
    setText("currency-title", "Five currencies — Index 100");
    setText(
      "chart-subtitle",
      `Common base ${formatDate(combined.commonBaseDate)} = 100; through ${formatDate(combined.commonEndDate)}.`,
    );
    const download = byId("currency-download");
    download.href = "data/fx_daily.csv";
    download.download = "fx_daily.csv";
    renderCombinedLegend();
    setText(
      "chart-note",
      "Each series equals 100 on the shared base date. A rising index means local-currency depreciation. Missing dates remain gaps.",
    );
    renderCombinedDetails(combined);
  } else {
    const rows = await rowsFor(state.currency);
    const source = sourceFor(state.currency);
    const coverage = coverageFor(state.currency);
    setText("currency-code", state.currency);
    setText("currency-country", rows[0].country_name);
    setText("currency-title", `${state.currency} per US dollar`);
    setText(
      "chart-subtitle",
      `Daily ${source.rate_definition.toLowerCase()} through ${formatDate(rows.at(-1).observation_date)}.`,
    );
    const download = byId("currency-download");
    download.href = `data/${state.currency.toLowerCase()}_daily.csv`;
    download.download = `${state.currency.toLowerCase()}_daily.csv`;
    byId("chart-legend").hidden = true;
    renderSingleChart(rows);
    setText(
      "chart-note",
      state.view === "indexed"
        ? "The first visible observation equals 100. A rising index means local-currency depreciation. Missing dates remain gaps."
        : "A rising rate means local-currency depreciation. Missing dates remain gaps; no values are filled or interpolated.",
    );
    renderSingleDetails(rows, source, coverage);
  }
  byId("currency-panel").hidden = false;
}

function bindControls() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", async () => {
    if (state.currency === "ALL") return;
    state.view = button.dataset.view;
    state.hoverIndex = null;
    await render();
  }));
  document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", async () => {
    if (state.currency === "ALL" && !["1M", "1Y"].includes(button.dataset.range)) return;
    state.range = button.dataset.range;
    state.hoverIndex = null;
    await render();
  }));
}

async function initialise() {
  try {
    const [manifestResponse, sourcesResponse] = await Promise.all([
      fetch("data/manifest.json"),
      fetch("data/sources.json"),
    ]);
    if (!manifestResponse.ok || !sourcesResponse.ok) throw new Error("Data files are unavailable.");
    [manifest, sources] = await Promise.all([manifestResponse.json(), sourcesResponse.json()]);
    const requested = new URL(window.location.href).searchParams.get("currency")?.toUpperCase();
    if (requested === "ALL" || sources.some((source) => source.currency_iso3 === requested)) {
      state.currency = requested;
      if (requested !== "ALL") state.view = "level";
    }
    renderTabs();
    bindControls();
    setText(
      "data-status",
      `Updated ${manifest.as_of_date} · ${manifest.observation_count.toLocaleString("en")} observations`,
    );
    await render();
  } catch (error) {
    setText("data-status", "Data unavailable");
    byId("error-panel").hidden = false;
    byId("error-panel").textContent = error.message;
  }
}

initialise();
