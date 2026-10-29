#!/usr/bin/env python3
"""Package schooling data and audit exact country-code/year literacy joins.

No interpolation, previous-year substitution, name matching, or extrapolation is
performed. Schooling values retain the estimates/projections in the supplied CSV.
"""

import csv
import json
import math
import shutil
from collections import Counter, defaultdict
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
INPUT = PROJECT.parent / "mean-years-of-schooling-long-run"
OUTPUT = PROJECT / "data"
VALUE_COLUMN = "Average years of schooling"
PROJECTION_START = 2015
AGGREGATE_CODES = {"OWID_AFR", "OWID_ASI", "OWID_EUR", "OWID_NAM", "OWID_OCE", "OWID_SAM", "OWID_WRL"}


def correlation(pairs):
    """Unweighted Pearson r across countries in one exact observation year."""
    if len(pairs) < 3:
        return None
    mean_x = math.fsum(pair["schooling"] for pair in pairs) / len(pairs)
    mean_y = math.fsum(pair["literacy"] for pair in pairs) / len(pairs)
    variance_x = math.fsum((pair["schooling"] - mean_x) ** 2 for pair in pairs)
    variance_y = math.fsum((pair["literacy"] - mean_y) ** 2 for pair in pairs)
    if variance_x == 0 or variance_y == 0:
        return None
    covariance = math.fsum(
        (pair["schooling"] - mean_x) * (pair["literacy"] - mean_y)
        for pair in pairs
    )
    return covariance / math.sqrt(variance_x * variance_y)


def main():
    csv_path = INPUT / "mean-years-of-schooling-long-run.csv"
    metadata_path = INPUT / "mean-years-of-schooling-long-run.metadata.json"
    if not csv_path.is_file() or not metadata_path.is_file():
        # Reuse the bundled original inputs when running from a standalone clone.
        csv_path = OUTPUT / "schooling.csv"
        metadata_path = OUTPUT / "schooling.metadata.json"
    metadata = json.loads(metadata_path.read_text())
    with csv_path.open(newline="") as stream:
        rows = list(csv.DictReader(stream))

    countries = {}
    excluded = set()
    coverage = Counter()
    original_values = {}
    for row in rows:
        code = row["Code"]
        # OWID_* codes in this schooling file are World and six continents.
        if not code or code in AGGREGATE_CODES:
            excluded.add(row["Entity"])
            continue
        year = int(row["Year"])
        value = float(row[VALUE_COLUMN]) if row[VALUE_COLUMN] else None
        assert value is None or (math.isfinite(value) and value >= 0), row
        assert (code, year) not in original_values, (code, year)
        original_values[(code, year)] = value
        country = countries.setdefault(code, {"name": row["Entity"], "observations": {}})
        country["observations"][str(year)] = {"years": value}
        if value is not None:
            coverage[year] += 1

    column = next(iter(metadata["columns"].values()))
    chart = metadata["chart"]
    data = {
        "availableYears": sorted(coverage),
        "defaultYear": 2010,
        "countries": dict(sorted(countries.items())),
        "yearCoverage": dict(sorted(coverage.items())),
        "source": {
            "title": chart["title"],
            "subtitle": chart["subtitle"],
            "definition": column["descriptionShort"],
            "unit": column["unit"],
            "ageRange": "15–64",
            "projectionStartYear": PROJECTION_START,
            "note": chart["note"],
            "measurementNote": "Years of formal education at primary/ISCED 1 or higher; repeated grades are excluded. Years of schooling do not measure education quality.",
            "cohortComparisonNote": "Schooling covers ages 15–64; modern literacy generally covers ages 15 and older. Historical literacy definitions and population coverage differ.",
            "citation": column["citationShort"],
            "fullCitation": column["citationLong"],
            "url": chart["originalChartUrl"],
            "downloaded": metadata["dateDownloaded"],
            "lastUpdated": column["lastUpdated"],
            "actualTimespan": f"{min(coverage)}–{max(coverage)}",
        },
        "excludedAggregates": sorted(excluded),
    }

    literacy = json.loads((OUTPUT / "literacy.json").read_text())
    with (OUTPUT / "literacy.csv").open(newline="") as stream:
        original_literacy = {
            (row["Code"], int(row["Year"])): float(row["Literate"])
            for row in csv.DictReader(stream)
            if row["Code"] and row["Literate"]
        }
    geography = json.loads((OUTPUT / "countries.geojson").read_text())
    mapped_codes = {feature["properties"]["code"] for feature in geography["features"]}
    paired = defaultdict(list)
    for code, country in countries.items():
        if code not in mapped_codes:
            continue
        for year_string, record in country["observations"].items():
            # Both observations are addressed by the identical country code/year.
            literacy_record = literacy["countries"].get(code, {}).get("observations", {}).get(year_string)
            years = record["years"]
            rate = literacy_record.get("literate") if literacy_record else None
            if years is None or rate is None:
                continue
            assert math.isfinite(years) and math.isfinite(rate)
            assert original_values[(code, int(year_string))] == years
            assert original_literacy[(code, int(year_string))] == rate
            paired[int(year_string)].append({
                "code": code,
                "name": literacy["countries"][code]["name"],
                "schooling": years,
                "literacy": rate,
            })

    actual_pairs = {(pair["code"], year) for year, pairs in paired.items() for pair in pairs}
    expected_pairs = {
        (code, year) for (code, year), value in original_values.items()
        if code in mapped_codes and value is not None and (code, year) in original_literacy
    }
    assert actual_pairs == expected_pairs

    analyses = {}
    for year, pairs in sorted(paired.items()):
        pairs.sort(key=lambda pair: pair["code"])
        analyses[str(year)] = {
            "year": year,
            "count": len(pairs),
            "pearsonR": correlation(pairs),
            "schoolingType": "projection" if year >= PROJECTION_START else "historical estimate",
            "pairs": pairs,
        }
    selectable_years = [
        year for year in sorted(paired)
        if len(paired[year]) >= 3
        and any(pair["code"] == "CHN" for pair in paired[year])
    ]
    assert 2010 in selectable_years
    joint = {
        "defaultYear": 2010,
        "selectableYears": selectable_years,
        "allPairedYears": sorted(paired),
        "yearsWithAtLeastThreePairs": [year for year in sorted(paired) if len(paired[year]) >= 3],
        "joinRule": "Exact country code and exact year; finite values from both supplied datasets; modern mapped country/territory codes only. No interpolation, carrying values, country-name fallback, or nearest-year matching.",
        "selectableYearRule": "At least three exact matched pairs, including a matched China pair, so the existing China comparison remains available.",
        "statistic": "Unweighted Pearson correlation across matched countries/territories within each single year; not a pooled correlation across years. Reported only for n >= 3 and nonzero variance in both measures.",
        "interpretationNote": "Association does not establish causation. The two measures cover different adult age groups, and the countries represented change between years.",
        "years": analyses,
    }

    # Validate every packaged observation, including any valid zero or missing value.
    packaged_values = {
        (code, int(year)): record["years"]
        for code, country in data["countries"].items()
        for year, record in country["observations"].items()
    }
    assert packaged_values == original_values
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "schooling.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")
    (OUTPUT / "joint-analysis.json").write_text(json.dumps(joint, ensure_ascii=False, separators=(",", ":")) + "\n")
    for source, target in (
        (csv_path, OUTPUT / "schooling.csv"),
        (metadata_path, OUTPUT / "schooling.metadata.json"),
    ):
        if source.resolve() != target.resolve():
            shutil.copyfile(source, target)
    assert (OUTPUT / "schooling.csv").read_bytes() == csv_path.read_bytes()
    assert (OUTPUT / "schooling.metadata.json").read_bytes() == metadata_path.read_bytes()
    print(json.dumps({
        "inputRows": len(rows),
        "countryEntities": len(countries),
        "countryObservations": len(original_values),
        "availableYears": data["availableYears"],
        "excludedAggregates": data["excludedAggregates"],
        "selectableYears": selectable_years,
        "defaultYear": joint["defaultYear"],
        "selectableYearAnalysis": {
            year: {key: analyses[str(year)][key] for key in ("count", "pearsonR", "schoolingType")}
            for year in selectable_years
        },
    }, indent=2))


if __name__ == "__main__":
    main()
