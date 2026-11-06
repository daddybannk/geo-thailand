import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Server } from 'socket.io'
import { registerGameHandlers } from './server/game.js'

const root = dirname(fileURLToPath(import.meta.url))
const provincesPath = resolve(root, 'public/data/provinces.geojson')
const provinces = JSON.parse(readFileSync(provincesPath, 'utf8')).features
const districts = JSON.parse(readFileSync(resolve(root, 'public/data/districts.geojson'), 'utf8')).features
const app = express()
const httpServer = createServer(app)
// รายชื่อ origin ของ frontend ที่แยก deploy (คั่นด้วย comma) เช่น https://geo-thailand.vercel.app
const clientOrigins = (process.env.CLIENT_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
const io = new Server(httpServer, clientOrigins.length ? { cors: { origin: clientOrigins } } : {})
const distPath = resolve(root, 'dist')
const googleMapsKey = process.env.GOOGLE_MAPS_EMBED_API_KEY
const cartoBasemapKey = process.env.CARTO_BASEMAP_KEY

if (clientOrigins.length) {
  app.use('/api', (request, response, next) => {
    const origin = request.headers.origin
    if (origin && clientOrigins.includes(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
    }
    next()
  })
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.get('/api/config', (_request, response) => {
  const tileUrl = cartoBasemapKey
    ? `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${encodeURIComponent(cartoBasemapKey)}`
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
  response.json({
    googleMapsConfigured: Boolean(googleMapsKey),
    cartoTileUrl: tileUrl,
  })
})

const getRoundView = registerGameHandlers(io, provinces, { districts })

app.get('/api/round-view/:roomCode', (request, response) => {
  const view = getRoundView(request.params.roomCode)
  if (!view) {
    response.status(404).send('ไม่พบภาพของรอบนี้')
    return
  }
  if (!googleMapsKey) {
    response.status(503).send('ยังไม่ได้ตั้งค่า Google Maps Embed API key')
    return
  }

  const turn = Number(request.query.turn ?? 0)
  const fieldOfView = Number(request.query.fov ?? 90)
  if (!Number.isFinite(turn) || turn < -360 || turn > 360 || !Number.isFinite(fieldOfView) || fieldOfView < 10 || fieldOfView > 100) {
    response.status(400).send('การตั้งค่ามุมมองไม่ถูกต้อง')
    return
  }

  const parameters = new URLSearchParams({
    key: googleMapsKey,
    location: `${view.lat},${view.lng}`,
    heading: String((view.heading + turn + 360) % 360),
    pitch: '0',
    fov: String(fieldOfView),
    radius: '5000',
    language: 'th',
    region: 'TH',
  })
  const embedUrl = `https://www.google.com/maps/embed/v1/streetview?${parameters.toString()}`
  const safeEmbedUrl = embedUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  response.type('html').send(`<!doctype html>
    <html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>html,body,iframe{width:100%;height:100%;margin:0;border:0;background:#e9eee8}</style></head>
    <body><iframe title="Google Maps Street View" src="${safeEmbedUrl}" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></body></html>`)
})

app.get('/api/round-link/:roomCode', (request, response) => {
  const view = getRoundView(request.params.roomCode)
  if (!view) {
    response.status(404).send('ไม่พบภาพของรอบนี้')
    return
  }
  const viewpoint = encodeURIComponent(`${view.lat},${view.lng}`)
  response.redirect(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${viewpoint}`)
})

if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get(/.*/, (_request, response) => response.sendFile(resolve(distPath, 'index.html')))
}

const port = Number(process.env.PORT ?? 3000)
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Geo Thailand server listening on http://localhost:${port}`)
})
