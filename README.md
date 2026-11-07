# แผนที่ลับ — Geo Thailand

เว็บเกมทายตำแหน่งบนแผนที่ประเทศไทย เล่นคนเดียวหรือแข่งกับเพื่อนแบบเรียลไทม์

## เริ่มเล่นในเครื่อง

ภาพ Street View ใช้ Google Maps Embed API และแผนที่ปักหมุดใช้ CARTO basemaps ซึ่งต้องใช้ API key:

1. เปิดใช้ Maps Embed API ใน Google Cloud และสร้าง API key
2. สร้าง CARTO Basemaps key จาก [หน้าจัดการ key ของ CARTO](https://carto.com/basemaps/apikey/)
3. จำกัด key แต่ละตัวให้ใช้ได้เฉพาะ API และเว็บไซต์ที่ต้องการ
4. คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ key ทั้งสองรายการ

```sh
npm install
npm run dev
```

เปิดเว็บที่ `http://localhost:5173` และให้ผู้เล่นอื่นเข้าผ่าน URL เดียวกันเพื่อเล่น multiplayer ในเครือข่ายเดียวกัน

## วิธีเล่น

1. เลือกจำนวนรอบตั้งแต่ 1–10 รอบ เวลาต่อรอบ และขอบเขตเป็นทั่วประเทศไทย จังหวัด หรืออำเภอ
2. เลือกเล่นคนเดียวหรือสร้างห้อง แล้วส่งรหัส 6 ตัวให้เพื่อน
3. ผู้เล่นปักหมุดบนแผนที่พร้อมกัน คะแนนเต็มรอบละ 1,000 (ห่างไม่เกิน 10 ม.) และลดลงตามระยะห่าง โดยปรับตามขนาดขอบเขต: คะแนนเหลือครึ่งหนึ่งเมื่อห่างประมาณ 7% ของเส้นทแยงพื้นที่ (ทั่วประเทศ ~130 กม., กรุงเทพฯ ~6 กม.)

เจ้าของห้องเป็นผู้เริ่มเกมและไปยังรอบถัดไป ห้องรองรับผู้เล่นสูงสุด 8 คน

## คำสั่ง

- `npm run build` สร้างข้อมูลจังหวัดและ build เว็บสำหรับ production
- `npm start` เปิดเว็บและ Socket.IO server ที่พอร์ต 3000
- `npm test` รันชุดทดสอบ

Google Maps Embed API ไม่มีค่าใช้จ่ายต่อการฝังแผนที่ตาม [ราคาและเงื่อนไขของ Google](https://developers.google.com/maps/documentation/embed/usage-and-billing) แต่ต้องมี Google Cloud project ที่เปิด Billing และเปิด Maps Embed API ส่วน CARTO basemap key จะถูกส่งไปยัง tile service ในเบราว์เซอร์ ควรจำกัด key ด้วย referrer/domain

ขอบเขตจังหวัดดัดแปลงจาก [geoBoundaries (Thailand ADM1)](https://www.geoboundaries.org/) ภายใต้ Open Database License 1.0 (ODbL). จุดเริ่มต้นแต่ละรอบสุ่มจากทางแยกบนถนน (ไม่ใช่ทางตัน) ซึ่งสกัดจาก [OpenStreetMap](https://www.openstreetmap.org/copyright) ภายใต้ ODbL ด้วย `scripts/build-junctions.py` ขอบเขตอำเภอและตำบลดัดแปลงจาก [OpenGISData-Thailand](https://github.com/chingchai/OpenGISData-Thailand) ภายใต้ [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). แผนที่สำหรับปักหมุดใช้ OpenStreetMap และ CARTO; ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อโหลดภาพแผนที่และ Street View
