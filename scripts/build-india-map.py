"""
Build-time India map: downloads district boundaries (udit-001/india-maps-data, 2011 census districts with
current state/UT names incl. Ladakh and Telangana), dissolves them into states and delivery zones, simplifies,
projects to SVG coordinates and writes data/india-map.json. The browser only ever loads the small JSON, so the
demo never depends on network access.

    python3 -m venv .venv-geo && .venv-geo/bin/pip install shapely
    .venv-geo/bin/python scripts/build-india-map.py
"""
import json
import math
import os
import sys
import urllib.request

from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

SRC = "https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@main/geojson/india.geojson"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CACHE = os.path.join(ROOT, "data", "train", "india-districts.geojson")
OUT = os.path.join(ROOT, "data", "india-map.json")
WIDTH = 600.0
LAT0 = math.radians(22.0)

REGION = {
    "Jammu and Kashmir": "north", "Ladakh": "north", "Himachal Pradesh": "north", "Punjab": "north", "Chandigarh": "north",
    "Uttarakhand": "north", "Haryana": "north", "Delhi": "north", "Rajasthan": "north", "Uttar Pradesh": "north",
    "Gujarat": "west", "Maharashtra": "west", "Goa": "west", "Madhya Pradesh": "west", "Chhattisgarh": "west",
    "Dadra and Nagar Haveli and Daman and Diu": "west",
    "Karnataka": "south", "Kerala": "south", "Tamil Nadu": "south", "Puducherry": "south", "Telangana": "south",
    "Andhra Pradesh": "south", "Lakshadweep": "south", "Andaman and Nicobar Islands": "south",
    "Bihar": "east", "Jharkhand": "east", "West Bengal": "east", "Odisha": "east",
    "Assam": "northeast", "Meghalaya": "northeast", "Arunachal Pradesh": "northeast", "Nagaland": "northeast",
    "Manipur": "northeast", "Mizoram": "northeast", "Tripura": "northeast", "Sikkim": "northeast",
}
ABBR = {
    "Jammu and Kashmir": "JK", "Ladakh": "LA", "Himachal Pradesh": "HP", "Punjab": "PB", "Chandigarh": "CH", "Uttarakhand": "UK",
    "Haryana": "HR", "Delhi": "DL", "Rajasthan": "RJ", "Uttar Pradesh": "UP", "Gujarat": "GJ", "Maharashtra": "MH", "Goa": "GA",
    "Madhya Pradesh": "MP", "Chhattisgarh": "CG", "Dadra and Nagar Haveli and Daman and Diu": "DD", "Karnataka": "KA", "Kerala": "KL",
    "Tamil Nadu": "TN", "Puducherry": "PY", "Telangana": "TG", "Andhra Pradesh": "AP", "Lakshadweep": "LD",
    "Andaman and Nicobar Islands": "AN", "Bihar": "BR", "Jharkhand": "JH", "West Bengal": "WB", "Odisha": "OD", "Assam": "AS",
    "Meghalaya": "ML", "Arunachal Pradesh": "AR", "Nagaland": "NL", "Manipur": "MN", "Mizoram": "MZ", "Tripura": "TR", "Sikkim": "SK",
}

# Approximate city coordinates (lat, lon) for every city in lib/config/network.ts PINCODES
CITY = {
    "Mumbai": (18.94, 72.83), "Mumbai (Andheri)": (19.12, 72.85), "Thane": (19.22, 72.98), "Pune": (18.52, 73.86), "Pune (Baner)": (18.56, 73.79),
    "Nagpur": (21.15, 79.09), "Nashik": (20.00, 73.79), "Aurangabad": (19.88, 75.34), "Kolhapur": (16.70, 74.24), "Solapur": (17.66, 75.91),
    "Akola": (20.70, 77.00), "Ahmedabad": (23.03, 72.58), "Surat": (21.17, 72.83), "Vadodara": (22.31, 73.18), "Rajkot": (22.30, 70.80),
    "Bhavnagar": (21.76, 72.15), "Jamnagar": (22.47, 70.06), "Panaji": (15.49, 73.83), "Indore": (22.72, 75.86), "Bhopal": (23.26, 77.41),
    "Gwalior": (26.22, 78.18), "Jabalpur": (23.18, 79.95), "Ujjain": (23.18, 75.78), "Raipur": (21.25, 81.63), "Bilaspur": (22.08, 82.14),
    "New Delhi": (28.61, 77.21), "Delhi (Rohini)": (28.74, 77.07), "Gurugram": (28.46, 77.03), "Noida": (28.54, 77.39), "Ghaziabad": (28.67, 77.45),
    "Faridabad": (28.41, 77.32), "Lucknow": (26.85, 80.95), "Kanpur": (26.45, 80.33), "Varanasi": (25.32, 82.97), "Agra": (27.18, 78.01),
    "Meerut": (28.98, 77.71), "Prayagraj": (25.44, 81.85), "Gorakhpur": (26.76, 83.37), "Bareilly": (28.37, 79.43), "Jaipur": (26.91, 75.79),
    "Jodhpur": (26.24, 73.02), "Udaipur": (24.59, 73.71), "Kota": (25.21, 75.86), "Bikaner": (28.02, 73.31), "Chandigarh": (30.73, 76.78),
    "Ludhiana": (30.90, 75.86), "Amritsar": (31.63, 74.87), "Jalandhar": (31.33, 75.58), "Bathinda": (30.21, 74.95), "Karnal": (29.69, 76.99),
    "Hisar": (29.15, 75.72), "Dehradun": (30.32, 78.03), "Haldwani": (29.22, 79.51), "Shimla": (31.10, 77.17), "Jammu": (32.73, 74.86),
    "Srinagar": (34.08, 74.80), "Bengaluru": (12.97, 77.59), "Bengaluru (Whitefield)": (12.97, 77.75), "Bengaluru (HSR)": (12.91, 77.64),
    "Mysuru": (12.30, 76.64), "Mangaluru": (12.91, 74.86), "Hubballi": (15.36, 75.12), "Belagavi": (15.85, 74.50), "Kalaburagi": (17.33, 76.83),
    "Chennai": (13.08, 80.27), "Chennai (Perungudi)": (12.96, 80.24), "Coimbatore": (11.02, 76.96), "Madurai": (9.93, 78.12),
    "Tiruchirappalli": (10.79, 78.70), "Salem": (11.66, 78.15), "Tirunelveli": (8.71, 77.76), "Hyderabad": (17.39, 78.49),
    "Hyderabad (Madhapur)": (17.45, 78.39), "Warangal": (17.97, 79.59), "Visakhapatnam": (17.69, 83.22), "Vijayawada": (16.51, 80.65),
    "Guntur": (16.31, 80.44), "Tirupati": (13.63, 79.42), "Kurnool": (15.83, 78.04), "Kochi": (9.93, 76.27), "Thiruvananthapuram": (8.52, 76.94),
    "Kozhikode": (11.26, 75.78), "Thrissur": (10.53, 76.21), "Puducherry": (11.94, 79.81), "Kolkata": (22.57, 88.36),
    "Kolkata (Salt Lake)": (22.59, 88.42), "Howrah": (22.59, 88.26), "Siliguri": (26.73, 88.40), "Bardhaman": (23.23, 87.86),
    "Midnapore": (22.42, 87.32), "Bhubaneswar": (20.30, 85.82), "Cuttack": (20.46, 85.88), "Rourkela": (22.26, 84.85), "Berhampur": (19.31, 84.79),
    "Patna": (25.59, 85.14), "Gaya": (24.79, 85.00), "Muzaffarpur": (26.12, 85.39), "Bhagalpur": (25.24, 86.97), "Ranchi": (23.34, 85.31),
    "Jamshedpur": (22.80, 86.20), "Dhanbad": (23.80, 86.43), "Guwahati": (26.14, 91.74), "Dibrugarh": (27.47, 94.91), "Silchar": (24.83, 92.78),
    "Shillong": (25.58, 91.89), "Imphal": (24.82, 93.94), "Agartala": (23.83, 91.29), "Kohima": (25.67, 94.11), "Aizawl": (23.73, 92.72),
    "Gangtok": (27.33, 88.61), "Itanagar": (27.08, 93.61),
}
WAREHOUSES = {"WH-BHW": (19.30, 73.06), "WH-GGN": (28.46, 77.03), "WH-BLR": (12.97, 77.59), "WH-KOL": (22.72, 88.13), "WH-GAU": (26.12, 91.64)}


def load():
    if not os.path.exists(CACHE):
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        print("downloading", SRC)
        urllib.request.urlretrieve(SRC, CACHE)
    return json.load(open(CACHE))


def main():
    src = load()
    by_state = {}
    for f in src["features"]:
        name = f["properties"].get("st_nm")
        if name not in REGION:
            print("skip", name, file=sys.stderr)
            continue
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        by_state.setdefault(name, []).append(g)

    states = {n: unary_union(gs).buffer(0.002).buffer(-0.002) for n, gs in by_state.items()}
    minx = min(s.bounds[0] for s in states.values())
    miny = min(s.bounds[1] for s in states.values())
    maxx = max(s.bounds[2] for s in states.values())
    maxy = max(s.bounds[3] for s in states.values())
    kx = WIDTH / ((maxx - minx) * math.cos(LAT0))
    height = (maxy - miny) * kx

    def proj(lon, lat):
        return ((lon - minx) * math.cos(LAT0) * kx, (maxy - lat) * kx)

    def path(geom, tol, min_area):
        geom = geom.simplify(tol, preserve_topology=True)
        polys = [geom] if isinstance(geom, Polygon) else list(getattr(geom, "geoms", []))
        parts = []
        for p in polys:
            if p.area < min_area:
                continue
            for ring in [p.exterior, *p.interiors]:
                pts = [proj(x, y) for x, y in ring.coords]
                parts.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z")
        return "".join(parts)

    out_states = []
    for name, g in sorted(states.items()):
        island = name in ("Andaman and Nicobar Islands", "Lakshadweep")
        c = g.representative_point()
        cx, cy = proj(c.x, c.y)
        out_states.append({
            "name": name,
            "abbr": ABBR[name],
            "region": REGION[name],
            "d": path(g, 0.03 if not island else 0.01, 0.0005 if not island else 0.00001),
            "c": [round(cx, 1), round(cy, 1)],
            "area": round(g.area, 3),
        })

    zones = []
    for region in ["north", "west", "south", "east", "northeast"]:
        geoms = [g for n, g in states.items() if REGION[n] == region and n not in ("Andaman and Nicobar Islands", "Lakshadweep")]
        z = unary_union([g.buffer(0.01) for g in geoms]).buffer(-0.01)
        zones.append({"region": region, "d": path(z, 0.04, 0.05)})

    outline = unary_union([g.buffer(0.01) for g in states.values()]).buffer(-0.01)
    cities = {name: [round(v, 1) for v in proj(lon, lat)] for name, (lat, lon) in CITY.items()}
    whs = {k: [round(v, 1) for v in proj(lon, lat)] for k, (lat, lon) in WAREHOUSES.items()}
    data = {
        "source": "udit-001/india-maps-data (district boundaries dissolved to states); equirectangular projection, cos(22°) aspect",
        "viewBox": [0, 0, round(WIDTH, 1), round(height, 1)],
        "states": out_states,
        "zones": zones,
        "outline": path(outline, 0.03, 0.02),
        "cities": cities,
        "warehouses": whs,
    }
    json.dump(data, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB), {len(out_states)} states, viewBox {data['viewBox']}")


if __name__ == "__main__":
    main()
