// สร้าง public/data/subdistricts/<provinceId>.geojson จากขอบเขตตำบลของ OpenGISData-Thailand (CC BY 4.0)
// แยกไฟล์ตามจังหวัด เพื่อให้หน้าเว็บโหลดเฉพาะจังหวัดที่เลือก
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync(new URL('../data/subdistricts-raw.geojson', import.meta.url)));
const districts = JSON.parse(readFileSync(new URL('../public/data/districts.geojson', import.meta.url))).features;
const provinceIdByDistrict = new Map(districts.map((feature) => [feature.properties.id, feature.properties.provinceId]));
const round = (c) => (typeof c[0] === 'number' ? [+c[0].toFixed(4), +c[1].toFixed(4)] : c.map(round));

const usedIds = new Set();
const byProvince = new Map();
for (const f of raw.features) {
  const { tam_code, tam_th, amp_code } = f.properties;
  const provinceId = provinceIdByDistrict.get(amp_code);
  if (!provinceId) throw new Error(`ไม่พบอำเภอของตำบล${tam_th}: ${amp_code}`);
  // ข้อมูลต้นทางมีรหัสตำบลซ้ำข้ามอำเภอ จึงเติมรหัสอำเภอให้ไม่ชนกัน
  const id = usedIds.has(tam_code) ? `${tam_code}-${amp_code}` : tam_code;
  usedIds.add(id);
  const feature = {
    type: 'Feature',
    properties: { id, name_th: tam_th, districtId: amp_code, provinceId },
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
  };
  byProvince.set(provinceId, [...(byProvince.get(provinceId) ?? []), feature]);
}

const outDir = new URL('../public/data/subdistricts/', import.meta.url);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const [provinceId, features] of byProvince) {
  features.sort((a, b) => a.properties.name_th.localeCompare(b.properties.name_th, 'th'));
  writeFileSync(new URL(`${provinceId}.geojson`, outDir), JSON.stringify({ type: 'FeatureCollection', features }));
}
console.log(`เขียน ${usedIds.size} ตำบลใน ${byProvince.size} จังหวัดแล้ว`);
