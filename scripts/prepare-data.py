#!/usr/bin/env python3
"""Package the supplied literacy CSV without filling or interpolating years."""

import csv
import json
import shutil
from collections import Counter
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
INPUT = PROJECT.parent / "literate-and-illiterate-world-population"
OUTPUT = PROJECT / "data"


def main():
    csv_path = INPUT / "literate-and-illiterate-world-population.csv"
    metadata_path = INPUT / "literate-and-illiterate-world-population.metadata.json"
    if not csv_path.is_file() or not metadata_path.is_file():
        # A standalone clone includes the original inputs alongside browser data.
        csv_path = OUTPUT / "literacy.csv"
        metadata_path = OUTPUT / "literacy.metadata.json"
    metadata = json.loads(
        metadata_path.read_text()
    )
    with csv_path.open(newline="") as stream:
        rows = list(csv.DictReader(stream))

    countries = {}
    excluded = set()
    coverage = Counter()
    for row in rows:
        code = row["Code"]
        if not code or code == "OWID_WRL":
            excluded.add(row["Entity"])
            continue
        year = int(row["Year"])
        # Preserve both measures exactly as numeric values in the supplied CSV.
        # A missing observation remains missing; no adjacent-year substitution.
        observation = {
            "literate": float(row["Literate"]) if row["Literate"] else None,
            "illiterate": float(row["Illiterate"]) if row["Illiterate"] else None,
        }
        country = countries.setdefault(
            code, {"name": row["Entity"], "observations": {}}
        )
        assert str(year) not in country["observations"], (code, year)
        country["observations"][str(year)] = observation
        if observation["literate"] is not None:
            coverage[year] += 1

    column = metadata["columns"]["Literacy rate"]
    chart = metadata["chart"]
    data = {
        "availableYears": sorted(coverage),
        "defaultYear": 2020,
        "countries": dict(sorted(countries.items())),
        "yearCoverage": dict(sorted(coverage.items())),
        "source": {
            "title": chart["title"],
            "subtitle": chart["subtitle"],
            "citation": column["citationShort"],
            "fullCitation": column["citationLong"],
            "url": chart["originalChartUrl"],
            "note": chart["note"],
            "downloaded": metadata["dateDownloaded"],
            "lastUpdated": column["lastUpdated"],
            "definition": column["descriptionShort"],
            "unit": "%",
        },
        "excludedAggregates": sorted(excluded),
    }

    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "literacy.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n"
    )
    for source, target in (
        (csv_path, OUTPUT / "literacy.csv"),
        (metadata_path, OUTPUT / "literacy.metadata.json"),
    ):
        if source.resolve() != target.resolve():
            shutil.copyfile(source, target)
    print(
        json.dumps(
            {
                "inputRows": len(rows),
                "countryEntities": len(countries),
                "countryObservations": sum(
                    len(country["observations"]) for country in countries.values()
                ),
                "years": len(coverage),
                "defaultYear": data["defaultYear"],
                "defaultYearCoverage": coverage[data["defaultYear"]],
                "chinaYears": sorted(countries["CHN"]["observations"]),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
