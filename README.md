# Schooling and Literacy

An interactive country comparison answering: **Do countries with more years of schooling have higher literacy rates?**

The primary view plots average years of schooling against adult literacy. A linked Three.js globe shows the geography of the same matched observations. All runtime assets are local; no CDN, API key, or build step is required.

## GitHub Pages

The website's `index.html`, scripts, styles, `data/`, and `vendor/` are in the repository root, ready for GitHub Pages without a build step. Upload or commit these files directly to the repository root, rather than inside a `dist/` or `literacy-globe/` subfolder.

In repository **Settings → Pages**, use **Deploy from a branch**, select **main** and **/(root)**, and click **Save**. Each push to `main` publishes the site. The root `.nojekyll` file keeps GitHub Pages from processing the static files with Jekyll.

The site URL is https://lascic.github.io/Assignment-III/. The deployment status and live URL are also shown in repository **Settings → Pages**. All runtime paths are relative, so both repository project URLs and custom domains work. Publishing from the root also makes the repository's documentation, preparation scripts, and third-party license notices available alongside the site. The site needs no server-side services or secrets.

## Run locally

On macOS, double-click `Start Literacy Atlas.command` in Finder, or run:

```sh
python3 scripts/serve.py
```

The launcher starts a local web server and opens the visualization in your default browser. Keep its Terminal window open while exploring; Control-C stops it.

To serve manually from this directory:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 in a browser with WebGL enabled. Opening the HTML directly through `file://` will not load module scripts or data correctly.

## Explore

- Each scatterplot dot is one modern mapped country/territory with both measures in the selected year.
- Hover or focus a dot to select its country, inspect both values, and zoom the globe to fit that country. Moving off the dot or moving keyboard focus away restores the default zoom while keeping the globe's current orientation. Small countries receive a closer view; mainland geometry or the main archipelago determines the fit. Tap selects and zooms on touch devices. Reduced-motion preferences apply to both zooming in and resetting. Manual globe interaction or Escape cancels automatic movement. Hover the globe to highlight its matching dot.
- Plot comparisons close when the pointer or keyboard focus leaves the point, while the globe returns to its default zoom. Touch comparisons remain readable after a tap. China is labeled on the scatterplot and remains the comparison point in the overlay.
- The overlay compares schooling and literacy with labeled horizontal bars and exact numerical values. Schooling bars share the scatterplot's fixed zero-based scale; literacy bars use 0–100%. China uses a muted reference bar. Missing pairs show no filled bar, so they cannot be mistaken for zero.
- If a country has no matched observations, its overlay offers the nearest selectable year with exact schooling and literacy values for both it and China, if one exists. Equal-distance ties choose the earlier year.
- Drag the globe to rotate, scroll to zoom, or focus it and use arrow keys and +/−. Escape dismisses the overlay.
- The timeline labels every available year at its actual calendar position. Dragging snaps to a valid year; keyboard controls step between valid years.

## Exact join and missing data

Both datasets join **only on identical country code and identical calendar year**. No interpolation, forward/back filling, nearest-year merging, or country-name fallback is used. A literacy rate from 2011 is never paired with a schooling estimate from 2010.

A country is plotted only if both original files contain finite values for that country in the selected year. Countries without that pair are grey on the globe and absent from the scatterplot. Zero is a valid value. Regional aggregates and historical entities are not reassigned to modern country boundaries.

The timeline contains 1950, 1990, 2000, 2010, and 2020: years with at least three matched countries, including a matched China pair. This preserves same-year China comparisons while limiting the relationship analysis to usable data. For example, 1982 has China literacy but no schooling observation, so it is excluded.

The starting year is **2010**, the latest available year with historical schooling estimates and a China comparison. The supplied schooling file contains data through 2020; its metadata's broader stated timespan does not create additional observations.

## Interpreting the relationship

The app calculates an unweighted Pearson correlation and ordinary least-squares trend for the matched countries **within each individual year**. Countries have equal weight. It does not pool observations across years or treat this as a population-weighted literacy estimate.

In 2010, **28** matched countries give **r = 0.8130903823765536**, a positive association. Country coverage changes between years, so a change in correlation is not necessarily a change in the relationship for the same set of countries. Association does not establish causation.

Schooling measures formal education for ages **15–64**, excluding repeated grades; literacy generally covers ages **15 and older**. Historical literacy definitions and population coverage vary. These are related but different cohorts and measures.

Schooling values before 2015 are historical estimates. Values from 2015 onward are **projections based on 2010**, not observed schooling outcomes; the 2020 view states this explicitly.

Yellow represents 0% literate; blue represents 100%. Intermediate rates use a continuous yellow–green–blue scale. This scale colors both country dots and the globe.

## Sources and reproducibility

- Literacy: UNESCO (1957) and other sources, with major processing by Our World in Data. [Literate and illiterate world population](https://ourworldindata.org/grapher/literate-and-illiterate-world-population).
- Schooling: Barro and Lee (2015); Lee and Lee (2016), with major processing by Our World in Data. [Average years of schooling](https://ourworldindata.org/grapher/mean-years-of-schooling-long-run).
- Geography: Natural Earth 1:50m admin-0 countries, public domain; present-day de facto boundaries are used for all years.
- Libraries: Three.js 0.180.0, d3-array 3.2.4, d3-geo 3.1.1. Licenses are in `vendor/`.

Original CSVs and complete metadata are included in `data/`. Source links on the page identify the two datasets used in this analysis.

`scripts/prepare-data.py` prepares literacy observations. `scripts/prepare-schooling.py` prepares schooling observations and `data/joint-analysis.json`, independently validating exact joins and reference statistics against both original CSVs. Both scripts use the bundled CSVs and metadata when the original sibling dataset folders are absent, so they also work in a standalone clone:

```sh
python3 scripts/prepare-data.py
python3 scripts/prepare-schooling.py
```

`scripts/prepare-geography.py` prepares country geometry from the official [Natural Earth source GeoJSON](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson); pass the downloaded file as its command-line argument. The ready-to-use geometry is already bundled, so rebuilding it is optional.

The client calculates its joins and statistics from the two browser datasets; it does not rely on precomputed analysis values for rendering. `relationship.js` contains the SVG scatterplot and statistic calculations. Static hosting uses the repository root.
