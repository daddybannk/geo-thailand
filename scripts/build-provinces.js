// สร้าง public/data/provinces.geojson จากไฟล์ดิบ: เติม id, ชื่อไทย, ภาค และลดความละเอียดพิกัด
import { readFileSync, writeFileSync } from 'node:fs';

const META = {
  'Mae Hong Son': ['แม่ฮ่องสอน', 'north'],
  'Chiang Mai': ['เชียงใหม่', 'north'],
  'Chiang Rai': ['เชียงราย', 'north'],
  'Lampang': ['ลำปาง', 'north'],
  'Lamphun': ['ลำพูน', 'north'],
  'Nan': ['น่าน', 'north'],
  'Phayao': ['พะเยา', 'north'],
  'Phrae': ['แพร่', 'north'],
  'Uttaradit': ['อุตรดิตถ์', 'north'],

  'Amnat Charoen': ['อำนาจเจริญ', 'northeast'],
  'Bueng Kan': ['บึงกาฬ', 'northeast'],
  'Buri Ram': ['บุรีรัมย์', 'northeast'],
  'Chaiyaphum': ['ชัยภูมิ', 'northeast'],
  'Kalasin': ['กาฬสินธุ์', 'northeast'],
  'Khon Kaen': ['ขอนแก่น', 'northeast'],
  'Loei': ['เลย', 'northeast'],
  'Maha Sarakham': ['มหาสารคาม', 'northeast'],
  'Mukdahan': ['มุกดาหาร', 'northeast'],
  'Nakhon Phanom': ['นครพนม', 'northeast'],
  'Nakhon Ratchasima': ['นครราชสีมา', 'northeast'],
  'Nong Bua Lam Phu': ['หนองบัวลำภู', 'northeast'],
  'Nong Khai': ['หนองคาย', 'northeast'],
  'Roi Et': ['ร้อยเอ็ด', 'northeast'],
  'Sakon Nakhon': ['สกลนคร', 'northeast'],
  'Si Sa Ket': ['ศรีสะเกษ', 'northeast'],
  'Surin': ['สุรินทร์', 'northeast'],
  'Ubon Ratchathani': ['อุบลราชธานี', 'northeast'],
  'Udon Thani': ['อุดรธานี', 'northeast'],
  'Yasothon': ['ยโสธร', 'northeast'],

  'Bangkok Metropolis': ['กรุงเทพมหานคร', 'central'],
  'Ang Thong': ['อ่างทอง', 'central'],
  'Chai Nat': ['ชัยนาท', 'central'],
  'Kamphaeng Phet': ['กำแพงเพชร', 'central'],
  'Lop Buri': ['ลพบุรี', 'central'],
  'Nakhon Nayok': ['นครนายก', 'central'],
  'Nakhon Pathom': ['นครปฐม', 'central'],
  'Nakhon Sawan': ['นครสวรรค์', 'central'],
  'Nonthaburi': ['นนทบุรี', 'central'],
  'Pathum Thani': ['ปทุมธานี', 'central'],
  'Phetchabun': ['เพชรบูรณ์', 'central'],
  'Phichit': ['พิจิตร', 'central'],
  'Phitsanulok': ['พิษณุโลก', 'central'],
  'Phra Nakhon Si Ayutthaya': ['พระนครศรีอยุธยา', 'central'],
  'Samut Prakan': ['สมุทรปราการ', 'central'],
  'Samut Sakhon': ['สมุทรสาคร', 'central'],
  'Samut Songkhram': ['สมุทรสงคราม', 'central'],
  'Saraburi': ['สระบุรี', 'central'],
  'Sing Buri': ['สิงห์บุรี', 'central'],
  'Sukhothai': ['สุโขทัย', 'central'],
  'Suphan Buri': ['สุพรรณบุรี', 'central'],
  'Uthai Thani': ['อุทัยธานี', 'central'],

  'Chachoengsao': ['ฉะเชิงเทรา', 'east'],
  'Chanthaburi': ['จันทบุรี', 'east'],
  'Chon Buri': ['ชลบุรี', 'east'],
  'Prachin Buri': ['ปราจีนบุรี', 'east'],
  'Rayong': ['ระยอง', 'east'],
  'Sa Kaeo': ['สระแก้ว', 'east'],
  'Trat': ['ตราด', 'east'],

  'Kanchanaburi': ['กาญจนบุรี', 'west'],
  'Phetchaburi': ['เพชรบุรี', 'west'],
  'Prachuap Khiri Khan': ['ประจวบคีรีขันธ์', 'west'],
  'Ratchaburi': ['ราชบุรี', 'west'],
  'Tak': ['ตาก', 'west'],

  'Chumphon': ['ชุมพร', 'south'],
  'Krabi': ['กระบี่', 'south'],
  'Nakhon Si Thammarat': ['นครศรีธรรมราช', 'south'],
  'Narathiwat': ['นราธิวาส', 'south'],
  'Pattani': ['ปัตตานี', 'south'],
  'Phangnga': ['พังงา', 'south'],
  'Phatthalung': ['พัทลุง', 'south'],
  'Phuket': ['ภูเก็ต', 'south'],
  'Ranong': ['ระนอง', 'south'],
  'Satun': ['สตูล', 'south'],
  'Songkhla': ['สงขลา', 'south'],
  'Surat Thani': ['สุราษฎร์ธานี', 'south'],
  'Trang': ['ตรัง', 'south'],
  'Yala': ['ยะลา', 'south'],
};

const raw = JSON.parse(readFileSync(new URL('../data/thailand-raw.json', import.meta.url)));
const round = (c) => (typeof c[0] === 'number' ? [+c[0].toFixed(4), +c[1].toFixed(4)] : c.map(round));

const features = raw.features.map((f) => {
  const name = f.properties.name;
  const meta = META[name];
  if (!meta) throw new Error(`ไม่พบข้อมูลจังหวัด: ${name}`);
  const id = name.toLowerCase().replace(/[^a-z]+/g, '-');
  return {
    type: 'Feature',
    properties: { id, name_en: name.replace(' Metropolis', ''), name_th: meta[0], region: meta[1] },
    geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) },
  };
});

if (features.length !== Object.keys(META).length) throw new Error('จำนวนจังหวัดไม่ตรงกัน');
features.sort((a, b) => a.properties.name_th.localeCompare(b.properties.name_th, 'th'));

writeFileSync(
  new URL('../public/data/provinces.geojson', import.meta.url),
  JSON.stringify({ type: 'FeatureCollection', features }),
);
console.log(`เขียน ${features.length} จังหวัดแล้ว`);
