/**
 * The scripts' copy of `src/server/ssh-tunnel.ts` (the authority — read it for
 * why): a preset with `ssh` is reached through `ssh -N -L` to a free loopback
 * port, its host and port being the database as that server sees it.
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import pg from 'pg'
import { clientConfig } from './local-metadata.mjs'

/**
 * A connected `pg.Client` for the preset; `end()` also closes its tunnel.
 * `extra` is merged into the client config (`options`, `application_name`).
 */
export async function openClient(preset, database, extra = {}) {
  const config = { ...clientConfig(preset, database), ...extra }
  let tunnel = null
  if (preset.ssh) {
    tunnel = await openTunnel(preset.ssh, config.host, config.port)
    config.host = '127.0.0.1'
    config.port = tunnel.port
  }
  const client = new pg.Client(config)
  const end = client.end.bind(client)
  client.end = async () => {
    try {
      await end()
    } finally {
      tunnel?.child.kill()
    }
  }
  try {
    await client.connect()
  } catch (err) {
    tunnel?.child.kill()
    throw err
  }
  return client
}

async function openTunnel(destination, remoteHost, remotePort) {
  if (!destination || destination.startsWith('-') || /\s/.test(destination)) {
    throw new Error(`Not an ssh destination: "${destination}"`)
  }
  const port = await freePort()
  const child = spawn('ssh', [
    '-N', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30', '-L', `127.0.0.1:${port}:${remoteHost}:${remotePort}`, destination,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000) })
  let exited = false
  child.on('exit', () => { exited = true })
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (exited) throw new Error(`SSH tunnel to ${destination} failed: ${stderr.trim() || 'ssh exited'}`)
    if (await accepts(port)) return { port, child }
    await new Promise((r) => setTimeout(r, 150))
  }
  child.kill()
  throw new Error(`SSH tunnel to ${destination} did not open within 15s`)
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function accepts(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
  })
}
