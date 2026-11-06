import { randomInt, randomUUID } from 'node:crypto'

const MAX_PLAYERS = 8
const ROOM_CODE_CHARACTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const REGION_LABELS = {
  north: 'ภาคเหนือ',
  northeast: 'ภาคอีสาน',
  central: 'ภาคกลาง',
  east: 'ภาคตะวันออก',
  west: 'ภาคตะวันตก',
  south: 'ภาคใต้',
}

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

export function generateLocation(provinces, scopeId = null, random = Math.random) {
  const eligible = scopeId
    ? provinces.filter((feature) => feature.properties.id === scopeId)
    : provinces
  if (!eligible.length) throw new Error('ไม่พบจังหวัดที่เลือก')

  const feature = eligible[Math.floor(random() * eligible.length)]
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
    if (pointInProvince(point, feature)) {
      return {
        ...point,
        provinceId: feature.properties.id,
        provinceName: feature.properties.name_th,
        region: feature.properties.region,
      }
    }
  }

  throw new Error(`สุ่มตำแหน่งในจังหวัด${feature.properties.name_th}ไม่สำเร็จ`)
}

export function distanceInKm(first, second) {
  const radians = (degrees) => (degrees * Math.PI) / 180
  const latDelta = radians(second.lat - first.lat)
  const lngDelta = radians(second.lng - first.lng)
  const arc = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(first.lat)) * Math.cos(radians(second.lat)) * Math.sin(lngDelta / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc))
}

function compassDirection(origin, destination) {
  const northSouth = destination.lat - origin.lat
  const eastWest = destination.lng - origin.lng
  if (Math.abs(northSouth) > Math.abs(eastWest) * 1.4) return northSouth > 0 ? 'เหนือ' : 'ใต้'
  if (Math.abs(eastWest) > Math.abs(northSouth) * 1.4) return eastWest > 0 ? 'ตะวันออก' : 'ตะวันตก'
  if (northSouth >= 0) return eastWest >= 0 ? 'ตะวันออกเฉียงเหนือ' : 'ตะวันตกเฉียงเหนือ'
  return eastWest >= 0 ? 'ตะวันออกเฉียงใต้' : 'ตะวันตกเฉียงใต้'
}

function makeHint(target, feature, scopeId) {
  const bounds = boundsFor(polygonsFor(feature).flatMap((polygon) => polygon[0]))
  const center = { lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 }
  const distance = distanceInKm(center, target)
  const distanceBand = distance < 25 ? 'ไม่เกิน 25 กม.' : distance < 75 ? '25–75 กม.' : 'มากกว่า 75 กม.'
  const direction = compassDirection(center, target)
  const region = REGION_LABELS[feature.properties.region] ?? 'ประเทศไทย'
  return scopeId
    ? `จุดหมายอยู่ทาง${direction}จากใจกลางจังหวัด · ห่างประมาณ${distanceBand}`
    : `อยู่ใน${region} · จุดหมายอยู่ทาง${direction}จากใจกลางจังหวัด`
}

function makeRoomCode(rooms) {
  let code
  do {
    code = Array.from({ length: 6 }, () => ROOM_CODE_CHARACTERS[randomInt(ROOM_CODE_CHARACTERS.length)]).join('')
  } while (rooms.has(code))
  return code
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
    scopeId: room.scopeId,
    scopeName: room.scopeId
      ? room.provinces.find((feature) => feature.properties.id === room.scopeId).properties.name_th
      : 'สุ่มทั่วประเทศไทย',
    hint: room.hint,
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

export function registerGameHandlers(io, provinces) {
  const rooms = new Map()

  function publish(room) {
    io.to(room.code).emit('room:state', makePublicState(room))
  }

  function startRound(room) {
    room.phase = 'playing'
    room.target = generateLocation(provinces, room.scopeId)
    room.heading = randomInt(360)
    room.hint = makeHint(room.target, provinces.find((feature) => feature.properties.id === room.target.provinceId), room.scopeId)
    for (const player of room.players.values()) {
      player.guess = null
      player.distanceKm = null
      player.roundPoints = 0
    }
  }

  function revealIfEveryoneGuessed(room) {
    if (room.players.size && [...room.players.values()].every((player) => player.guess)) {
      room.phase = 'reveal'
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
      const solo = config.solo === true
      if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) {
        return acknowledge?.({ ok: false, error: 'จำนวนรอบต้องอยู่ระหว่าง 1 ถึง 10' })
      }
      if (scopeId && !provinces.some((feature) => feature.properties.id === scopeId)) {
        return acknowledge?.({ ok: false, error: 'ไม่พบจังหวัดที่เลือก' })
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
        scopeId,
        hint: '',
        target: null,
        players: new Map([[playerId, {
          id: playerId,
          name: name || 'นักสำรวจ',
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
      if (!room || room.phase !== 'lobby') {
        return acknowledge?.({ ok: false, error: 'ไม่พบห้องนี้ หรือเกมเริ่มไปแล้ว' })
      }
      if (room.players.size >= MAX_PLAYERS) {
        return acknowledge?.({ ok: false, error: 'ห้องนี้เต็มแล้ว (สูงสุด 8 คน)' })
      }
      const playerId = randomUUID()
      const name = typeof config.name === 'string' ? config.name.trim().slice(0, 18) : ''
      room.players.set(playerId, {
        id: playerId,
        name: name || 'นักสำรวจ',
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
      player.distanceKm = distanceInKm(player.guess, room.target)
      player.roundPoints = Math.round(5000 * Math.exp(-player.distanceKm / 200))
      player.score += player.roundPoints
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
      if (room.currentRound >= room.totalRounds) {
        room.phase = 'finished'
      } else {
        room.currentRound += 1
        startRound(room)
      }
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
