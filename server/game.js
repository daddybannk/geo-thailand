import { randomInt, randomUUID } from 'node:crypto'

const MAX_PLAYERS = 8
// 0 = ไม่จับเวลา
export const TIME_LIMITS = [0, 30, 60, 90, 120]
// เวลาดูเฉลยก่อนไปรอบถัดไปอัตโนมัติ
export const REVEAL_SECONDS = 30
// ชื่อสุ่มเมื่อผู้เล่นไม่ได้ตั้งชื่อ
export const AQUATIC_NAMES = [
  'ปลาทู', 'ปลาบึก', 'ปลากัด', 'ปลานิล', 'ปลาหมึก', 'ปลาการ์ตูน', 'ปลาโลมา', 'ปลาวาฬ', 'ปลาฉลาม', 'ปลากระเบน',
  'ปลาดาว', 'ปลาปักเป้า', 'ปลาทอง', 'ปลาช่อน', 'ปลาตะเพียน', 'ปลาสลิด', 'ปลาไหล', 'ม้าน้ำ', 'เต่าทะเล', 'แมงกะพรุน',
  'ปูม้า', 'กุ้งมังกร', 'หอยเชลล์', 'พะยูน', 'แมวน้ำ', 'นากทะเล', 'ปลาฉลามวาฬ', 'ปลากระเบนราหู', 'ปลิงทะเล', 'กุ้งก้ามกราม',
]
const ROOM_CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function polygonsFor(feature) {
  return feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates
}

function boundsFor(ring) {
  return ring.reduce(
    (bounds, [lng, lat]) => ({
      minLng: Math.min(bounds.minLng, lng),
      maxLng: Math.max(bounds.maxLng, lng),
      minLat: Math.min(bounds.minLat, lat),
      maxLat: Math.max(bounds.maxLat, lat),
    }),
    { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity },
  )
}

function pointInRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = yi > point.lat !== yj > point.lat
      && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

export function pointInProvince(point, feature) {
  return polygonsFor(feature).some(([outer, ...holes]) => (
    pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole))
  ))
}

function samplePoint(feature, random) {
  const components = polygonsFor(feature).map((polygon) => {
    const bounds = boundsFor(polygon[0])
    return { polygon, bounds, weight: Math.max(0.000001, (bounds.maxLng - bounds.minLng) * (bounds.maxLat - bounds.minLat)) }
  })
  const totalWeight = components.reduce((total, component) => total + component.weight, 0)

  for (let attempt = 0; attempt < 50000; attempt += 1) {
    let remainingWeight = random() * totalWeight
    let component = components[components.length - 1]
    for (const candidate of components) {
      remainingWeight -= candidate.weight
      if (remainingWeight <= 0) {
        component = candidate
        break
      }
    }

    const point = {
      lng: component.bounds.minLng + random() * (component.bounds.maxLng - component.bounds.minLng),
      lat: component.bounds.minLat + random() * (component.bounds.maxLat - component.bounds.minLat),
    }
    if (pointInProvince(point, feature)) return point
  }
  return null
}

export function generateLocation(provinces, scopeId = null, random = Math.random) {
  const eligible = scopeId
    ? provinces.filter((feature) => feature.properties.id === scopeId)
    : provinces
  if (!eligible.length) throw new Error('ไม่พบจังหวัดที่เลือก')

  const feature = eligible[Math.floor(random() * eligible.length)]
  const point = samplePoint(feature, random)
  if (point) {
    return {
      ...point,
      provinceId: feature.properties.id,
      provinceName: feature.properties.name_th,
      region: feature.properties.region,
    }
  }

  throw new Error(`สุ่มตำแหน่งในจังหวัด${feature.properties.name_th}ไม่สำเร็จ`)
}

// สุ่มในอำเภอหรือตำบล (feature ที่มี properties.provinceId)
export function generateAreaLocation(area, provinces, random = Math.random) {
  const province = provinces.find((feature) => feature.properties.id === area.properties.provinceId)
  const point = samplePoint(area, random)
  if (!province || !point) throw new Error(`สุ่มตำแหน่งใน${area.properties.name_th}ไม่สำเร็จ`)
  return {
    ...point,
    provinceId: province.properties.id,
    provinceName: province.properties.name_th,
    region: province.properties.region,
  }
}

export function districtLabel(district) {
  const prefix = district.properties.provinceId === 'bangkok-metropolis' ? 'เขต' : 'อำเภอ'
  return `${prefix}${district.properties.name_th}`
}

export function subdistrictLabel(subdistrict) {
  const prefix = subdistrict.properties.provinceId === 'bangkok-metropolis' ? 'แขวง' : 'ตำบล'
  return `${prefix}${subdistrict.properties.name_th}`
}

export function distanceInKm(first, second) {
  const radians = (degrees) => (degrees * Math.PI) / 180
  const latDelta = radians(second.lat - first.lat)
  const lngDelta = radians(second.lng - first.lng)
  const arc = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(first.lat)) * Math.cos(radians(second.lat)) * Math.sin(lngDelta / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc))
}

// ระยะที่ทำให้คะแนนลดเหลือ ~37% = 1/10 ของเส้นทแยงขอบเขต (ทั่วประเทศ ~190 กม., จังหวัดเล็ก ๆ ไม่กี่กิโลเมตร)
export function scoreScaleFor(features) {
  const bounds = boundsFor(features.flatMap((feature) => polygonsFor(feature).flatMap((polygon) => polygon[0])))
  const diagonal = distanceInKm({ lat: bounds.minLat, lng: bounds.minLng }, { lat: bounds.maxLat, lng: bounds.maxLng })
  return Math.max(0.5, diagonal / 10)
}

// ปักห่างไม่เกิน 25 ม. ได้เต็ม 5,000
export function scoreForDistance(distanceKm, scaleKm) {
  if (distanceKm <= 0.025) return 5000
  return Math.round(5000 * Math.exp(-distanceKm / scaleKm))
}

function findAddressPart(address, prefixes) {
  const values = Object.values(address)
  for (const prefix of prefixes) {
    const match = values.find((value) => typeof value === 'string' && value.startsWith(prefix))
    if (match) return match
  }
  return null
}

// ค้นหาตำบลและอำเภอของจุดหมายจาก OpenStreetMap Nominatim (จำกัด 1 request/วินาที ใช้แค่รอบละครั้ง)
export async function lookupAddress({ lat, lng }) {
  const parameters = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    zoom: '14',
    addressdetails: '1',
    'accept-language': 'th',
  })
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${parameters.toString()}`, {
    headers: { 'User-Agent': 'geo-thailand-game/1.0' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`Nominatim ตอบกลับ ${response.status}`)
  const address = (await response.json()).address ?? {}
  return {
    // บางพื้นที่ OSM ไม่มีขอบเขตตำบล จึงใช้ชื่อหมู่บ้านแทน
    subdistrict: findAddressPart(address, ['ตำบล', 'แขวง']) ?? address.village ?? null,
    district: findAddressPart(address, ['อำเภอ', 'เขต']),
  }
}

function pickPlayerName(name, room, random = Math.random) {
  if (name) return name
  const taken = new Set(room ? [...room.players.values()].map((player) => player.name) : [])
  const available = AQUATIC_NAMES.filter((candidate) => !taken.has(candidate))
  const pool = available.length ? available : AQUATIC_NAMES
  return pool[Math.floor(random() * pool.length)]
}

function makeRoomCode(rooms) {
  let code
  do {
    code = Array.from({ length: 6 }, () => ROOM_CODE_CHARACTERS[randomInt(ROOM_CODE_CHARACTERS.length)]).join('')
  } while (rooms.has(code))
  return code
}

function scopeNameFor(room) {
  if (!room.scopeId) return 'สุ่มทั่วประเทศไทย'
  const provinceName = room.provinces.find((feature) => feature.properties.id === room.scopeId).properties.name_th
  return [room.subdistrict && subdistrictLabel(room.subdistrict), room.district && districtLabel(room.district), provinceName]
    .filter(Boolean)
    .join(' · ')
}

function makePublicState(room) {
  const reveal = room.phase === 'reveal' || room.phase === 'finished'
  return {
    roomCode: room.code,
    hostId: room.hostId,
    solo: room.solo,
    phase: room.phase,
    currentRound: room.currentRound,
    totalRounds: room.totalRounds,
    timeLimit: room.timeLimit,
    scoreScaleKm: room.scoreScaleKm,
    revealSeconds: REVEAL_SECONDS,
    roundEndsAt: room.phase === 'playing' ? room.roundEndsAt : null,
    nextRoundAt: room.phase === 'reveal' ? room.nextRoundAt : null,
    serverNow: Date.now(),
    scopeId: room.scopeId,
    districtId: room.district?.properties.id ?? null,
    subdistrictId: room.subdistrict?.properties.id ?? null,
    scopeName: scopeNameFor(room),
    players: [...room.players.values()].map(({ id, name, score, guess, roundPoints }) => ({
      id,
      name,
      score,
      hasGuessed: Boolean(guess),
      roundPoints,
    })),
    ...(reveal ? {
      target: {
        lat: room.target.lat,
        lng: room.target.lng,
        provinceName: room.target.provinceName,
        provinceId: room.target.provinceId,
        address: room.target.address,
      },
      guesses: [...room.players.values()]
        .filter((player) => player.guess)
        .map((player) => ({
          playerId: player.id,
          name: player.name,
          lat: player.guess.lat,
          lng: player.guess.lng,
          distanceKm: player.distanceKm,
          points: player.roundPoints,
        })),
    } : { guesses: [] }),
  }
}

// msPerSecond ใช้ย่นเวลาในชุดทดสอบ
export function registerGameHandlers(io, provinces, { districts = [], subdistricts = [], junctions = {}, findAddress = lookupAddress, msPerSecond = 1000 } = {}) {
  const rooms = new Map()
  const junctionPools = new Map()

  // จุดทางแยก (ไม่ใช่ทางตัน) ในขอบเขตของห้อง จาก data/junctions.json ที่แยกไว้ตามตำบล
  function junctionPool(room) {
    const key = room.subdistrict?.properties.id ?? room.district?.properties.id ?? room.scopeId ?? '*'
    if (!junctionPools.has(key)) {
      const inScope = subdistricts.filter((feature) => (
        room.subdistrict ? feature === room.subdistrict
          : room.district ? feature.properties.districtId === room.district.properties.id
            : room.scopeId ? feature.properties.provinceId === room.scopeId
              : true
      ))
      junctionPools.set(key, inScope.flatMap((feature) => {
        const values = junctions[feature.properties.id] ?? []
        return Array.from({ length: values.length / 2 }, (_, index) => ({ lat: values[index * 2], lng: values[index * 2 + 1], provinceId: feature.properties.provinceId }))
      }))
    }
    return junctionPools.get(key)
  }

  function pickTarget(room) {
    const pool = junctionPool(room)
    if (pool.length) {
      const junction = pool[randomInt(pool.length)]
      const province = provinces.find((feature) => feature.properties.id === junction.provinceId)
      return {
        lat: junction.lat,
        lng: junction.lng,
        provinceId: province.properties.id,
        provinceName: province.properties.name_th,
        region: province.properties.region,
      }
    }
    // ไม่มีข้อมูลทางแยกในขอบเขตนี้ ใช้การสุ่มจุดในพื้นที่แบบเดิม
    const area = room.subdistrict ?? room.district
    return area ? generateAreaLocation(area, provinces) : generateLocation(provinces, room.scopeId)
  }

  function publish(room) {
    io.to(room.code).emit('room:state', makePublicState(room))
  }

  function stopTimer(room) {
    clearTimeout(room.timer)
    room.timer = null
    room.roundEndsAt = null
    room.nextRoundAt = null
  }

  function advance(room) {
    if (room.currentRound >= room.totalRounds) {
      stopTimer(room)
      room.phase = 'finished'
    } else {
      room.currentRound += 1
      startRound(room)
    }
  }

  // คิดคะแนนตอนเฉลยเท่านั้น ระหว่างรอบจะได้ไม่มีใครเห็นคะแนนของคนที่ตอบก่อน
  function reveal(room) {
    for (const player of room.players.values()) {
      if (!player.guess) continue
      player.distanceKm = distanceInKm(player.guess, room.target)
      player.roundPoints = scoreForDistance(player.distanceKm, room.scoreScaleKm)
      player.score += player.roundPoints
    }
    room.phase = 'reveal'
    stopTimer(room)
    room.nextRoundAt = Date.now() + REVEAL_SECONDS * msPerSecond
    room.timer = setTimeout(() => {
      if (room.phase !== 'reveal') return
      advance(room)
      publish(room)
    }, REVEAL_SECONDS * msPerSecond)
  }

  function startRound(room) {
    room.phase = 'playing'
    stopTimer(room)
    if (room.timeLimit) {
      room.roundEndsAt = Date.now() + room.timeLimit * msPerSecond
      room.timer = setTimeout(() => {
        if (room.phase !== 'playing') return
        reveal(room)
        publish(room)
      }, room.timeLimit * msPerSecond)
    }
    room.target = pickTarget(room)
    room.heading = randomInt(360)
    const target = room.target
    // ตำบลและอำเภอหาจากขอบเขตในเครื่องก่อน ใช้ Nominatim เฉพาะเมื่อหาไม่เจอ (เช่น จุดชิดชายฝั่งหรือแนวเขต)
    const district = room.district ?? districts.find((feature) => (
      feature.properties.provinceId === target.provinceId && pointInProvince(target, feature)
    ))
    const subdistrict = room.subdistrict ?? (district && subdistricts.find((feature) => (
      feature.properties.districtId === district.properties.id && pointInProvince(target, feature)
    )))
    if (district && subdistrict) {
      target.address = { subdistrict: subdistrictLabel(subdistrict), district: districtLabel(district) }
    } else {
      // undefined = กำลังค้นหา, null = ค้นหาไม่สำเร็จ
      target.address = undefined
      findAddress(target)
        .catch(() => null)
        .then((found) => {
          target.address = found || district
            ? { subdistrict: found?.subdistrict ?? null, district: district ? districtLabel(district) : found?.district ?? null }
            : null
          if (room.target === target && (room.phase === 'reveal' || room.phase === 'finished')) publish(room)
        })
    }
    for (const player of room.players.values()) {
      player.guess = null
      player.distanceKm = null
      player.roundPoints = 0
    }
  }

  function revealIfEveryoneGuessed(room) {
    if (room.players.size && [...room.players.values()].every((player) => player.guess)) {
      reveal(room)
    }
  }

  function removePlayer(socket) {
    const room = rooms.get(socket.data.roomCode)
    const playerId = socket.data.playerId
    if (!room || !playerId || !room.players.has(playerId)) return

    room.players.delete(playerId)
    socket.leave(room.code)
    socket.data.roomCode = null
    socket.data.playerId = null

    if (!room.players.size) {
      stopTimer(room)
      rooms.delete(room.code)
      return
    }
    if (room.hostId === playerId) room.hostId = room.players.keys().next().value
    if (room.phase === 'playing') revealIfEveryoneGuessed(room)
    publish(room)
  }

  io.on('connection', (socket) => {
    socket.on('room:create', (payload, acknowledge) => {
      if (socket.data.roomCode) return acknowledge?.({ ok: false, error: 'คุณอยู่ในห้องอื่นแล้ว' })
      const config = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
      const name = typeof config.name === 'string' ? config.name.trim().slice(0, 18) : ''
      const rounds = Number(config.rounds)
      const scopeId = typeof config.provinceId === 'string' ? config.provinceId : null
      const districtId = typeof config.districtId === 'string' ? config.districtId : null
      const district = districtId ? districts.find((feature) => feature.properties.id === districtId) : null
      const subdistrictId = typeof config.subdistrictId === 'string' ? config.subdistrictId : null
      const subdistrict = subdistrictId ? subdistricts.find((feature) => feature.properties.id === subdistrictId) : null
      const solo = config.solo === true
      const timeLimit = config.timeLimit === undefined ? 0 : Number(config.timeLimit)
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
        return acknowledge?.({ ok: false, error: 'จำนวนรอบต้องอยู่ระหว่าง 1 ถึง 10' })
      }
      if (!TIME_LIMITS.includes(timeLimit)) {
        return acknowledge?.({ ok: false, error: 'เวลาต่อรอบไม่ถูกต้อง' })
      }
      if (scopeId && !provinces.some((feature) => feature.properties.id === scopeId)) {
        return acknowledge?.({ ok: false, error: 'ไม่พบจังหวัดที่เลือก' })
      }
      if (districtId && (!district || district.properties.provinceId !== scopeId)) {
        return acknowledge?.({ ok: false, error: 'ไม่พบอำเภอที่เลือกในจังหวัดนี้' })
      }
      if (subdistrictId && (!subdistrict || !district || subdistrict.properties.districtId !== districtId)) {
        return acknowledge?.({ ok: false, error: 'ไม่พบตำบลที่เลือกในอำเภอนี้' })
      }

      const code = makeRoomCode(rooms)
      const playerId = randomUUID()
      const room = {
        code,
        hostId: playerId,
        solo,
        phase: solo ? 'playing' : 'lobby',
        currentRound: solo ? 1 : 0,
        totalRounds: rounds,
        timeLimit,
        roundEndsAt: null,
        nextRoundAt: null,
        timer: null,
        scopeId,
        district,
        subdistrict,
        scoreScaleKm: scoreScaleFor(subdistrict ? [subdistrict]
          : district ? [district]
            : scopeId ? provinces.filter((feature) => feature.properties.id === scopeId)
              : provinces),
        target: null,
        players: new Map([[playerId, {
          id: playerId,
          name: pickPlayerName(name),
          score: 0,
          guess: null,
          distanceKm: null,
          roundPoints: 0,
        }]]),
        provinces,
      }
      rooms.set(code, room)
      socket.join(code)
      socket.data.roomCode = code
      socket.data.playerId = playerId
      if (solo) startRound(room)

      acknowledge?.({ ok: true, roomCode: code, playerId, state: makePublicState(room) })
      publish(room)
    })

    socket.on('room:join', (payload, acknowledge) => {
      if (socket.data.roomCode) return acknowledge?.({ ok: false, error: 'คุณอยู่ในห้องอื่นแล้ว' })
      const config = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
      const code = typeof config.roomCode === 'string' ? config.roomCode.trim().toUpperCase() : ''
      const room = rooms.get(code)
      // เข้าระหว่างเกมได้ คนที่เข้ามาตอนเฉลยจะเริ่มเล่นรอบถัดไป
      if (!room || room.solo) {
        return acknowledge?.({ ok: false, error: 'ไม่พบห้องนี้' })
      }
      if (room.phase === 'finished') {
        return acknowledge?.({ ok: false, error: 'เกมในห้องนี้จบไปแล้ว' })
      }
      if (room.players.size >= MAX_PLAYERS) {
        return acknowledge?.({ ok: false, error: 'ห้องนี้เต็มแล้ว (สูงสุด 8 คน)' })
      }
      const playerId = randomUUID()
      const name = typeof config.name === 'string' ? config.name.trim().slice(0, 18) : ''
      room.players.set(playerId, {
        id: playerId,
        name: pickPlayerName(name, room),
        score: 0,
        guess: null,
        distanceKm: null,
        roundPoints: 0,
      })
      socket.join(code)
      socket.data.roomCode = code
      socket.data.playerId = playerId
      acknowledge?.({ ok: true, roomCode: code, playerId, state: makePublicState(room) })
      publish(room)
    })

    socket.on('player:rename', (payload, acknowledge) => {
      const room = rooms.get(socket.data.roomCode)
      const player = room?.players.get(socket.data.playerId)
      if (!room || !player) return acknowledge?.({ ok: false, error: 'ไม่พบห้องของคุณ' })
      if (room.phase !== 'lobby') return acknowledge?.({ ok: false, error: 'เปลี่ยนชื่อได้เฉพาะตอนรอเริ่มเกม' })
      const name = typeof payload === 'string' ? payload.trim().slice(0, 18) : ''
      player.name = pickPlayerName(name, room)
      acknowledge?.({ ok: true })
      publish(room)
    })

    socket.on('game:start', (acknowledge) => {
      const room = rooms.get(socket.data.roomCode)
      if (!room || room.hostId !== socket.data.playerId) {
        return acknowledge?.({ ok: false, error: 'เฉพาะเจ้าของห้องเท่านั้นที่เริ่มเกมได้' })
      }
      if (room.phase !== 'lobby' || room.solo || room.players.size < 2) {
        return acknowledge?.({ ok: false, error: 'ห้องนี้ยังไม่พร้อมเริ่มเกม' })
      }
      room.currentRound = 1
      startRound(room)
      acknowledge?.({ ok: true })
      publish(room)
    })

    socket.on('game:guess', (payload, acknowledge) => {
      const room = rooms.get(socket.data.roomCode)
      const player = room?.players.get(socket.data.playerId)
      const point = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
      const lat = Number(point.lat)
      const lng = Number(point.lng)
      if (!room || room.phase !== 'playing' || !player) {
        return acknowledge?.({ ok: false, error: 'ตอนนี้ยังส่งคำตอบไม่ได้' })
      }
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        return acknowledge?.({ ok: false, error: 'ตำแหน่งที่เลือกไม่ถูกต้อง' })
      }
      if (player.guess) return acknowledge?.({ ok: false, error: 'ส่งคำตอบรอบนี้ไปแล้ว' })

      player.guess = { lat, lng }
      revealIfEveryoneGuessed(room)
      acknowledge?.({ ok: true })
      publish(room)
    })

    socket.on('game:next', (acknowledge) => {
      const room = rooms.get(socket.data.roomCode)
      if (!room || room.hostId !== socket.data.playerId) {
        return acknowledge?.({ ok: false, error: 'เฉพาะเจ้าของห้องเท่านั้นที่ไปต่อได้' })
      }
      if (room.phase !== 'reveal') {
        return acknowledge?.({ ok: false, error: 'รอให้ทุกคนตอบก่อน' })
      }
      advance(room)
      acknowledge?.({ ok: true })
      publish(room)
    })

    socket.on('room:leave', () => removePlayer(socket))
    socket.on('disconnect', () => removePlayer(socket))
  })

  return (roomCode) => {
    const room = rooms.get(roomCode)
    if (!room || !room.target || room.phase === 'lobby') return null
    return { lat: room.target.lat, lng: room.target.lng, heading: room.heading }
  }
}
