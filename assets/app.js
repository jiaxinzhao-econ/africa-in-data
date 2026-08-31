"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const SERIES_STYLE = ["#096d68", "#2563a8", "#c38b1f", "#d66c2c", "#6f7c38", "#b34f7a"];
const UNIT_LABELS = {
  LCU_per_USD: "local currency per US dollar",
  percent: "percent year-on-year",
  percent_yoy: "percent year-on-year",
  percent_per_annum: "percent per annum",
  index: "index",
  index_2006_100: "index (2006 = 100)",
  index_2016_100: "index (2016 = 100)",
  USD_per_barrel: "US dollars per barrel",
  USD_per_metric_ton: "US dollars per metric ton",
  USD_cents_per_pound: "US cents per pound",
};
const state = {
  tab: "africa",
  africaCurrency: "ALL",
  ranges: new Map(),
  views: new Map(),
  hover: new Map(),
};
const cache = new Map();
let manifest;

const byId = (id) => document.getElementById(id);
const utcDate = (iso) => new Date(`${iso}T00:00:00Z`);
const dayNumber = (iso) => utcDate(iso).getTime() / 86400000;
const svgElement = (name, attributes = {}) => {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
};
const makeText = (x, y, body, attributes = {}) => {
  const text = svgElement("text", { x, y, ...attributes });
  text.textContent = body;
  return text;
};
const formatDate = (iso, compact = false) => new Intl.DateTimeFormat("en", {
  day: compact ? undefined : "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
}).format(utcDate(iso));
const formatValue = (value) => new Intl.NumberFormat("en", {
  maximumFractionDigits: Math.abs(value) >= 100 ? 2 : 4,
}).format(value);
const unitLabel = (unit) => UNIT_LABELS[unit] || unit.replaceAll("_", " ");

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

async function rowsFor(chart) {
  if (cache.has(chart.chart_id)) return cache.get(chart.chart_id);
  const response = await fetch(chart.json_path);
  if (!response.ok) throw new Error(`${chart.title} data are unavailable.`);
  const rows = (await response.json())
    .map((row) => ({ observation_date: row.observation_date, value: Number(row.value) }))
    .filter((row) => Number.isFinite(row.value))
    .sort((left, right) => left.observation_date.localeCompare(right.observation_date));
  if (!rows.length) throw new Error(`${chart.title} contains no numeric observations.`);
  cache.set(chart.chart_id, rows);
  return rows;
}

function rowsInRange(rows, range) {
  if (range === "FULL") return rows;
  const days = { "1M": 31, "1Y": 366, "5Y": 1828 }[range];
  const threshold = dayNumber(rows.at(-1).observation_date) - days;
  const visible = rows.filter((row) => dayNumber(row.observation_date) >= threshold);
  const earlier = rows.filter((row) => dayNumber(row.observation_date) < threshold).at(-1);
  return earlier ? [earlier, ...visible] : visible;
}

function chartFrame(values, firstDay, lastDay) {
  const width = 1100;
  const height = 430;
  const margin = { top: 22, right: 24, bottom: 54, left: 88 };
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

function nearestIndex(days, target) {
  let low = 0;
  let high = days.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (days[middle] < target) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && Math.abs(days[low - 1] - target) < Math.abs(days[low] - target)) return low - 1;
  return low;
}

function nearestRow(rows, targetDay) {
  const days = rows.map((row) => dayNumber(row.observation_date));
  return rows[nearestIndex(days, targetDay)];
}

function addAxes(svg, frame, dates, indexed = false) {
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = frame.yMin + ((frame.yMax - frame.yMin) * tick) / 4;
    const y = frame.y(value);
    svg.append(
      svgElement("line", { x1: frame.margin.left, y1: y, x2: frame.width - frame.margin.right, y2: y, class: "grid-line" }),
      makeText(frame.margin.left - 12, y + 4, indexed ? value.toFixed(1) : formatValue(value), { class: "axis-label", "text-anchor": "end" }),
    );
  }
  const days = dates.map(dayNumber);
  [0, 0.25, 0.5, 0.75, 1].forEach((fraction, position) => {
    const target = frame.firstDay + frame.daySpan * fraction;
    const index = nearestIndex(days, target);
    svg.append(makeText(frame.x(days[index]), frame.height - 18, formatDate(dates[index], true), {
      class: "axis-label",
      "text-anchor": position === 0 ? "start" : position === 4 ? "end" : "middle",
    }));
  });
  if (indexed && frame.yMin <= 100 && frame.yMax >= 100) {
    svg.append(svgElement("line", { x1: frame.margin.left, y1: frame.y(100), x2: frame.width - frame.margin.right, y2: frame.y(100), class: "baseline" }));
  }
}

function segmentsFor(rows, frequency) {
  const maximumGap = frequency === "daily" ? 10 : frequency === "weekly" ? 24 : 50;
  if (!rows.length) return [];
  const segments = [];
  let segment = [rows[0]];
  for (let index = 1; index < rows.length; index += 1) {
    if (dayNumber(rows[index].observation_date) - dayNumber(rows[index - 1].observation_date) > maximumGap) {
      segments.push(segment);
      segment = [];
    }
    segment.push(rows[index]);
  }
  segments.push(segment);
  return segments;
}

function positionTooltip(tooltip, container, event, x, y) {
  if (event) {
    const bounds = container.getBoundingClientRect();
    tooltip.style.left = `${Math.min(Math.max(event.clientX - bounds.left + 12, 8), Math.max(bounds.width - 230, 8))}px`;
    tooltip.style.top = `${Math.max(event.clientY - bounds.top - 66, 8)}px`;
  } else {
    tooltip.style.left = `${Math.min((x / 1100) * container.clientWidth + 12, Math.max(container.clientWidth - 230, 8))}px`;
    tooltip.style.top = `${Math.max((y / 430) * container.clientHeight - 60, 8)}px`;
  }
}

function drawSingleChart(container, tooltip, rows, chart, range, view) {
  const visible = rowsInRange(rows, range);
  const indexed = view === "indexed";
  const base = visible[0].value;
  const values = visible.map((row) => indexed ? (row.value / base) * 100 : row.value);
  const days = visible.map((row) => dayNumber(row.observation_date));
  const frame = chartFrame(values, days[0], days.at(-1));
  const svg = svgElement("svg", {
    viewBox: `0 0 ${frame.width} ${frame.height}`,
    tabindex: "0",
    "aria-label": `${chart.title} ${range} chart. Use left and right arrow keys for exact observations.`,
  });
  addAxes(svg, frame, visible.map((row) => row.observation_date), indexed);
  segmentsFor(visible, chart.frequency).forEach((segment) => {
    const path = segment.map((row, offset) => {
      const originalIndex = visible.indexOf(row);
      return `${offset === 0 ? "M" : "L"} ${frame.x(dayNumber(row.observation_date))} ${frame.y(values[originalIndex])}`;
    }).join(" ");
    svg.append(svgElement("path", { d: path, class: "data-line" }));
  });
  const guide = svgElement("line", { y1: frame.margin.top, y2: frame.height - frame.margin.bottom, class: "hover-guide", visibility: "hidden" });
  const point = svgElement("circle", { r: 5, class: "hover-point", visibility: "hidden" });
  svg.append(guide, point);

  const showValue = (index, event = null) => {
    const bounded = Math.max(0, Math.min(visible.length - 1, index));
    state.hover.set(chart.chart_id, bounded);
    const row = visible[bounded];
    const x = frame.x(days[bounded]);
    const y = frame.y(values[bounded]);
    guide.setAttribute("x1", x);
    guide.setAttribute("x2", x);
    guide.setAttribute("visibility", "visible");
    point.setAttribute("cx", x);
    point.setAttribute("cy", y);
    point.setAttribute("visibility", "visible");
    tooltip.replaceChildren();
    const dateLine = document.createElement("span");
    dateLine.textContent = formatDate(row.observation_date);
    const valueLine = document.createElement("strong");
    valueLine.textContent = indexed ? `Index ${values[bounded].toFixed(2)}` : `${formatValue(row.value)} ${unitLabel(chart.unit)}`;
    tooltip.append(dateLine, valueLine);
    tooltip.hidden = false;
    positionTooltip(tooltip, container, event, x, y);
  };
  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * frame.width;
    const target = frame.firstDay + ((svgX - frame.margin.left) / frame.innerWidth) * frame.daySpan;
    showValue(nearestIndex(days, target), event);
  });
  svg.addEventListener("pointerleave", () => {
    guide.setAttribute("visibility", "hidden");
    point.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  });
  svg.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let index = state.hover.get(chart.chart_id) ?? visible.length - 1;
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = visible.length - 1;
    else index += event.key === "ArrowRight" ? 1 : -1;
    showValue(index);
  });
  container.replaceChildren(svg);
}

function makeButton(label, selected, click) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.setAttribute("aria-pressed", String(selected));
  button.addEventListener("click", click);
  return button;
}

async function createChartCard(chart) {
  const rows = await rowsFor(chart);
  const card = document.createElement("article");
  card.className = "chart-card";
  card.id = `chart-${chart.chart_id}`;
  const header = document.createElement("div");
  header.className = "chart-card-header";
  const titleGroup = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = chart.title;
  const meta = document.createElement("p");
  meta.className = "chart-meta";
  meta.textContent = `${chart.frequency} · ${unitLabel(chart.unit)} · ${formatDate(chart.first_observation)} to ${formatDate(chart.latest_observation)}`;
  titleGroup.append(title, meta);
  const download = document.createElement("a");
  download.className = "download-link download-button";
  download.href = chart.csv_path;
  download.download = `${chart.chart_id}.csv`;
  download.textContent = "Download chart CSV";
  header.append(titleGroup, download);

  const toolbar = document.createElement("div");
  toolbar.className = "chart-toolbar";
  const viewControl = document.createElement("div");
  viewControl.className = "segmented-control";
  const currentView = state.views.get(chart.chart_id) || "level";
  if (chart.supports_index) {
    ["level", "indexed"].forEach((view) => viewControl.append(makeButton(
      view === "level" ? "Rate" : "Index 100",
      currentView === view,
      async () => {
        state.views.set(chart.chart_id, view);
        await renderCharts();
      },
    )));
  }
  const rangeControl = document.createElement("div");
  rangeControl.className = "segmented-control";
  const defaultRange = chart.available_ranges.includes("1Y") ? "1Y" : chart.available_ranges[0];
  const currentRange = state.ranges.get(chart.chart_id) || defaultRange;
  chart.available_ranges.forEach((range) => rangeControl.append(makeButton(
    range === "FULL" ? "Full" : range,
    currentRange === range,
    async () => {
      state.ranges.set(chart.chart_id, range);
      await renderCharts();
    },
  )));
  toolbar.append(viewControl, rangeControl);
  if (!chart.supports_index) viewControl.hidden = true;

  const shell = document.createElement("div");
  shell.className = "chart-shell";
  const chartElement = document.createElement("div");
  chartElement.className = "chart";
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.hidden = true;
  shell.append(chartElement, tooltip);
  drawSingleChart(chartElement, tooltip, rows, chart, currentRange, currentView);

  const footer = document.createElement("div");
  footer.className = "chart-footer";
  const sourceText = document.createElement("p");
  sourceText.textContent = `${chart.source_name}. ${chart.observations.toLocaleString("en")} observations; missing dates are not filled.${chart.transformation === "none" ? "" : ` Transformation: ${chart.transformation}.`}`;
  const sourceLink = document.createElement("a");
  sourceLink.href = chart.source_documentation_url || chart.source_url;
  sourceLink.target = "_blank";
  sourceLink.rel = "noopener noreferrer";
  sourceLink.textContent = "Official source";
  footer.append(sourceText, sourceLink);
  card.append(header, toolbar, shell, footer);
  return card;
}

async function createAfricaCombinedCard(charts) {
  const rowLists = await Promise.all(charts.map(rowsFor));
  const chartId = "africa_combined";
  const range = state.ranges.get(chartId) || "1Y";
  const dateCounts = new Map();
  rowLists.forEach((rows) => rows.forEach((row) => dateCounts.set(row.observation_date, (dateCounts.get(row.observation_date) || 0) + 1)));
  const commonDates = [...dateCounts.entries()].filter(([, count]) => count === charts.length).map(([date]) => date).sort();
  if (!commonDates.length) throw new Error("The African FX series have no shared observation date.");
  const end = commonDates.at(-1);
  const horizon = { "1M": 31, "1Y": 366, "5Y": 1828 }[range];
  const threshold = horizon ? dayNumber(end) - horizon : -Infinity;
  const baseDate = commonDates.find((item) => dayNumber(item) >= threshold) || commonDates[0];
  const series = charts.map((chart, index) => {
    const rows = rowLists[index];
    const base = rows.find((row) => row.observation_date === baseDate).value;
    return {
      chart,
      rows: rows.filter((row) => row.observation_date >= baseDate && row.observation_date <= end)
        .map((row) => ({ ...row, indexValue: (row.value / base) * 100 })),
    };
  });
  const values = series.flatMap((item) => item.rows.map((row) => row.indexValue));
  const frame = chartFrame(values, dayNumber(baseDate), dayNumber(end));
  const card = document.createElement("article");
  card.className = "chart-card";
  const header = document.createElement("div");
  header.className = "chart-card-header";
  const titleGroup = document.createElement("div");
  const title = document.createElement("h2");
  title.textContent = "African currencies — Index 100";
  const meta = document.createElement("p");
  meta.className = "chart-meta";
  meta.textContent = `Shared base ${formatDate(baseDate)} = 100 · common endpoint ${formatDate(end)}`;
  titleGroup.append(title, meta);
  const download = document.createElement("a");
  download.className = "download-link download-button";
  download.href = "data/africa_fx_daily.csv";
  download.download = "africa_fx_daily.csv";
  download.textContent = "Download African FX CSV";
  header.append(titleGroup, download);
  const toolbar = document.createElement("div");
  toolbar.className = "chart-toolbar";
  const spacer = document.createElement("span");
  const ranges = document.createElement("div");
  ranges.className = "segmented-control";
  ["1M", "1Y", "5Y", "FULL"].forEach((item) => ranges.append(makeButton(item === "FULL" ? "Full" : item, item === range, async () => {
    state.ranges.set(chartId, item);
    await renderCharts();
  })));
  toolbar.append(spacer, ranges);
  const legend = document.createElement("div");
  legend.className = "chart-legend";
  series.forEach((item, index) => {
    const legendItem = document.createElement("span");
    legendItem.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = SERIES_STYLE[index];
    const label = document.createElement("span");
    label.textContent = item.chart.currency_iso3;
    legendItem.append(swatch, label);
    legend.append(legendItem);
  });
  const shell = document.createElement("div");
  shell.className = "chart-shell";
  const chartElement = document.createElement("div");
  chartElement.className = "chart";
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.hidden = true;
  const visibleCommonDates = commonDates.filter((item) => item >= baseDate);
  const visibleCommonDays = visibleCommonDates.map(dayNumber);
  const svg = svgElement("svg", { viewBox: `0 0 ${frame.width} ${frame.height}`, tabindex: "0", "aria-label": "Indexed African exchange-rate comparison. Use left and right arrow keys for shared dates." });
  addAxes(svg, frame, visibleCommonDates, true);
  series.forEach((item, index) => segmentsFor(item.rows, "daily").forEach((segment) => {
    const path = segment.map((row, offset) => `${offset === 0 ? "M" : "L"} ${frame.x(dayNumber(row.observation_date))} ${frame.y(row.indexValue)}`).join(" ");
    svg.append(svgElement("path", { d: path, fill: "none", stroke: SERIES_STYLE[index], "stroke-width": 2.5 }));
  }));
  const guide = svgElement("line", { y1: frame.margin.top, y2: frame.height - frame.margin.bottom, class: "hover-guide", visibility: "hidden" });
  const points = series.map((_item, index) => {
    const point = svgElement("circle", { r: 4.5, fill: "#fff", stroke: SERIES_STYLE[index], "stroke-width": 3, visibility: "hidden" });
    svg.append(point);
    return point;
  });
  svg.append(guide);
  const showValues = (index, event = null) => {
    const bounded = Math.max(0, Math.min(visibleCommonDates.length - 1, index));
    state.hover.set(chartId, bounded);
    const selectedDate = visibleCommonDates[bounded];
    const selectedDay = dayNumber(selectedDate);
    const x = frame.x(selectedDay);
    guide.setAttribute("x1", x);
    guide.setAttribute("x2", x);
    guide.setAttribute("visibility", "visible");
    tooltip.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = formatDate(selectedDate);
    tooltip.append(heading);
    let firstY = frame.margin.top;
    series.forEach((item, seriesIndex) => {
      const row = nearestRow(item.rows, selectedDay);
      const y = frame.y(row.indexValue);
      if (seriesIndex === 0) firstY = y;
      points[seriesIndex].setAttribute("cx", frame.x(dayNumber(row.observation_date)));
      points[seriesIndex].setAttribute("cy", y);
      points[seriesIndex].setAttribute("visibility", "visible");
      const line = document.createElement("span");
      line.textContent = `${item.chart.currency_iso3}: ${row.indexValue.toFixed(2)} · ${formatDate(row.observation_date)}`;
      line.style.color = SERIES_STYLE[seriesIndex];
      tooltip.append(line);
    });
    tooltip.hidden = false;
    positionTooltip(tooltip, shell, event, x, firstY);
  };
  svg.addEventListener("pointermove", (event) => {
    const bounds = svg.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * frame.width;
    const target = frame.firstDay + ((svgX - frame.margin.left) / frame.innerWidth) * frame.daySpan;
    showValues(nearestIndex(visibleCommonDays, target), event);
  });
  svg.addEventListener("pointerleave", () => {
    guide.setAttribute("visibility", "hidden");
    points.forEach((point) => point.setAttribute("visibility", "hidden"));
    tooltip.hidden = true;
  });
  svg.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let index = state.hover.get(chartId) ?? visibleCommonDates.length - 1;
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = visibleCommonDates.length - 1;
    else index += event.key === "ArrowRight" ? 1 : -1;
    showValues(index);
  });
  chartElement.append(svg);
  shell.append(chartElement, tooltip);
  const footer = document.createElement("div");
  footer.className = "chart-footer";
  const note = document.createElement("p");
  note.textContent = "A rising index means local-currency depreciation. Every series uses the same observed base date; missing dates remain gaps.";
  footer.append(note);
  card.append(header, toolbar, legend, shell, footer);
  return card;
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", state.tab);
  if (state.tab === "africa") url.searchParams.set("country", state.africaCurrency);
  else url.searchParams.delete("country");
  window.history.replaceState({}, "", url);
}

function renderMainTabs() {
  const tabs = byId("main-tabs");
  tabs.replaceChildren();
  manifest.tabs.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.textContent = tab.label;
    button.setAttribute("aria-selected", String(tab.tab_id === state.tab));
    button.addEventListener("click", async () => {
      state.tab = tab.tab_id;
      updateUrl();
      renderMainTabs();
      await renderCharts();
    });
    tabs.append(button);
  });
}

function renderAfricaTabs() {
  const container = byId("africa-tabs");
  container.replaceChildren();
  ["ALL", ...manifest.africa_currencies].forEach((currency) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.textContent = currency === "ALL" ? "All" : currency;
    button.setAttribute("aria-selected", String(currency === state.africaCurrency));
    button.addEventListener("click", async () => {
      state.africaCurrency = currency;
      updateUrl();
      await renderCharts();
    });
    container.append(button);
  });
}

async function renderCharts() {
  const grid = byId("chart-grid");
  grid.replaceChildren();
  const africaControls = byId("africa-controls");
  africaControls.hidden = state.tab !== "africa";
  if (state.tab === "africa") {
    renderAfricaTabs();
    const download = byId("country-download");
    if (state.africaCurrency === "ALL") {
      download.href = "data/africa_fx_daily.csv";
      download.download = "africa_fx_daily.csv";
      download.textContent = "Download all African FX";
      const charts = manifest.charts.filter((chart) => chart.tab_id === "africa" && chart.kind === "fx");
      grid.append(await createAfricaCombinedCard(charts));
      return;
    }
    const fxChart = manifest.charts.find((chart) => chart.currency_iso3 === state.africaCurrency && chart.kind === "fx");
    const countryIso3 = fxChart.country_iso3;
    download.href = manifest.country_downloads[countryIso3];
    download.download = `${countryIso3.toLowerCase()}_all_series.csv`;
    download.textContent = "Download country data";
    const charts = manifest.charts.filter((chart) => chart.tab_id === "africa" && chart.country_iso3 === countryIso3);
    for (const chart of charts) grid.append(await createChartCard(chart));
    return;
  }

  const charts = manifest.charts.filter((chart) => chart.tab_id === state.tab);
  for (const chart of charts) grid.append(await createChartCard(chart));
  if (state.tab === "us" || state.tab === "china") {
    const countryIso3 = state.tab === "us" ? "USA" : "CHN";
    const countryDownload = document.createElement("a");
    countryDownload.className = "download-link download-button";
    countryDownload.href = manifest.country_downloads[countryIso3];
    countryDownload.download = `${countryIso3.toLowerCase()}_all_series.csv`;
    countryDownload.textContent = `Download all ${state.tab === "us" ? "US" : "China"} data`;
    const wrapper = document.createElement("div");
    wrapper.append(countryDownload);
    grid.prepend(wrapper);
  }
  if (!charts.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No public series are available for this tab.";
    grid.append(empty);
  }
}

async function initialise() {
  try {
    const response = await fetch("data/manifest.json");
    if (!response.ok) throw new Error("The public data manifest is unavailable.");
    manifest = await response.json();
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get("tab");
    const requestedCountry = url.searchParams.get("country")?.toUpperCase();
    if (manifest.tabs.some((tab) => tab.tab_id === requestedTab)) state.tab = requestedTab;
    if (requestedCountry === "ALL" || manifest.africa_currencies.includes(requestedCountry)) state.africaCurrency = requestedCountry;
    renderMainTabs();
    setText("data-status", `Updated ${manifest.as_of_date} · ${manifest.total_series_observation_count.toLocaleString("en")} public observations`);
    await renderCharts();
  } catch (error) {
    setText("data-status", "Data unavailable");
    byId("error-panel").hidden = false;
    byId("error-panel").textContent = error.message;
  }
}

initialise();
