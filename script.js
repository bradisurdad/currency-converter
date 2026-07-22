/* Currency converter — vanilla JS, no dependencies.
 *
 * Two endpoints from the Frankfurter API (no key required):
 *   GET /v1/currencies                          -> { "USD": "US Dollar", ... }
 *   GET /v1/latest?base=USD&symbols=EUR         -> { amount, base, date, rates: { EUR: 0.87 } }
 */

const API = "https://api.frankfurter.dev/v1";

// Grab every element once up front instead of re-querying the DOM on each use.
const form      = document.getElementById("converter");
const amountEl  = document.getElementById("amount");
const fromEl    = document.getElementById("from");
const toEl      = document.getElementById("to");
const swapBtn   = document.getElementById("swap");
const convertBtn = document.getElementById("convert");
const resultEl  = document.getElementById("result");
const errorEl   = document.getElementById("error");
const themeBtn  = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");

/* ------------------------------------------------------------------ *
 * Theme
 *
 * All the actual colours live in style.css. This only decides which of the
 * three states applies and records the choice:
 *
 *   no data-theme attribute -> CSS follows the OS (prefers-color-scheme)
 *   data-theme="dark|light" -> an explicit choice, which overrides the OS
 *
 * A small inline script in <head> reads the saved value before first paint,
 * so a dark preference never flashes white on load.
 * ------------------------------------------------------------------ */

const root = document.documentElement;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

// Reading and writing localStorage can throw (private mode, file:// in some
// browsers). Theming isn't worth breaking the app over, so both are wrapped —
// the toggle keeps working, it just won't remember across reloads.
function savedTheme() {
  try {
    const value = localStorage.getItem("theme");
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

function rememberTheme(theme) {
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* not fatal — the theme still applies for this session */
  }
}

// The theme actually in effect right now: an explicit choice if one was made,
// otherwise whatever the OS is asking for.
function activeTheme() {
  return root.getAttribute("data-theme") || (darkQuery.matches ? "dark" : "light");
}

function applyTheme(theme) {
  root.setAttribute("data-theme", theme);

  // The button offers the *other* theme, so icon and label describe where
  // you'd land, not where you are.
  const next = theme === "dark" ? "light" : "dark";
  themeIcon.textContent = theme === "dark" ? "☀" : "🌙";
  themeBtn.setAttribute("aria-label", `Switch to ${next} theme`);
  themeBtn.title = `Switch to ${next} theme`;

  // Tells assistive tech this is a two-state control, not a plain action.
  themeBtn.setAttribute("aria-pressed", String(theme === "dark"));
}

themeBtn.addEventListener("click", () => {
  const next = activeTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  rememberTheme(next);
});

// If the user hasn't chosen explicitly, keep following the OS when it changes
// (e.g. an automatic switch at sunset) instead of freezing at load-time state.
darkQuery.addEventListener("change", (event) => {
  if (!savedTheme()) {
    applyTheme(event.matches ? "dark" : "light");
  }
});

// Sync the button to whatever is on screen at startup.
applyTheme(activeTheme());

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function showError(message) {
  errorEl.textContent = message;
  resultEl.textContent = ""; // never show a stale result next to an error
}

function clearMessages() {
  errorEl.textContent = "";
  resultEl.textContent = "";
}

/* A single wrapper around fetch() used by both requests below.
 *
 * fetch() only rejects on a *network* failure (offline, DNS error, CORS block).
 * An HTTP error like 404 or 500 still resolves successfully, so we have to
 * check `response.ok` ourselves and throw — otherwise we'd try to read a rate
 * out of an error page. Both failure modes end up as a thrown Error, which
 * means every caller can handle them in one catch block.
 *
 * AbortSignal.timeout() cancels the request if the server never answers,
 * so a hung connection surfaces as an error instead of a spinner forever.
 */
async function fetchJSON(url) {
  let response;

  try {
    // `await` pauses this function until the server responds, without
    // blocking the page — the browser stays interactive the whole time.
    response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  } catch (networkError) {
    // We land here only when the request never completed at all.
    if (networkError.name === "TimeoutError") {
      throw new Error("The request timed out. Please try again.");
    }
    throw new Error("Network error — check your internet connection and try again.");
  }

  if (!response.ok) {
    throw new Error(`The rate service responded with an error (HTTP ${response.status}).`);
  }

  // .json() is itself async: it waits for the body to finish downloading,
  // then parses it. It throws if the body isn't valid JSON.
  try {
    return await response.json();
  } catch {
    throw new Error("Received an unreadable response from the rate service.");
  }
}

/* ------------------------------------------------------------------ *
 * Step 1: populate the dropdowns
 * ------------------------------------------------------------------ */

async function loadCurrencies() {
  try {
    // Response looks like { AUD: "Australian Dollar", BRL: "Brazilian Real", ... }
    const currencies = await fetchJSON(`${API}/currencies`);
    const codes = Object.keys(currencies).sort();

    if (codes.length === 0) {
      throw new Error("The rate service returned no currencies.");
    }

    // Build the <option> list once as a document fragment, then attach it in a
    // single DOM write per dropdown rather than 30+ separate appends.
    const buildOptions = () => {
      const frag = document.createDocumentFragment();
      for (const code of codes) {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = `${code} — ${currencies[code]}`;
        frag.appendChild(opt);
      }
      return frag;
    };

    fromEl.replaceChildren(buildOptions());
    toEl.replaceChildren(buildOptions());

    // Sensible defaults, falling back to the first entries if the API's
    // currency list ever changes and USD/EUR aren't present.
    fromEl.value = codes.includes("USD") ? "USD" : codes[0];
    toEl.value   = codes.includes("EUR") ? "EUR" : codes[1] || codes[0];

    // Everything loaded — unlock the form.
    fromEl.disabled = false;
    toEl.disabled = false;
    swapBtn.disabled = false;
    convertBtn.disabled = false;
  } catch (err) {
    // Leave the controls disabled: without a currency list there's nothing
    // meaningful to convert between.
    showError(`Couldn't load the currency list. ${err.message}`);
    fromEl.replaceChildren(new Option("Unavailable"));
    toEl.replaceChildren(new Option("Unavailable"));
  }
}

/* ------------------------------------------------------------------ *
 * Step 2: convert
 * ------------------------------------------------------------------ */

function readAmount() {
  const raw = amountEl.value.trim();

  // A number input reports an empty `.value` when the typed text isn't
  // parseable (e.g. "1e", "--2"). `validity.badInput` distinguishes that from
  // a genuinely empty box so the message matches what the user sees.
  if (amountEl.validity && amountEl.validity.badInput) {
    return { error: "Please enter a valid number." };
  }

  if (raw === "") {
    return { error: "Please enter an amount." };
  }

  // Number() rejects junk like "12abc" that parseFloat() would happily
  // truncate to 12. It also treats "" as 0, which the check above rules out.
  const value = Number(raw);

  if (!Number.isFinite(value)) {
    return { error: "Please enter a valid number." };
  }
  if (value < 0) {
    return { error: "Amount can't be negative." };
  }

  return { value };
}

async function convert() {
  clearMessages();
  amountEl.classList.remove("invalid");

  const { value: amount, error } = readAmount();
  if (error) {
    amountEl.classList.add("invalid");
    amountEl.focus();
    showError(error);
    return;
  }

  const from = fromEl.value;
  const to = toEl.value;

  // Kick off the history fetch alongside the rate lookup rather than after it,
  // so the two requests overlap. Deliberately not awaited: the chart depends
  // only on the pair, not the amount, and it reports its own errors — a chart
  // failure must never block or disturb the conversion result.
  loadHistory(from, to);

  // Two cases the API won't answer usefully, both settled locally instead:
  //   - base === symbol: it returns an empty `rates` object
  //   - amount === 0:    it rejects the request with HTTP 422
  // Converting zero of anything is zero, so no round trip is needed.
  if (from === to) {
    render(amount, amount, from, to, 1, null);
    return;
  }
  if (amount === 0) {
    render(0, 0, from, to, null, null);
    return;
  }

  // Lock both buttons for the duration of the request. Convert is locked so a
  // double-click can't fire overlapping conversions; swap is locked because
  // flipping the dropdowns mid-request would leave them describing a different
  // pair than the result that's about to land.
  convertBtn.disabled = true;
  swapBtn.disabled = true;
  convertBtn.textContent = "Converting…";
  form.classList.add("loading");

  try {
    // Ask the API to do the multiplication by passing `amount`; we still read
    // `rates` so we can show the per-unit rate underneath the result.
    const url = `${API}/latest?amount=${encodeURIComponent(amount)}` +
                `&base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;

    const data = await fetchJSON(url);
    const converted = data?.rates?.[to];

    // Guard against a well-formed response that's missing the pair we asked
    // for — better a clear message than "undefined" rendered as the result.
    if (typeof converted !== "number") {
      throw new Error(`No rate available for ${from} → ${to}.`);
    }

    // Per-unit rate: the response is already multiplied by `amount`.
    const unitRate = amount === 0 ? null : converted / amount;
    render(amount, converted, from, to, unitRate, data.date);
  } catch (err) {
    showError(err.message);
  } finally {
    // `finally` runs whether the request succeeded or threw, so the buttons
    // always come back — no way to get stuck on "Converting…".
    convertBtn.disabled = false;
    swapBtn.disabled = false;
    convertBtn.textContent = "Convert";
    form.classList.remove("loading");
  }
}

/* ------------------------------------------------------------------ *
 * Step 3: render
 * ------------------------------------------------------------------ */

function render(amount, converted, from, to, unitRate, date) {
  // Intl formats with the right decimal places, grouping and symbol per
  // currency — no hardcoded "$" or toFixed(2) guesswork.
  const fmt = (n, code) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(n);

  const rateText = unitRate === null
    ? ""
    : `1 ${from} = ${unitRate.toPrecision(6)} ${to}${date ? ` · rates from ${date}` : ""}`;

  // textContent (not innerHTML) on each node keeps API-supplied strings as
  // text and never as markup.
  const out = document.createElement("span");
  out.className = "amount-out";
  out.textContent = fmt(converted, to);

  const sub = document.createElement("span");
  sub.className = "rate-line";
  // Join with "·" only when there's a rate line, so we don't leave a dangling
  // separator on the zero-amount and same-currency paths.
  sub.textContent = [fmt(amount, from), rateText].filter(Boolean).join(" · ");

  resultEl.replaceChildren(out, sub);
}

/* ------------------------------------------------------------------ *
 * Rate history chart
 *
 * Hand-drawn SVG — no chart library, same as the rest of the app.
 *
 * Endpoint: GET /v1/{start}..{end}?base=USD&symbols=EUR
 *   -> { amount, base, start_date, end_date, rates: { "2026-06-22": { EUR: 0.87 }, ... } }
 *
 * Note the API only publishes on weekdays, so 30 calendar days is roughly 22
 * points. They're plotted evenly by index rather than by true date position:
 * that's the usual convention for market data and avoids weekend gaps.
 *
 * The one data colour is --series (the accent blue). It was checked against
 * both card surfaces for the OKLCH lightness band, the chroma floor, and 3:1
 * contrast — it passes in light and dark. With a single series there are no
 * colour pairs to confuse, so no legend is needed either: the heading names
 * exactly what's plotted.
 * ------------------------------------------------------------------ */

const HISTORY_DAYS = 30;
const SVG_NS = "http://www.w3.org/2000/svg";

const chartSection = document.getElementById("chart-section");
const chartTitle   = document.getElementById("chart-title");
const chartStatus  = document.getElementById("chart-status");
const chartWrap    = document.getElementById("chart-wrap");
const chartSvg     = document.getElementById("chart");
const chartDesc    = document.getElementById("chart-desc");
const tooltipEl    = document.getElementById("chart-tooltip");
const tableToggle  = document.getElementById("table-toggle");
const tableBox     = document.getElementById("chart-table");

// Plot geometry, in SVG user units. The viewBox scales to the card width, so
// these are proportions rather than pixels. The bottom pad reserves room for
// the x-axis labels — a fixed height that excludes them would force a nested
// scrollbar; the right pad reserves a gutter for the end label so it can never
// collide with the plot edge.
const VB = { w: 600, h: 240 };
const PAD = { t: 16, r: 58, b: 28, l: 52 };
const PLOT_W = VB.w - PAD.l - PAD.r;
const PLOT_H = VB.h - PAD.t - PAD.b;

let historyPoints = [];  // [{ date: "2026-06-22", value: 0.87291 }, ...]
let historyPair = "";    // which pair is currently drawn, e.g. "USD:EUR"
let historyScale = null; // y-axis scale in use, kept for the hover layer
let cursorIndex = -1;    // point the crosshair is on, -1 for none

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  return node;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

/* Round an axis to human numbers (0.87, 0.88, …) instead of whatever the data
 * min/max happen to be. Standard "nice number" rounding to a 1/2/5 × 10^n step. */
function niceNum(range, round) {
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice;
  if (round) {
    nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  } else {
    nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  }
  return nice * Math.pow(10, exp);
}

function niceScale(min, max, tickCount) {
  // A flat line (every rate identical) would give a zero range and divide by
  // zero below, so give it a small artificial spread.
  if (min === max) {
    const pad = Math.abs(min) * 0.01 || 0.01;
    min -= pad;
    max += pad;
  }
  const step = niceNum(niceNum(max - min, false) / (tickCount - 1), true);
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
    step,
  };
}

// Exchange rates span very different magnitudes (0.87 EUR vs 162.74 JPY), so
// derive tick precision from the axis step rather than hardcoding 2 — just
// enough decimals to tell one tick from the next, and no trailing noise.
function tickDecimals(step) {
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))));
}

// Readouts (end label, tooltip, table) want real precision rather than the
// axis's coarser step. Significant digits handle both ends of the magnitude
// range: 0.87580 -> "0.8758", 162.74 -> "162.74".
function formatRate(value) {
  const text = value.toPrecision(5);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

function formatDate(iso) {
  // Parse as local midnight; a bare "YYYY-MM-DD" is treated as UTC and can
  // display as the previous day in negative-offset time zones.
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

const xAt = (i) =>
  PAD.l + (historyPoints.length < 2 ? PLOT_W / 2 : (i / (historyPoints.length - 1)) * PLOT_W);

const yAt = (value) =>
  PAD.t + PLOT_H - ((value - historyScale.min) / (historyScale.max - historyScale.min)) * PLOT_H;

/* ---- drawing ---- */

function drawChart(from, to) {
  const values = historyPoints.map((p) => p.value);
  historyScale = niceScale(Math.min(...values), Math.max(...values), 4);

  const decimals = tickDecimals(historyScale.step);
  const frag = document.createDocumentFragment();

  // Gridlines + y ticks. Step by index rather than accumulating floats, which
  // would drift and produce ticks like 0.8700000000000001.
  const steps = Math.round((historyScale.max - historyScale.min) / historyScale.step);
  for (let i = 0; i <= steps; i++) {
    const value = historyScale.min + i * historyScale.step;
    const y = yAt(value);
    frag.appendChild(svgEl("line", { class: "grid", x1: PAD.l, x2: PAD.l + PLOT_W, y1: y, y2: y }));
    const label = svgEl("text", { class: "tick tick-y", x: PAD.l - 8, y });
    label.textContent = value.toFixed(decimals);
    frag.appendChild(label);
  }

  // Area wash, then the line on top of it
  const line = historyPoints
    .map((p, i) => `${i ? "L" : "M"}${xAt(i).toFixed(2)},${yAt(p.value).toFixed(2)}`)
    .join("");
  const baseY = PAD.t + PLOT_H;
  frag.appendChild(
    svgEl("path", {
      class: "area",
      d: `${line}L${xAt(historyPoints.length - 1).toFixed(2)},${baseY}L${xAt(0).toFixed(2)},${baseY}Z`,
    })
  );
  frag.appendChild(svgEl("path", { class: "line", d: line }));

  // Baseline
  frag.appendChild(
    svgEl("line", { class: "axis", x1: PAD.l, x2: PAD.l + PLOT_W, y1: baseY, y2: baseY })
  );

  // Only the first and last dates are labelled — a label per point would be
  // unreadable, and the tooltip and table carry the rest.
  const firstLabel = svgEl("text", { class: "tick tick-x", x: PAD.l, y: baseY + 16 });
  firstLabel.textContent = formatDate(historyPoints[0].date);
  frag.appendChild(firstLabel);

  const lastLabel = svgEl("text", {
    class: "tick tick-x",
    x: PAD.l + PLOT_W,
    y: baseY + 16,
  });
  lastLabel.textContent = formatDate(historyPoints[historyPoints.length - 1].date);
  frag.appendChild(lastLabel);

  // End marker + the single direct label: the latest rate, in the right gutter
  const last = historyPoints[historyPoints.length - 1];
  const lastX = xAt(historyPoints.length - 1);
  const lastY = yAt(last.value);
  frag.appendChild(svgEl("circle", { class: "dot", cx: lastX, cy: lastY, r: 4 }));
  const endLabel = svgEl("text", { class: "end-label", x: lastX + 9, y: lastY });
  endLabel.textContent = formatRate(last.value);
  frag.appendChild(endLabel);

  // Hover layer: a crosshair that snaps to the nearest point, so the reader
  // aims at a date rather than at a 2px line.
  const crosshair = svgEl("g", { id: "crosshair" });
  crosshair.setAttribute("visibility", "hidden");
  crosshair.appendChild(svgEl("line", { class: "crosshair", y1: PAD.t, y2: baseY, x1: 0, x2: 0 }));
  crosshair.appendChild(svgEl("circle", { class: "dot", r: 4, cx: 0, cy: 0 }));
  frag.appendChild(crosshair);

  // Transparent hit area covering the whole plot, so the pointer only has to be
  // near a point, never on it.
  frag.appendChild(
    svgEl("rect", { class: "hit", x: PAD.l, y: PAD.t, width: PLOT_W, height: PLOT_H })
  );

  chartSvg.setAttribute("viewBox", `0 0 ${VB.w} ${VB.h}`);
  chartSvg.replaceChildren(frag);

  // Text alternative for screen readers, so the shape isn't sight-only.
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  chartDesc.textContent =
    `Line chart of 1 ${from} in ${to} over the last ${HISTORY_DAYS} days, ` +
    `${historyPoints.length} readings from ${formatDate(historyPoints[0].date)} ` +
    `to ${formatDate(last.date)}. Low ${formatRate(lowest)}, ` +
    `high ${formatRate(highest)}, latest ${formatRate(last.value)}.`;
}

/* ---- table view (the chart's accessible twin) ---- */

function renderTable(from, to) {
  const table = document.createElement("table");

  const head = table.insertRow();
  ["Date", `1 ${from} in ${to}`].forEach((text) => {
    const th = document.createElement("th");
    th.textContent = text; // textContent, never innerHTML — these are API values
    head.appendChild(th);
  });

  // Newest first: the recent end is what people look for.
  for (let i = historyPoints.length - 1; i >= 0; i--) {
    const row = table.insertRow();
    row.insertCell().textContent = historyPoints[i].date;
    row.insertCell().textContent = formatRate(historyPoints[i].value);
  }

  tableBox.replaceChildren(table);
}

/* ---- hover & keyboard ---- */

function moveCursor(index) {
  if (!historyPoints.length) return;
  cursorIndex = Math.max(0, Math.min(historyPoints.length - 1, index));

  const point = historyPoints[cursorIndex];
  const x = xAt(cursorIndex);
  const y = yAt(point.value);

  const crosshair = chartSvg.querySelector("#crosshair");
  if (!crosshair) return;
  crosshair.setAttribute("visibility", "visible");
  const [line, dot] = crosshair.children;
  line.setAttribute("x1", x);
  line.setAttribute("x2", x);
  dot.setAttribute("cx", x);
  dot.setAttribute("cy", y);

  // The SVG is scaled to the card, so convert user units to CSS pixels before
  // positioning the HTML tooltip over it.
  const rect = chartSvg.getBoundingClientRect();
  const scale = rect.width / VB.w;

  const value = document.createElement("span");
  value.className = "tip-value";
  value.textContent = formatRate(point.value);
  const date = document.createElement("span");
  date.className = "tip-date";
  date.textContent = formatDate(point.date);

  tooltipEl.replaceChildren(value, date);
  tooltipEl.hidden = false;
  tooltipEl.style.left = `${x * scale}px`;
  tooltipEl.style.top = `${y * scale}px`;
}

function hideCursor() {
  cursorIndex = -1;
  tooltipEl.hidden = true;
  const crosshair = chartSvg.querySelector("#crosshair");
  if (crosshair) crosshair.setAttribute("visibility", "hidden");
}

// Nearest-point lookup: map the pointer's x back into user units, then round to
// the closest index.
function indexFromPointer(event) {
  const rect = chartSvg.getBoundingClientRect();
  const userX = ((event.clientX - rect.left) / rect.width) * VB.w;
  const ratio = (userX - PAD.l) / PLOT_W;
  return Math.round(ratio * (historyPoints.length - 1));
}

chartSvg.addEventListener("pointermove", (event) => {
  if (historyPoints.length) moveCursor(indexFromPointer(event));
});
chartSvg.addEventListener("pointerleave", hideCursor);

// Keyboard gets the same readout as the pointer.
chartSvg.addEventListener("keydown", (event) => {
  if (!historyPoints.length) return;
  const start = cursorIndex === -1 ? historyPoints.length - 1 : cursorIndex;
  switch (event.key) {
    case "ArrowRight": moveCursor(start + 1); break;
    case "ArrowLeft":  moveCursor(start - 1); break;
    case "Home":       moveCursor(0); break;
    case "End":        moveCursor(historyPoints.length - 1); break;
    case "Escape":     hideCursor(); return;
    default:           return;
  }
  event.preventDefault(); // stop arrow keys scrolling the page
});
chartSvg.addEventListener("focus", () => moveCursor(historyPoints.length - 1));
chartSvg.addEventListener("blur", hideCursor);

tableToggle.addEventListener("click", () => {
  const showing = !tableBox.hidden;
  tableBox.hidden = showing;
  tableToggle.textContent = showing ? "Show table" : "Hide table";
  tableToggle.setAttribute("aria-expanded", String(!showing));
});

/* ---- loading ---- */

async function loadHistory(from, to) {
  // A currency against itself is a flat line at 1 — no information in it.
  if (from === to) {
    chartSection.hidden = true;
    return;
  }

  const pair = `${from}:${to}`;
  if (pair === historyPair && historyPoints.length) {
    return; // already on screen; don't refetch or flicker
  }

  chartSection.hidden = false;
  chartTitle.textContent = `1 ${from} in ${to} · last ${HISTORY_DAYS} days`;
  chartStatus.textContent = "";
  hideCursor();
  // Hold the previous render at reduced opacity rather than blanking the plot,
  // so switching pairs doesn't flash or jump the layout.
  chartWrap.classList.add("loading");

  try {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - (HISTORY_DAYS - 1));

    const data = await fetchJSON(
      `${API}/${isoDate(start)}..${isoDate(end)}` +
        `?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`
    );

    // Object key order isn't guaranteed by the language, so sort by date
    // rather than trusting the order the API happened to send.
    const points = Object.keys(data.rates || {})
      .sort()
      .map((date) => ({ date, value: data.rates[date] && data.rates[date][to] }))
      .filter((p) => typeof p.value === "number");

    if (points.length < 2) {
      throw new Error("Not enough history to plot.");
    }

    historyPoints = points;
    historyPair = pair;
    drawChart(from, to);
    renderTable(from, to);
  } catch (err) {
    // A chart failure must not disturb the conversion result above it, so it
    // reports into its own status line.
    historyPoints = [];
    historyPair = "";
    chartSvg.replaceChildren();
    tableBox.replaceChildren();
    chartDesc.textContent = "";
    chartStatus.textContent = `Chart unavailable. ${err.message}`;
  } finally {
    chartWrap.classList.remove("loading");
  }
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

// Submitting the form (button click *or* Enter in the amount box) converts.
// preventDefault stops the browser's default page reload.
form.addEventListener("submit", (event) => {
  event.preventDefault();
  convert();
});

swapBtn.addEventListener("click", () => {
  // Destructuring assignment swaps both values without a temp variable.
  [fromEl.value, toEl.value] = [toEl.value, fromEl.value];

  // If a result is already on screen, re-run straight away so it reflects the
  // new direction rather than leaving the user to press Convert again. The
  // in-flight check stops repeated swap clicks from stacking up requests —
  // convert() disables the button for the duration of each one.
  if (resultEl.hasChildNodes() && !convertBtn.disabled) {
    convert();
  } else {
    clearMessages();
  }
});

// Clear the invalid highlight as soon as the user starts fixing the input.
amountEl.addEventListener("input", () => {
  amountEl.classList.remove("invalid");
});

// Kick off the currency fetch as soon as the script runs. It's async, so the
// page renders immediately and the dropdowns fill in when the data arrives.
loadCurrencies();
