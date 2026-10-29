#!/usr/bin/env python3
"""Compact official Natural Earth 1:50m country geometry for the globe.

Usage: python3 scripts/prepare-geography.py /path/to/ne_50m_admin_0_countries.geojson
Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson
Natural Earth data is public domain. Existing clockwise exterior rings are
preserved, as required by d3-geo for polygons smaller than a hemisphere.
"""

import json
from pathlib import Path
import sys


def first_valid_code(properties):
    # Natural Earth assigns Australia's ISO code to this separate dependency.
    # It has no observation of its own and must not inherit mainland values.
    if properties.get("ADM0_A3") == "ATC":
        return "ATC"
    for field in ("ISO_A3_EH", "ISO_A3", "ADM0_A3"):
        value = properties.get(field)
        if value and value != "-99":
            # Keep disputed territories distinct, while matching OWID's own codes.
            return {"KOS": "OWID_KOS", "SOL": "OWID_SML"}.get(value, value)
    raise ValueError("Feature has no usable country identifier")


def polygons(geometry):
    return geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]


def midpoint(polygon):
    exterior = polygon[0]
    return [
        (min(point[0] for point in exterior) + max(point[0] for point in exterior)) / 2,
        (min(point[1] for point in exterior) + max(point[1] for point in exterior)) / 2,
    ]


def territory_parts(feature):
    """Separate obvious islands/overseas units with their own ISO identifiers.

    Natural Earth's country layer groups some overseas territories with the
    mainland. Splitting disconnected polygons prevents attributing mainland
    literacy observations to those separately coded territories. Coordinates
    and rings are copied verbatim; no boundary geometry is synthesized.
    """
    properties = feature["properties"]
    adm0 = properties["ADM0_A3"]
    groups = {}
    metadata = {
        "CCK": ("Cocos Islands", "Asia"),
        "CXR": ("Christmas Island", "Asia"),
        "GUF": ("French Guiana", "South America"),
        "GLP": ("Guadeloupe", "North America"),
        "MTQ": ("Martinique", "North America"),
        "REU": ("Reunion", "Africa"),
        "MYT": ("Mayotte", "Africa"),
        "BES": ("Bonaire, Sint Eustatius and Saba", "North America"),
        "SJM": ("Svalbard and Jan Mayen", "Europe"),
    }
    for polygon in polygons(feature["geometry"]):
        lon, lat = midpoint(polygon)
        code = first_valid_code(properties)
        if adm0 == "IOA":
            code = "CCK" if lon < 100 else "CXR"
        elif adm0 == "FRA":
            if -55 < lon < -50 and 0 < lat < 6:
                code = "GUF"
            elif -62 < lon < -60 and 15.8 < lat < 17:
                code = "GLP"
            elif -62 < lon < -60 and 14 < lat < 15.5:
                code = "MTQ"
            elif 55 < lon < 56 and -22 < lat < -20:
                code = "REU"
            elif 45 < lon < 46 and -14 < lat < -12:
                code = "MYT"
        elif adm0 == "NLD" and lon < 0:
            code = "BES"
        elif adm0 == "NOR" and (lat > 73 or lon < 0):
            code = "SJM"
        groups.setdefault(code, []).append(polygon)
    results = []
    for code, parts in groups.items():
        is_territory = code in metadata
        name, continent = metadata.get(code, (
            properties.get("NAME_EN") or properties["NAME"],
            properties["CONTINENT"],
        ))
        # Any point within the component's bounding box suffices for camera
        # targeting; use the largest component for fragmented territories.
        center = midpoint(max(parts, key=lambda part: len(part[0]))) if is_territory else [properties["LABEL_X"], properties["LABEL_Y"]]
        results.append({
            "type": "Feature",
            "properties": {"name": name, "code": code, "continent": continent, "centroid": center},
            "geometry": {"type": "MultiPolygon", "coordinates": parts} if len(parts) > 1 else {"type": "Polygon", "coordinates": parts[0]},
        })
    return results


def main():
    source_path = Path(sys.argv[1])
    output_path = Path(__file__).resolve().parents[1] / "data/countries.geojson"
    source = json.loads(source_path.read_text())
    features = []
    for feature in source["features"]:
        features.extend(territory_parts(feature))
    output = {"type": "FeatureCollection", "features": features}
    output_path.write_text(json.dumps(output, separators=(",", ":")) + "\n")
    print(f"Saved {len(features)} countries/territories to {output_path}")


if __name__ == "__main__":
    main()
