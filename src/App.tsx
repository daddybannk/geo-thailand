import { useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Compass,
  Expand,
  Flag,
  LoaderCircle,
  Map,
  MapPin,
  Medal,
  MousePointer2,
  Radio,
  RotateCcw,
  RotateCw,
  Send,
  Sparkles,
  Timer,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  GeoJSON as LeafletGeoJSON,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import 'leaflet/dist/leaflet.css'

type ProvinceProperties = { id: string; name_en: string; name_th: string; region: string }
type ProvinceCollection = FeatureCollection<Geometry, ProvinceProperties>
type DistrictProperties = { id: string; name_th: string; provinceId: string }
type DistrictCollection = FeatureCollection<Geometry, DistrictProperties>
type Point = { lat: number; lng: number }
type Player = { id: string; name: string; score: number; hasGuessed: boolean; roundPoints: number }
type GuessResult = Point & { playerId: string; name: string; distanceKm: number; points: number }
type TargetAddress = { subdistrict: string | null; district: string | null }
type Target = Point & { provinceName: string; provinceId: string; address?: TargetAddress | null }
type RoomState = {
  roomCode: string
  hostId: string
  solo: boolean
  phase: 'lobby' | 'playing' | 'reveal' | 'finished'
  currentRound: number
  totalRounds: number
  timeLimit: number
  roundEndsAt: number | null
  serverNow: number
  scopeId: string | null
  districtId: string | null
  scopeName: string
  players: Player[]
  target?: Target
  guesses: GuessResult[]
}
type Ack<T = Record<string, never>> = { ok: boolean; error?: string } & T
type CreateRoomResult = { roomCode: string; playerId: string; state: RoomState }
type ServerEvents = { 'room:state': (state: RoomState) => void }
type ClientEvents = {
  'room:create': (config: { name: string; rounds: number; timeLimit: number; provinceId: string | null; districtId: string | null; solo: boolean }, ack: (response: Ack<CreateRoomResult>) => void) => void
  'room:join': (config: { name: string; roomCode: string }, ack: (response: Ack<CreateRoomResult>) => void) => void
  'game:start': (ack: (response: Ack) => void) => void
  'game:guess': (point: Point, ack: (response: Ack) => void) => void
  'game:next': (ack: (response: Ack) => void) => void
  'room:leave': () => void
}

// ว่างไว้เมื่อ frontend และ backend อยู่ origin เดียวกัน; ตั้งเป็น URL ของ backend เมื่อแยก deploy (เช่น frontend บน Vercel)
const serverUrl = (import.meta.env.VITE_SERVER_URL ?? '').replace(/\/$/, '')
const socket: Socket<ServerEvents, ClientEvents> = serverUrl ? io(serverUrl, { autoConnect: true }) : io({ autoConnect: true })
const TIME_LIMIT_OPTIONS = [30, 60, 90, 120, 0]
const districtLabel = (district: DistrictProperties) => `${district.provinceId === 'bangkok-metropolis' ? 'เขต' : 'อำเภอ'}${district.name_th}`
const formatTimeLimit = (seconds: number) => seconds ? `${seconds} วินาที` : 'ไม่จับเวลา'

function formatTargetLocation(target: Target) {
  const province = target.provinceName === 'กรุงเทพมหานคร' ? target.provinceName : `จังหวัด${target.provinceName}`
  if (target.address === undefined) return `${province} (กำลังค้นหาตำบลและอำเภอ...)`
  return [target.address?.subdistrict, target.address?.district, province].filter(Boolean).join(' · ')
}

const guessIcon = L.divIcon({
  className: 'marker-wrapper',
  html: '<span class="game-marker guess-marker"><i></i></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
})
const targetIcon = L.divIcon({
  className: 'marker-wrapper',
  html: '<span class="game-marker target-marker">★</span>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
})

function emitWithAck<T>(send: (ack: (response: Ack<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    send((response) => response?.ok ? resolve(response) : reject(new Error(response?.error ?? 'ทำรายการไม่สำเร็จ')))
  })
}

function MapClickHandler({ disabled, onSelect }: { disabled: boolean; onSelect: (point: Point) => void }) {
  useMapEvents({
    click(event) {
      if (!disabled) onSelect({ lat: event.latlng.lat, lng: event.latlng.lng })
    },
  })
  return null
}

function FitMapToScope({ feature, resetKey }: { feature?: Feature; resetKey: string }) {
  const map = useMap()
  useEffect(() => {
    if (feature) {
      const bounds = L.geoJSON(feature).getBounds()
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [70, 70], maxZoom: 9, animate: false })
    } else {
      map.fitBounds([[5.2, 97.2], [20.7, 105.8]], { padding: [35, 35], animate: false })
    }
  }, [feature, map, resetKey])
  return null
}

function InvalidateMapSize({ resetKey }: { resetKey: string }) {
  const map = useMap()
  useEffect(() => {
    const timeout = window.setTimeout(() => map.invalidateSize(), 120)
    return () => window.clearTimeout(timeout)
  }, [map, resetKey])
  return null
}

function App() {
  const [connected, setConnected] = useState(socket.connected)
  const [provinces, setProvinces] = useState<ProvinceCollection | null>(null)
  const [provinceError, setProvinceError] = useState('')
  const [googleMapsConfigured, setGoogleMapsConfigured] = useState<boolean | null>(null)
  const [cartoTileUrl, setCartoTileUrl] = useState('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png')
  const [googleConfigError, setGoogleConfigError] = useState('')
  const [viewControl, setViewControl] = useState({ roundKey: '', turn: 0, fov: 90 })
  const [room, setRoom] = useState<RoomState | null>(null)
  const [playerId, setPlayerId] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [rounds, setRounds] = useState(5)
  const [timeLimit, setTimeLimit] = useState(60)
  const [now, setNow] = useState(() => Date.now())
  // ส่วนต่างนาฬิกา server กับเครื่องนี้ เพื่อให้นับถอยหลังตรงกันทุกเครื่อง
  const [clockOffset, setClockOffset] = useState(0)
  const [scopeId, setScopeId] = useState('')
  const [districtId, setDistrictId] = useState('')
  const [districts, setDistricts] = useState<DistrictCollection | null>(null)
  const [districtError, setDistrictError] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [showJoin, setShowJoin] = useState(false)
  const [guess, setGuess] = useState<Point | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [mapExpanded, setMapExpanded] = useState(false)

  useEffect(() => {
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    const onRoomState = (state: RoomState) => {
      setClockOffset(state.serverNow - Date.now())
      setRoom(state)
    }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('room:state', onRoomState)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('room:state', onRoomState)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/data/provinces.geojson', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('โหลดแผนที่จังหวัดไม่สำเร็จ')
        return response.json() as Promise<ProvinceCollection>
      })
      .then(setProvinces)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setProvinceError(cause instanceof Error ? cause.message : 'โหลดแผนที่จังหวัดไม่สำเร็จ')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${serverUrl}/api/config`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('ตรวจสอบการตั้งค่า Google Maps ไม่สำเร็จ')
        return response.json() as Promise<{ googleMapsConfigured: boolean; cartoTileUrl?: string }>
      })
      .then((config) => {
        setGoogleMapsConfigured(config.googleMapsConfigured)
        if (config.cartoTileUrl) setCartoTileUrl(config.cartoTileUrl)
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setGoogleConfigError(cause instanceof Error ? cause.message : 'ตรวจสอบการตั้งค่า Google Maps ไม่สำเร็จ')
      })
    return () => controller.abort()
  }, [])

  // โหลดขอบเขตอำเภอเมื่อต้องใช้เท่านั้น เพราะไฟล์ใหญ่กว่าจังหวัดหลายเท่า
  const needDistricts = Boolean(scopeId || room?.districtId)
  useEffect(() => {
    if (!needDistricts || districts) return
    const controller = new AbortController()
    fetch('/data/districts.geojson', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('โหลดรายชื่ออำเภอไม่สำเร็จ')
        return response.json() as Promise<DistrictCollection>
      })
      .then(setDistricts)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setDistrictError(cause instanceof Error ? cause.message : 'โหลดรายชื่ออำเภอไม่สำเร็จ')
      })
    return () => controller.abort()
  }, [needDistricts, districts])

  const districtOptions = useMemo(
    () => (districts?.features ?? []).filter((feature) => feature.properties.provinceId === scopeId),
    [districts, scopeId],
  )
  const provinceOptions = useMemo(
    () => [...(provinces?.features ?? [])].sort((a, b) => a.properties.name_th.localeCompare(b.properties.name_th, 'th')),
    [provinces],
  )
  const selectedDistrict = districts?.features.find((feature) => feature.properties.id === room?.districtId)
  const selectedFeature = selectedDistrict ?? provinces?.features.find((feature) => feature.properties.id === room?.scopeId)
  const myPlayer = room?.players.find((player) => player.id === playerId)
  const myResult = room?.guesses.find((result) => result.playerId === playerId)
  const isHost = room?.hostId === playerId
  const canGuess = room?.phase === 'playing' && !myPlayer?.hasGuessed
  const roundEndsAt = room?.phase === 'playing' ? room.roundEndsAt : null
  const remainingMs = roundEndsAt ? Math.max(0, roundEndsAt - (now + clockOffset)) : null

  useEffect(() => {
    if (!roundEndsAt) return
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [roundEndsAt])
  const canCreate = connected && Boolean(provinces) && !busy
  const currentRoundKey = room ? `${room.roomCode}-${room.currentRound}` : ''
  const currentViewControl = viewControl.roundKey === currentRoundKey
    ? viewControl
    : { roundKey: currentRoundKey, turn: 0, fov: 90 }

  const ensureConnected = async () => {
    if (socket.connected) return
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองอีกครั้ง')), 8000)
      socket.once('connect', () => {
        window.clearTimeout(timeout)
        resolve()
      })
      socket.once('connect_error', () => {
        window.clearTimeout(timeout)
        reject(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองอีกครั้ง'))
      })
      socket.connect()
    })
  }

  const setRoomFromResponse = (response: CreateRoomResult) => {
    setRoom(response.state)
    setPlayerId(response.playerId)
    setError('')
  }

  const createGame = async (solo: boolean) => {
    setBusy(true)
    setError('')
    try {
      await ensureConnected()
      const response = await emitWithAck<CreateRoomResult>((ack) => socket.emit('room:create', {
        name: playerName.trim() || 'นักสำรวจ',
        rounds,
        timeLimit,
        provinceId: scopeId || null,
        districtId: (scopeId && districtId) || null,
        solo,
      }, ack))
      setRoomFromResponse(response)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'สร้างเกมไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const joinGame = async () => {
    setBusy(true)
    setError('')
    try {
      await ensureConnected()
      const response = await emitWithAck<CreateRoomResult>((ack) => socket.emit('room:join', {
        name: playerName.trim() || 'นักสำรวจ',
        roomCode: joinCode.trim().toUpperCase(),
      }, ack))
      setRoomFromResponse(response)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เข้าร่วมห้องไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const startGame = async () => {
    setBusy(true)
    setError('')
    try {
      await emitWithAck((ack) => socket.emit('game:start', ack))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เริ่มเกมไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const submitGuess = async () => {
    if (!guess || !canGuess) return
    setBusy(true)
    setError('')
    try {
      await emitWithAck((ack) => socket.emit('game:guess', guess, ack))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ส่งคำตอบไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  // ส่งหมุดที่ปักไว้ให้อัตโนมัติก่อนหมดเวลา
  const autoSubmitRound = useRef('')
  useEffect(() => {
    if (remainingMs === null || remainingMs > 1000 || !guess || !canGuess || busy || !room) return
    const roundKey = `${room.roomCode}-${room.currentRound}`
    if (autoSubmitRound.current === roundKey) return
    autoSubmitRound.current = roundKey
    void submitGuess()
  })

  const nextRound = async () => {
    setBusy(true)
    setError('')
    try {
      await emitWithAck((ack) => socket.emit('game:next', ack))
      setGuess(null)
      setMapExpanded(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ไปต่อไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }

  const leaveGame = () => {
    socket.emit('room:leave')
    setRoom(null)
    setPlayerId('')
    setGuess(null)
    setMapExpanded(false)
    setError('')
  }

  const copyRoomCode = async () => {
    if (!room) return
    try {
      await navigator.clipboard.writeText(room.roomCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('คัดลอกรหัสไม่ได้ กรุณาคัดลอกด้วยตัวเอง')
    }
  }

  const adjustStreetView = (turnDelta: number, fovDelta: number) => {
    setViewControl((current) => {
      const base = current.roundKey === currentRoundKey
        ? current
        : { roundKey: currentRoundKey, turn: 0, fov: 90 }
      return {
        roundKey: currentRoundKey,
        turn: ((base.turn + turnDelta + 360) % 360 + 360) % 360,
        fov: Math.max(10, Math.min(100, base.fov + fovDelta)),
      }
    })
  }

  const enterStreetViewFullscreen = async () => {
    const frame = document.querySelector<HTMLIFrameElement>('.street-view-frame iframe')
    if (!frame) {
      setError('ไม่พบภาพ Street View สำหรับขยาย')
      return
    }
    try {
      await frame.requestFullscreen()
    } catch (cause) {
      setError(cause instanceof Error ? `ขยายภาพเต็มจอไม่ได้: ${cause.message}` : 'ขยายภาพเต็มจอไม่ได้')
    }
  }

  if (room?.phase === 'lobby') {
    return (
      <main className="lobby-page">
        <header className="topbar">
          <a className="brand" href="#" onClick={(event) => { event.preventDefault(); leaveGame() }}>
            <span className="brand-mark"><Compass size={21} /></span><span>แผนที่ลับ<small>GEO THAILAND</small></span>
          </a>
          <button className="quiet-button" onClick={leaveGame}><X size={16} /> ออกจากห้อง</button>
        </header>
        <section className="lobby-card">
          <span className="eyebrow"><Radio size={14} /> ห้องพร้อมแล้ว</span>
          <h1>ชวนเพื่อนมาออกสำรวจกัน</h1>
          <p>ส่งรหัสห้องให้เพื่อน แล้วรอให้ทุกคนเข้ามาก่อนเริ่มเกม</p>
          <button className="room-code-card" onClick={copyRoomCode}>
            <small>รหัสห้อง</small><strong>{room.roomCode.split('').join(' ')}</strong>
            <span>{copied ? <><Check size={14} /> คัดลอกแล้ว</> : <><Clipboard size={14} /> แตะเพื่อคัดลอก</>}</span>
          </button>
          <div className="lobby-settings"><span><MapPin size={15} />{room.scopeName}</span><span><Flag size={15} />{room.totalRounds} รอบ</span><span><Timer size={15} />{formatTimeLimit(room.timeLimit)}</span></div>
          <div className="players-panel">
            <div className="players-heading">นักสำรวจในห้อง <small>{room.players.length} คน</small></div>
            {room.players.map((player, index) => (
              <div className="lobby-player" key={player.id}>
                <span className={`avatar avatar-${index % 4}`}>{player.name.slice(0, 1)}</span>
                <span>{player.name}{player.id === playerId && <small className="you-label">คุณ</small>}</span>
                {player.id === room.hostId && <small className="host-label">HOST</small>}
              </div>
            ))}
            {room.players.length < 2 && <div className="lobby-wait"><i /> กำลังรอเพื่อนเข้าร่วม...</div>}
          </div>
          {error && <p className="error-text">{error}</p>}
          {isHost ? (
            <button className="primary-button wide-button" disabled={busy || room.players.length < 2} onClick={startGame}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />} เริ่มเกม <ArrowRight size={17} />
            </button>
          ) : <p className="host-wait"><LoaderCircle className="spin" size={15} /> รอเจ้าของห้องเริ่มเกม</p>}
          {isHost && room.players.length < 2 && <small className="small-note">ต้องมีผู้เล่นอย่างน้อย 2 คนเพื่อเริ่มเกม</small>}
        </section>
        <p className="lobby-footer"><CircleHelp size={15} /> ผู้เล่นทุกคนต้องเปิดเว็บนี้พร้อมกันเพื่อเข้าเล่น</p>
      </main>
    )
  }

  if (room) {
    const reveal = room.phase === 'reveal' || room.phase === 'finished'
    const target = room.target
    const rankedPlayers = [...room.players].sort((a, b) => b.score - a.score)
    return (
      <main className="game-screen">
        <div className="street-view-frame">
          {googleMapsConfigured ? (
            <iframe
              key={`${currentRoundKey}-${currentViewControl.turn}-${currentViewControl.fov}`}
              src={`${serverUrl}/api/round-view/${encodeURIComponent(room.roomCode)}?round=${room.currentRound}&turn=${currentViewControl.turn}&fov=${currentViewControl.fov}`}
              title="Google Maps Street View"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <div className="street-view-fallback">
              <span className="street-view-fallback-icon"><MapPin size={22} /></span>
              <h2>{googleMapsConfigured === null ? 'กำลังเตรียมภาพ Street View' : 'ยังไม่ได้ตั้งค่า Google Maps'}</h2>
              <p>{googleConfigError || 'เพิ่ม Google Maps Embed API key ในไฟล์ .env.local เพื่อแสดงภาพรอบเกม'}</p>
              {googleMapsConfigured === false && <>
                <a href={`${serverUrl}/api/round-link/${encodeURIComponent(room.roomCode)}`} target="_blank" rel="noreferrer">เปิดภาพใน Google Maps แท็บใหม่ <ArrowRight size={15} /></a>
                <a href="https://developers.google.com/maps/documentation/embed/get-api-key" target="_blank" rel="noreferrer">วิธีตั้งค่า API key</a>
              </>}
            </div>
          )}
        </div>
        {googleMapsConfigured && (
          <div className="street-view-controls" role="group" aria-label="ควบคุมภาพ Street View">
            <button type="button" aria-label="หมุนภาพไปทางซ้าย" title="หมุนซ้าย 45°" onClick={() => adjustStreetView(-45, 0)}><RotateCcw size={17} /></button>
            <button type="button" aria-label="หมุนภาพไปทางขวา" title="หมุนขวา 45°" onClick={() => adjustStreetView(45, 0)}><RotateCw size={17} /></button>
            <span className="street-control-divider" />
            <button type="button" aria-label="ซูมเข้า" title="ซูมเข้า" disabled={currentViewControl.fov <= 10} onClick={() => adjustStreetView(0, -15)}><ZoomIn size={17} /></button>
            <button type="button" aria-label="ซูมออก" title="ซูมออก" disabled={currentViewControl.fov >= 100} onClick={() => adjustStreetView(0, 15)}><ZoomOut size={17} /></button>
            <span className="street-control-divider" />
            <button type="button" aria-label="ขยายภาพเต็มจอ" title="ขยายภาพเต็มจอ" onClick={enterStreetViewFullscreen}><Expand size={16} /></button>
          </div>
        )}
        <header className="game-topbar">
          <button className="back-button" onClick={leaveGame} aria-label="ออกจากเกม"><ArrowLeft size={18} /></button>
          <div className="game-brand"><span className="brand-mark"><Compass size={17} /></span> แผนที่ลับ</div>
          <span className="room-pill"><Users size={14} /> {room.roomCode}</span>
          {remainingMs !== null && <span className={`timer-pill ${remainingMs <= 10000 ? 'urgent' : ''}`} role="timer" aria-label="เวลาที่เหลือ"><Timer size={14} /> {Math.floor(Math.ceil(remainingMs / 1000) / 60)}:{String(Math.ceil(remainingMs / 1000) % 60).padStart(2, '0')}</span>}
          <span className={`live-pill ${connected ? 'online' : ''}`}><i /> {connected ? 'เชื่อมต่อแล้ว' : 'ขาดการเชื่อมต่อ'}</span>
        </header>
        <section className="round-card">
          <div className="round-meta"><span>รอบที่ {room.currentRound} / {room.totalRounds}</span><span className="round-bars">{Array.from({ length: room.totalRounds }, (_, index) => <i key={index} className={index < room.currentRound ? 'active' : ''} />)}</span></div>
          <h1>{room.phase === 'finished' ? 'จบทริปแล้ว!' : reveal ? 'เฉลยตำแหน่ง' : 'จุดหมายอยู่ที่ไหน?'}</h1>
          {reveal && target && <p className="hint-text"><Sparkles size={14} />คำตอบคือ {formatTargetLocation(target)}</p>}
          <span className="scope-pill"><MapPin size={13} /> ขอบเขต: {room.scopeName}</span>
        </section>
        <aside className="scoreboard">
          <div className="scoreboard-title"><span><Medal size={15} /> คะแนนรวม</span><small>{room.players.length} คน</small></div>
          {rankedPlayers.map((player, index) => (
            <div className={`score-row ${player.id === playerId ? 'current-player' : ''}`} key={player.id}>
              <span className={`rank rank-${index + 1}`}>{index + 1}</span><span className={`avatar avatar-${index % 4}`}>{player.name.slice(0, 1)}</span>
              <span className="score-name">{player.name}{player.id === playerId && <small>คุณ</small>}</span><b>{player.score.toLocaleString()}</b>
            </div>
          ))}
          {room.phase === 'playing' && <div className="guess-count"><i /> ตอบแล้ว {room.players.filter((player) => player.hasGuessed).length}/{room.players.length} คน</div>}
        </aside>
        <section className={`guess-map-card ${mapExpanded ? 'expanded' : ''}`}>
          <div className="guess-map-header">
            <span><Map size={15} /> แผนที่สำหรับปักหมุด</span>
            <button onClick={() => setMapExpanded((expanded) => !expanded)} aria-label={mapExpanded ? 'ย่อแผนที่' : 'ขยายแผนที่'}>
              {mapExpanded ? <X size={15} /> : <Expand size={15} />}
            </button>
          </div>
          <div className="guess-map-canvas">
            <MapContainer center={[15.8, 101]} zoom={5} zoomControl minZoom={4} maxZoom={13} scrollWheelZoom>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attribution/">CARTO</a>'
                url={cartoTileUrl}
              />
              {provinces && <LeafletGeoJSON
                data={provinces}
                style={(feature) => ({
                  color: feature?.properties?.id === room.scopeId ? '#d4865f' : '#82968b',
                  weight: feature?.properties?.id === room.scopeId ? 2 : 0.8,
                  opacity: feature?.properties?.id === room.scopeId ? 0.95 : 0.48,
                  fillColor: feature?.properties?.id === room.scopeId ? '#e5aa83' : '#abbab0',
                  fillOpacity: feature?.properties?.id === room.scopeId ? 0.14 : 0.04,
                })}
              />}
              {selectedDistrict && <LeafletGeoJSON
                key={selectedDistrict.properties.id}
                data={selectedDistrict}
                interactive={false}
                style={{ color: '#c0603a', weight: 2, opacity: 0.95, fillColor: '#e5aa83', fillOpacity: 0.18, dashArray: '5 4' }}
              />}
              <FitMapToScope feature={selectedFeature} resetKey={room.roomCode} />
              <InvalidateMapSize resetKey={`${room.roomCode}-${mapExpanded}`} />
              <MapClickHandler disabled={!canGuess || busy} onSelect={setGuess} />
              {guess && <Marker position={[guess.lat, guess.lng]} icon={guessIcon} />}
              {reveal && target && <Marker position={[target.lat, target.lng]} icon={targetIcon} />}
              {reveal && target && guess && <Polyline
                positions={[[guess.lat, guess.lng], [target.lat, target.lng]]}
                pathOptions={{ color: '#cf7954', weight: 3, dashArray: '7 8', opacity: 0.8 }}
              />}
            </MapContainer>
          </div>
        </section>
        <section className={`guess-panel ${reveal ? 'reveal-panel' : ''}`}>
          {room.phase === 'playing' ? (
            <>
              <div className="guess-description"><span><MousePointer2 size={17} /></span><div><b>{myPlayer?.hasGuessed ? 'ส่งคำตอบแล้ว' : 'ปักหมุดบนแผนที่'}</b><small>{myPlayer?.hasGuessed ? 'รอผู้เล่นคนอื่นตอบ...' : guess ? `${guess.lat.toFixed(4)}°, ${guess.lng.toFixed(4)}°` : 'แตะตำแหน่งที่คิดว่าใช่'}</small></div></div>
              {myPlayer?.hasGuessed
                ? <span className="waiting-message"><LoaderCircle className="spin" size={16} /> รอเพื่อนตอบอยู่</span>
                : <button className="primary-button submit-button" disabled={!guess || busy} onClick={submitGuess}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />} ส่งคำตอบ</button>}
            </>
          ) : reveal ? (
            <>
              <div className="result-summary"><small>{room.phase === 'finished' ? 'คะแนนสุดท้ายของคุณ' : 'คำตอบของคุณ'}</small><b>{myResult ? `${myResult.points.toLocaleString()} คะแนน` : '—'}</b><span>{myResult ? `ห่างจากจุดหมาย ${myResult.distanceKm.toLocaleString(undefined, { maximumFractionDigits: 1 })} กม.` : 'ไม่มีคำตอบในรอบนี้'}</span></div>
              {room.phase === 'finished'
                ? <button className="primary-button next-button" onClick={leaveGame}>กลับหน้าหลัก <ArrowRight size={16} /></button>
                : isHost
                  ? <button className="primary-button next-button" disabled={busy} onClick={nextRound}>{busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />} รอบถัดไป</button>
                  : <span className="waiting-message"><LoaderCircle className="spin" size={15} /> รอเจ้าของห้องไปต่อ</span>}
            </>
          ) : null}
          {error && <p className="error-text">{error}</p>}
        </section>
      </main>
    )
  }

  return (
    <main className="home-page">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}><span className="brand-mark"><Compass size={21} /></span><span>แผนที่ลับ<small>GEO THAILAND</small></span></a>
        <div className="top-actions"><span className={`server-status ${connected ? 'online' : ''}`}><i />{connected ? 'เซิร์ฟเวอร์พร้อม' : 'กำลังเชื่อมต่อ...'}</span><a className="help-link" href="#how-to-play"><CircleHelp size={18} /></a></div>
      </header>
      <section className="hero-section">
        <div className="hero-copy">
          <span className="hero-badge"><Sparkles size={13} /> ออกเดินทางไปทั่วไทย</span>
          <h1>คุณรู้จัก<br /><em>เมืองไทย</em>แค่ไหน?</h1>
          <p>ดูภาพ Street View จาก Google Maps แล้วปักหมุดทายตำแหน่งให้ใกล้ที่สุด ชวนเพื่อนมาแข่งกันรู้จักประเทศไทย</p>
          <div className="hero-stats"><span><Map size={16} /><b>77</b> จังหวัด</span><i /><span><Users size={16} /><b>8</b> ผู้เล่น</span><i /><span><Flag size={16} /><b>1–10</b> รอบ</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-ring ring-one" /><div className="art-ring ring-two" /><div className="art-sun" />
          <div className="thailand-shape"><i className="shape-line line-one" /><i className="shape-line line-two" /><i className="shape-line line-three" /><span className="shape-pin"><MapPin size={22} fill="currentColor" /></span></div>
          <span className="art-note note-left"><i /> พร้อมออกเดินทาง</span><span className="art-note note-right">13°45' N&nbsp; 100°31' E</span><span className="art-caption"><Map size={14} /> THAILAND · 77 PROVINCES</span>
        </div>
      </section>
      <section className="setup-section" id="start">
        <div className="section-heading"><div><span className="eyebrow">เริ่มการเดินทาง</span><h2>เลือกการผจญภัยของคุณ</h2></div><span className="section-step">01 <i /> 02</span></div>
        <div className="setup-card">
          <div className="setup-fields">
            <label className="field-label" htmlFor="player-name">ชื่อที่ใช้ในเกม</label>
            <input id="player-name" className="text-input" value={playerName} maxLength={18} placeholder="เช่น นักเดินทาง" onChange={(event) => setPlayerName(event.target.value)} />
            <div className="field-row">
              <div><label className="field-label" htmlFor="round-count">จำนวนรอบ</label><div className="select-wrap"><select id="round-count" value={rounds} onChange={(event) => setRounds(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => index + 1).map((count) => <option value={count} key={count}>{count} รอบ</option>)}</select><ChevronDown size={16} /></div></div>
              <div><label className="field-label" htmlFor="time-limit">เวลาต่อรอบ</label><div className="select-wrap"><select id="time-limit" value={timeLimit} onChange={(event) => setTimeLimit(Number(event.target.value))}>{TIME_LIMIT_OPTIONS.map((seconds) => <option value={seconds} key={seconds}>{formatTimeLimit(seconds)}</option>)}</select><ChevronDown size={16} /></div></div>
              <div><label className="field-label" htmlFor="province-scope">ขอบเขตจังหวัด</label><div className="select-wrap"><select id="province-scope" value={scopeId} onChange={(event) => { setScopeId(event.target.value); setDistrictId('') }} disabled={!provinces}><option value="">สุ่มทั่วประเทศไทย</option>{provinceOptions.map((feature) => <option value={feature.properties.id} key={feature.properties.id}>{feature.properties.name_th}</option>)}</select><ChevronDown size={16} /></div></div>
              <div><label className="field-label" htmlFor="district-scope">ขอบเขตอำเภอ</label><div className="select-wrap"><select id="district-scope" value={districtId} onChange={(event) => setDistrictId(event.target.value)} disabled={!scopeId || !districts}><option value="">{!scopeId ? 'เลือกจังหวัดก่อน' : districts ? 'ทั้งจังหวัด' : 'กำลังโหลดอำเภอ...'}</option>{districtOptions.map((feature) => <option value={feature.properties.id} key={feature.properties.id}>{districtLabel(feature.properties)}</option>)}</select><ChevronDown size={16} /></div></div>
            </div>
            {provinceError && <p className="error-text">{provinceError}</p>}
            {districtError && <p className="error-text">{districtError}</p>}
            {error && <p className="error-text">{error}</p>}
            <div className="mode-tabs"><button className={!showJoin ? 'active' : ''} onClick={() => { setShowJoin(false); setError('') }}><Compass size={15} /> เล่นเลย</button><button className={showJoin ? 'active' : ''} onClick={() => { setShowJoin(true); setError('') }}><Users size={15} /> เข้าร่วมห้อง</button></div>
            {showJoin ? (
              <div className="join-panel"><label className="field-label" htmlFor="join-code">รหัสห้องจากเพื่อน</label><div className="join-row"><input id="join-code" className="text-input code-input" maxLength={6} placeholder="เช่น A7K2QX" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} /><button className="primary-button join-button" disabled={!canCreate || joinCode.trim().length !== 6} onClick={joinGame}>{busy ? <LoaderCircle className="spin" size={16} /> : <>เข้าห้อง <ArrowRight size={16} /></>}</button></div></div>
            ) : (
              <div className="start-actions"><button className="primary-button solo-button" disabled={!canCreate} onClick={() => createGame(true)}>{busy ? <LoaderCircle className="spin" size={17} /> : <Compass size={17} />} เล่นคนเดียว <ArrowRight size={17} /></button><button className="secondary-button" disabled={!canCreate} onClick={() => createGame(false)}><Users size={16} /> สร้างห้องเล่นกับเพื่อน</button></div>
            )}
            <p className="form-note"><CircleHelp size={14} /> ปักหมุดบนแผนที่ คะแนนคิดจากระยะห่าง</p>
            {googleMapsConfigured === false && <p className="google-key-note">เกมใช้ภาพ Street View ต้องตั้งค่า Google Maps Embed API key ก่อน</p>}
          </div>
          <div className="setup-art"><div className="setup-grid" /><div className="province-outline outline-one" /><div className="province-outline outline-two" /><div className="province-outline outline-three" /><span className="setup-pin"><MapPin size={17} fill="currentColor" /></span><span className="setup-place">ประเทศไทย</span><span className="setup-coords">13.7563° N<br />100.5018° E</span><div className="setup-art-footer"><b><Sparkles size={14} /> จุดหมายไม่ซ้ำกัน</b><span>ทุกจังหวัด · ทุกการเดินทาง</span></div></div>
        </div>
      </section>
      <section className="how-section" id="how-to-play">
        <div className="section-heading"><div><span className="eyebrow">ง่าย ๆ แค่สามขั้น</span><h2>เริ่มเล่นได้ในไม่กี่วินาที</h2></div></div>
        <div className="how-cards"><article><span><Map size={19} /></span><small>01</small><h3>เลือกขอบเขต</h3><p>สุ่มทั่วไทย หรือเลือกจังหวัดที่อยากสำรวจ</p></article><article><span><MousePointer2 size={19} /></span><small>02</small><h3>สำรวจภาพ Street View</h3><p>ดูบรรยากาศรอบตัว แล้วปักหมุดบนแผนที่</p></article><article><span><Medal size={19} /></span><small>03</small><h3>เก็บคะแนน</h3><p>ยิ่งทายใกล้ ยิ่งได้คะแนนมากกว่าเพื่อน</p></article></div>
      </section>
      <footer className="site-footer"><span className="footer-brand"><span className="brand-mark"><Compass size={16} /></span> แผนที่ลับ</span><span>แผนที่ OpenStreetMap · CARTO · ขอบเขตจังหวัด geoBoundaries (ODbL 1.0)</span><span>สร้างมาเพื่อคนรักการเดินทางในไทย</span></footer>
    </main>
  )
}

export default App
