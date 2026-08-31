# Global FX and market data

Static, source-backed charts and downloadable data for African and Chinese exchange rates, inflation,
available policy rates, US market indicators, and IMF commodity prices. Main tabs separate African
currencies, the United States, China, energy and industrial commodities, and agricultural commodities.

The site requires no application server or account. Daily charts offer 1-month, 1-year, 5-year, and
full-history windows; weekly and monthly charts offer 1-year, 5-year, and full-history windows. The
African comparison gives every series a value of 100 on one shared observed base date. Missing dates
are not filled.

Each chart CSV is full history regardless of the visible window. Country bundle CSVs and
`data/all_series.csv` use a common long-form contract with source, unit, frequency, retrieval time,
and transformation fields. `data/manifest.json` remains the machine-readable build, coverage, UI,
and checksum contract but is not linked from the public interface.

Source data rights remain with the named providers. No open licence for the source observations is
implied by this website.
