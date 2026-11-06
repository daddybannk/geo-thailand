// สร้าง public/data/districts.geojson จากขอบเขตอำเภอของ OpenGISData-Thailand (CC BY 4.0)
// ผูกแต่ละอำเภอกับ id จังหวัดใน provinces.geojson และลดความละเอียดพิกัด
import { readFileSync, writeFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync(new URL('../data/districts-raw.geojson', import.meta.url)));
const provinces = JSON.parse(readFileSync(new URL('../public/data/provinces.geojson', import.meta.url))).features;
const provinceIdByName = new Map(provinces.map((feature) => [feature.properties.name_th, feature.properties.id]));
const round = (c) => (typeof c[0] === 'number' ? [+c[0].toFixed(4), +c[1].toFixed(4)] : c.map(round));

const features = raw.features.map((f) => {
  const { amp_code, amp_th, pro_th } = f.properties;
  const provinceId = provinceIdByName.get(pro_th);
  if (!provinceId) throw new Error(`ไม่พบจังหวัดของอำเภอ${amp_th}: ${pro_th}`);
  return {
    type: 'Feature',
    properties: { id: amp_code, name_th: amp_th, provinceId },
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
  };
});

if (new Set(features.map((feature) => feature.properties.id)).size !== features.length) throw new Error('รหัสอำเภอซ้ำกัน');
features.sort((a, b) => a.properties.name_th.localeCompare(b.properties.name_th, 'th'));

writeFileSync(
  new URL('../public/data/districts.geojson', import.meta.url),
  JSON.stringify({ type: 'FeatureCollection', features }),
);
console.log(`เขียน ${features.length} อำเภอแล้ว`);
