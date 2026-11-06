"""สร้าง data/junctions.json: จุดทางแยกบนถนน (ไม่ใช่ทางตัน) แยกตามตำบล สำหรับสุ่มตำแหน่งในเกม

ทางแยก = node ที่มีถนนสำหรับรถยนต์มาบรรจบตั้งแต่ 3 แนวขึ้นไป
ข้อมูลถนนจาก OpenStreetMap (ODbL) ดาวน์โหลดไฟล์ได้จาก https://download.geofabrik.de/asia/thailand.html

ใช้งาน:
  python3 -m venv .venv && .venv/bin/pip install osmium shapely
  .venv/bin/python scripts/build-junctions.py path/to/thailand-latest.osm.pbf
"""
import json
import random
import sys
from pathlib import Path

import osmium
import osmium.index
from shapely import STRtree
from shapely.geometry import Point, shape

ROAD_TYPES = {'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential'}
# เก็บไม่เกินจุดละช่องตาราง (~300 ม.) และไม่เกินจำนวนนี้ต่อตำบล เพื่อให้ไฟล์เล็กและกระจายทั่วพื้นที่
GRID_DEGREES = 0.003
MAX_PER_SUBDISTRICT = 25

root = Path(__file__).resolve().parent.parent


class RoadDegree(osmium.SimpleHandler):
    """นับจำนวนช่วงถนนที่ต่อกับแต่ละ node โดยใช้ IdSet แทน dict เพื่อประหยัดหน่วยความจำ"""

    def __init__(self):
        super().__init__()
        self.once = osmium.index.IdSet()
        self.twice = osmium.index.IdSet()
        self.junctions = osmium.index.IdSet()

    def bump(self, node_id):
        if self.twice.get(node_id):
            self.junctions.set(node_id)
        elif self.once.get(node_id):
            self.twice.set(node_id)
        else:
            self.once.set(node_id)

    def way(self, way):
        if way.tags.get('highway') not in ROAD_TYPES or way.tags.get('area') == 'yes':
            return
        refs = [node.ref for node in way.nodes]
        for index, ref in enumerate(refs):
            if index > 0:
                self.bump(ref)
            if index < len(refs) - 1:
                self.bump(ref)


class JunctionLocations(osmium.SimpleHandler):
    def __init__(self, junctions):
        super().__init__()
        self.junctions = junctions
        self.cells = {}

    def node(self, node):
        if not self.junctions.get(node.id) or not node.location.valid():
            return
        lat, lng = node.location.lat, node.location.lon
        self.cells.setdefault((int(lat // GRID_DEGREES), int(lng // GRID_DEGREES)), (lat, lng))


def main(pbf_path):
    degree = RoadDegree()
    degree.apply_file(pbf_path)
    locations = JunctionLocations(degree.junctions)
    locations.apply_file(pbf_path)
    points = list(locations.cells.values())
    print(f'พบทางแยก {len(points)} จุด (หลังกระจายตามตาราง)')

    subdistricts = []
    for file in sorted((root / 'public/data/subdistricts').glob('*.geojson')):
        subdistricts.extend(json.loads(file.read_text())['features'])
    shapes = [shape(feature['geometry']) for feature in subdistricts]
    tree = STRtree(shapes)

    grouped = {}
    for lat, lng in points:
        # ปัดพิกัดก่อนเช็ก และตัดจุดที่ชิดเส้นแบ่งเขตเกินไป (~1 ม.) เพราะ point-in-polygon แต่ละแบบตัดสินขอบต่างกัน
        lat, lng = round(lat, 5), round(lng, 5)
        point = Point(lng, lat)
        for index in tree.query(point, predicate='within'):
            if shapes[index].boundary.distance(point) < 1e-5:
                break
            grouped.setdefault(subdistricts[index]['properties']['id'], []).append((lat, lng))
            break

    rng = random.Random(20261106)
    output = {}
    for subdistrict_id in sorted(grouped):
        chosen = grouped[subdistrict_id]
        if len(chosen) > MAX_PER_SUBDISTRICT:
            chosen = rng.sample(chosen, MAX_PER_SUBDISTRICT)
        output[subdistrict_id] = [value for lat, lng in chosen for value in (lat, lng)]

    (root / 'data/junctions.json').write_text(json.dumps(output, separators=(',', ':')))
    total = sum(len(values) // 2 for values in output.values())
    print(f'เขียน {total} จุดใน {len(output)}/{len(subdistricts)} ตำบลแล้ว')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('ใช้งาน: build-junctions.py path/to/thailand-latest.osm.pbf')
    main(sys.argv[1])
