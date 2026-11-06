import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Server } from 'socket.io'
import { io as createClient } from 'socket.io-client'
import { distanceInKm, generateLocation, pointInProvince, registerGameHandlers } from '../server/game.js'

const provinces = JSON.parse(readFileSync(new URL('../public/data/provinces.geojson', import.meta.url))).features

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
  assert.equal((await sendWithAck(host, 'game:guess', { lat: 13.75, lng: 100.5 })).ok, true)
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

test('timed rounds reveal automatically when time runs out', async (context) => {
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
  const created = await sendWithAck(client, 'room:create', { name: 'Solo', rounds: 1, timeLimit: 30, provinceId: null, solo: true })
  assert.equal(created.ok, true)
  assert.equal(created.state.timeLimit, 30)
  assert.ok(created.state.roundEndsAt > created.state.serverNow)
  const state = await revealed
  assert.equal(state.roundEndsAt, null)
  assert.equal(state.guesses.length, 0)
  assert.equal(state.players[0].roundPoints, 0)
  assert.equal((await sendWithAck(client, 'game:guess', { lat: 13.75, lng: 100.5 })).ok, false)
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
