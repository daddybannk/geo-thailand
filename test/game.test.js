import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Server } from 'socket.io'
import { io as createClient } from 'socket.io-client'
import { AQUATIC_NAMES, distanceInKm, districtLabel, generateDistrictLocation, generateLocation, pointInProvince, registerGameHandlers } from '../server/game.js'

const provinces = JSON.parse(readFileSync(new URL('../public/data/provinces.geojson', import.meta.url))).features
const districts = JSON.parse(readFileSync(new URL('../public/data/districts.geojson', import.meta.url))).features

test('province boundaries cover all 77 provinces and sampled points stay in scope', () => {
  assert.equal(provinces.length, 77)
  for (const province of provinces) {
    const point = generateLocation(provinces, province.properties.id)
    assert.equal(point.provinceId, province.properties.id)
    assert.ok(pointInProvince(point, province), `sample fell outside ${province.properties.name_th}`)
  }
})

test('distance calculations and province validation are well defined', () => {
  assert.equal(distanceInKm({ lat: 13.75, lng: 100.5 }, { lat: 13.75, lng: 100.5 }), 0)
  assert.ok(distanceInKm({ lat: 13.75, lng: 100.5 }, { lat: 14.75, lng: 100.5 }) > 100)
  assert.throws(() => generateLocation(provinces, 'missing-province'), /ไม่พบจังหวัด/)
})

test('host and clients complete a multiplayer round without exposing the answer early', async (context) => {
  const httpServer = createServer()
  const ioServer = new Server(httpServer)
  registerGameHandlers(ioServer, provinces, {
    findAddress: async () => ({ subdistrict: 'ตำบลทดสอบ', district: 'อำเภอทดสอบ' }),
  })
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address()
  const url = `http://127.0.0.1:${address.port}`
  const host = createClient(url, { transports: ['websocket'] })
  const guest = createClient(url, { transports: ['websocket'] })
  context.after(async () => {
    host.disconnect()
    guest.disconnect()
    await new Promise((resolve) => ioServer.close(resolve))
  })

  await Promise.all([waitForEvent(host, 'connect'), waitForEvent(guest, 'connect')])
  const created = await sendWithAck(host, 'room:create', {
    name: 'Host',
    rounds: 1,
    provinceId: provinces[0].properties.id,
    solo: false,
  })
  assert.equal(created.ok, true)
  assert.equal(created.state.phase, 'lobby')

  assert.equal((await sendWithAck(guest, 'room:join', null)).ok, false)
  const joined = await sendWithAck(guest, 'room:join', { name: 'Guest', roomCode: created.roomCode })
  assert.equal(joined.ok, true)
  assert.equal(joined.state.players.length, 2)
  const unauthorizedStart = await sendWithAck(guest, 'game:start')
  assert.equal(unauthorizedStart.ok, false)

  const hostPlaying = waitForState(host, (state) => state.phase === 'playing')
  const guestPlaying = waitForState(guest, (state) => state.phase === 'playing')
  assert.equal((await sendWithAck(host, 'game:start')).ok, true)
  const playingStates = await Promise.all([hostPlaying, guestPlaying])
  assert.ok(playingStates.every((state) => state.target === undefined))

  assert.equal((await sendWithAck(host, 'game:guess', null)).ok, false)
  const hostReveal = waitForState(host, (state) => state.phase === 'reveal' && state.target?.address)
  const guestReveal = waitForState(guest, (state) => state.phase === 'reveal' && state.target?.address)
  const guestSeesHostGuess = waitForState(guest, (state) => state.players.some((player) => player.hasGuessed))
  assert.equal((await sendWithAck(host, 'game:guess', { lat: 13.75, lng: 100.5 })).ok, true)
  const midRound = await guestSeesHostGuess
  assert.equal(midRound.phase, 'playing')
  assert.ok(midRound.players.every((player) => player.score === 0 && player.roundPoints === 0))
  assert.equal((await sendWithAck(guest, 'game:guess', { lat: 14.25, lng: 100.5 })).ok, true)
  const revealed = await Promise.all([hostReveal, guestReveal])
  assert.ok(revealed.every((state) => state.target && state.guesses.length === 2))
  assert.ok(revealed.every((state) => state.target.address.subdistrict === 'ตำบลทดสอบ' && state.target.address.district === 'อำเภอทดสอบ'))
  assert.ok(revealed.every((state) => state.players.every((player) => player.score > 0)))

  const hostFinished = waitForState(host, (state) => state.phase === 'finished')
  const guestFinished = waitForState(guest, (state) => state.phase === 'finished')
  assert.equal((await sendWithAck(host, 'game:next')).ok, true)
  assert.ok((await Promise.all([hostFinished, guestFinished])).every((state) => state.currentRound === 1))
})

test('district boundaries belong to a province and sampled points stay in the district', () => {
  assert.equal(districts.length, 928)
  for (const district of districts) {
    const point = generateDistrictLocation(district, provinces)
    assert.equal(point.provinceId, district.properties.provinceId)
    assert.ok(pointInProvince(point, district), `sample fell outside ${district.properties.name_th}`)
  }
})

test('district-scoped rooms validate the district and reveal its name', async (context) => {
  const httpServer = createServer()
  const ioServer = new Server(httpServer)
  registerGameHandlers(ioServer, provinces, {
    districts,
    findAddress: async () => ({ subdistrict: 'ตำบลทดสอบ', district: 'อำเภอจาก Nominatim' }),
  })
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const client = createClient(`http://127.0.0.1:${httpServer.address().port}`, { transports: ['websocket'] })
  context.after(async () => {
    client.disconnect()
    await new Promise((resolve) => ioServer.close(resolve))
  })
  await waitForEvent(client, 'connect')

  const district = districts.find((feature) => feature.properties.provinceId === 'chiang-mai')
  const otherProvince = districts.find((feature) => feature.properties.provinceId !== 'chiang-mai')
  const config = { name: 'Solo', rounds: 1, timeLimit: 0, provinceId: 'chiang-mai', solo: true }
  assert.equal((await sendWithAck(client, 'room:create', { ...config, districtId: otherProvince.properties.id })).ok, false)
  assert.equal((await sendWithAck(client, 'room:create', { ...config, districtId: 'missing' })).ok, false)

  const created = await sendWithAck(client, 'room:create', { ...config, districtId: district.properties.id })
  assert.equal(created.ok, true)
  assert.equal(created.state.districtId, district.properties.id)
  assert.equal(created.state.scopeName, `${districtLabel(district)} · เชียงใหม่`)

  const revealed = waitForState(client, (state) => state.phase === 'reveal' && state.target?.address)
  assert.equal((await sendWithAck(client, 'game:guess', { lat: 18.79, lng: 98.98 })).ok, true)
  const state = await revealed
  assert.equal(state.target.provinceId, 'chiang-mai')
  assert.deepEqual(state.target.address, { subdistrict: 'ตำบลทดสอบ', district: districtLabel(district) })
})

test('players without a name get distinct random aquatic animal names', async (context) => {
  const httpServer = createServer()
  const ioServer = new Server(httpServer)
  registerGameHandlers(ioServer, provinces, { findAddress: async () => null })
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${httpServer.address().port}`
  const clients = Array.from({ length: 4 }, () => createClient(url, { transports: ['websocket'] }))
  context.after(async () => {
    for (const client of clients) client.disconnect()
    await new Promise((resolve) => ioServer.close(resolve))
  })
  await Promise.all(clients.map((client) => waitForEvent(client, 'connect')))

  const [host, named, ...guests] = clients
  const created = await sendWithAck(host, 'room:create', { name: '   ', rounds: 1, timeLimit: 0, provinceId: null, solo: false })
  assert.equal((await sendWithAck(named, 'room:join', { name: 'Ben', roomCode: created.roomCode })).ok, true)
  let state
  for (const guest of guests) {
    const joined = await sendWithAck(guest, 'room:join', { name: '', roomCode: created.roomCode })
    assert.equal(joined.ok, true)
    state = joined.state
  }
  const names = state.players.map((player) => player.name)
  assert.ok(names.includes('Ben'))
  const randomNames = names.filter((name) => name !== 'Ben')
  assert.equal(randomNames.length, 3)
  assert.ok(randomNames.every((name) => AQUATIC_NAMES.includes(name)))
  assert.equal(new Set(randomNames).size, randomNames.length)
})

test('timed rounds reveal automatically and advance after the reveal pause', async (context) => {
  const httpServer = createServer()
  const ioServer = new Server(httpServer)
  registerGameHandlers(ioServer, provinces, {
    findAddress: async () => null,
    msPerSecond: 5,
  })
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const client = createClient(`http://127.0.0.1:${httpServer.address().port}`, { transports: ['websocket'] })
  context.after(async () => {
    client.disconnect()
    await new Promise((resolve) => ioServer.close(resolve))
  })
  await waitForEvent(client, 'connect')

  const invalid = await sendWithAck(client, 'room:create', { name: 'Solo', rounds: 1, timeLimit: 45, provinceId: null, solo: true })
  assert.equal(invalid.ok, false)

  const revealed = waitForState(client, (state) => state.phase === 'reveal')
  const created = await sendWithAck(client, 'room:create', { name: 'Solo', rounds: 2, timeLimit: 30, provinceId: null, solo: true })
  assert.equal(created.ok, true)
  assert.equal(created.state.timeLimit, 30)
  assert.ok(created.state.roundEndsAt > created.state.serverNow)
  const state = await revealed
  assert.equal(state.roundEndsAt, null)
  assert.ok(state.nextRoundAt > state.serverNow)
  assert.equal(state.guesses.length, 0)
  assert.equal(state.players[0].roundPoints, 0)
  const secondRound = waitForState(client, (next) => next.phase === 'playing' && next.currentRound === 2)
  assert.equal((await sendWithAck(client, 'game:guess', { lat: 13.75, lng: 100.5 })).ok, false)
  assert.equal((await secondRound).nextRoundAt, null)

  const finished = waitForState(client, (next) => next.phase === 'finished')
  assert.equal((await sendWithAck(client, 'game:guess', { lat: 13.75, lng: 100.5 })).ok, true)
  assert.equal((await finished).currentRound, 2)
})

function waitForEvent(socket, eventName) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}`)), 5000)
    socket.once(eventName, (...args) => {
      clearTimeout(timeout)
      resolve(args[0])
    })
  })
}

function waitForState(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('room:state', onState)
      reject(new Error('Timed out waiting for room state'))
    }, 5000)
    const onState = (state) => {
      if (!predicate(state)) return
      clearTimeout(timeout)
      socket.off('room:state', onState)
      resolve(state)
    }
    socket.on('room:state', onState)
  })
}

function sendWithAck(socket, eventName, ...args) {
  return new Promise((resolve) => socket.emit(eventName, ...args, resolve))
}
