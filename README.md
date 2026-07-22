# Currency Converter

A small currency converter built with plain HTML, CSS, and vanilla JavaScript -
no frameworks, no build step, no dependencies. Rates come from the free
[Frankfurter API](https://frankfurter.dev), which needs no API key.

## Features

- Live conversion between 30+ currencies, populated from the API
- Swap button that flips the pair and re-converts
- 30-day rate history chart, drawn as hand-rolled SVG (no chart library)
  - hover or arrow-key a crosshair for per-day values
  - "Show table" lists every value as text
- Light/dark theme that follows your OS and remembers an explicit choice
- Visible error messages for invalid input, network failure, and API errors

## Running it locally

The app calls the Frankfurter API over HTTPS. Browsers can block that call when
a page is opened straight from disk (`file://`), so serve it over `localhost`.

**Windows (nothing to install):**

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8123>. Use `-Port 8080` if 8123 is taken.

**If you have Python or Node:**

```bash
python -m http.server 8123
```

```bash
npx serve .
```

Any static file server works — there's nothing to compile.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup, plus a small inline script that applies the saved theme before first paint |
| `style.css` | All styling; colours are CSS custom properties so the theme swaps in one place |
| `script.js` | Fetching, validation, the theme toggle, and the SVG chart |
| `serve.ps1` | Local dev server (not needed for deployment) |

## Deploying

It's a static site, so it can be hosted anywhere that serves files — GitHub
Pages, Netlify, Cloudflare Pages. All asset paths are relative, so it works
from a subpath such as `username.github.io/currency-converter/` without any
configuration.

## Credits

Exchange rate data from [Frankfurter](https://frankfurter.dev), which sources
its rates from the European Central Bank. Rates publish on weekdays only, so a
30-day window contains roughly 21 data points.
