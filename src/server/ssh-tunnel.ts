import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import net from 'node:net'

/**
 * Reaching a database that only listens on its own server's loopback.
 *
 * A connection with `ssh` set (`root@10.0.0.5`, or an alias from
 * `~/.ssh/config`) is opened through `ssh -N -L`: its `host` and `port` are the
 * database as *that* server sees it, and Postgres is asked for on a free
 * loopback port here. The system `ssh` does the work, so keys, agents, known
 * hosts and config aliases are the user's own and nothing secret passes through
 * this app. `BatchMode` means a key that needs typing fails fast instead of
 * hanging on a prompt nobody can see.
 *
 * One tunnel per destination and target, shared by every pool on it; a tunnel
 * that dies is forgotten, so the next pool build opens a fresh one.
 */

export interface TunnelTarget {
  host: string
  port: number
  ssh?: string
}

interface Tunnel {
  port: number
  child: ChildProcess
}

const g = globalThis as unknown as { __sshTunnels?: Map<string, Promise<Tunnel>> }

function tunnels(): Map<string, Promise<Tunnel>> {
  return (g.__sshTunnels ??= new Map())
}

const READY_TIMEOUT_MS = 15_000

export function tunnelKey(target: TunnelTarget): string {
  return `${target.ssh ?? ''}|${target.host}:${target.port}`
}

export function sshTunnelArgs(
  destination: string,
  localPort: number,
  remoteHost: string,
  remotePort: number,
): string[] {
  if (!destination || destination.startsWith('-') || /\s/.test(destination)) {
    throw new Error(`Not an ssh destination: "${destination}"`)
  }
  return [
    '-N',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    '-L', `127.0.0.1:${localPort}:${remoteHost}:${remotePort}`,
    destination,
  ]
}

/** Where to point Postgres for this target: itself, or the loopback end of its tunnel. */
export async function endpointFor(target: TunnelTarget): Promise<{ host: string; port: number }> {
  if (!target.ssh) return { host: target.host, port: target.port }
  const key = tunnelKey(target)
  let open = tunnels().get(key)
  if (!open) {
    open = openTunnel(target.ssh, target.host, target.port, () => {
      if (tunnels().get(key) === open) tunnels().delete(key)
    })
    tunnels().set(key, open)
    open.catch(() => {
      if (tunnels().get(key) === open) tunnels().delete(key)
    })
  }
  const tunnel = await open
  return { host: '127.0.0.1', port: tunnel.port }
}

/** Close every tunnel — on disconnect, or when the credentials change under them. */
export async function closeTunnels(): Promise<void> {
  const open = [...tunnels().values()]
  tunnels().clear()
  await Promise.all(open.map((t) => t.then((tunnel) => tunnel.child.kill()).catch(() => {})))
}

async function openTunnel(
  destination: string,
  remoteHost: string,
  remotePort: number,
  onExit: () => void,
): Promise<Tunnel> {
  const port = await freePort()
  const child = spawn('ssh', sshTunnelArgs(destination, port, remoteHost, remotePort), {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-2000)
  })
  let exited = false
  child.on('exit', () => {
    exited = true
    onExit()
  })
  child.on('error', () => {
    exited = true
  })

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exited) throw new Error(`SSH tunnel to ${destination} failed: ${stderr.trim() || 'ssh exited'}`)
    if (await accepts(port)) return { port, child }
    await new Promise((r) => setTimeout(r, 150))
  }
  child.kill()
  throw new Error(`SSH tunnel to ${destination} did not open within ${READY_TIMEOUT_MS / 1000}s`)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })
}

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
  })
}
