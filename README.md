# African exchange rates

Daily official US dollar exchange-rate charts and downloadable data for selected African currencies.
The single public page leads with an indexed comparison of all five currencies, followed by the
same interactive chart for each currency. There is no separate methodology or manifest page.

The site is static and requires no application server or account. The combined tab supports 1-month
and 1-year horizons. It gives every series a value of 100 on the first shared observation date within
the selected horizon; a rising index means local-currency depreciation. Missing dates are not filled.

Data files under `data/` include the observation date, quote convention, source definition, source
identifier and retrieval time. `data/manifest.json` remains a machine-readable build and checksum
record but is not linked from the public interface.

Source data rights remain with the named providers. No open licence for the source observations is
implied by this website.
