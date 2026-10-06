import { describe, expect, it } from 'vitest'
import { sshTunnelArgs, tunnelKey } from '#/server/ssh-tunnel'

describe('ssh tunnel', () => {
  it('forwards a loopback port to the database as the ssh server sees it, never prompting', () => {
    expect(sshTunnelArgs('root@10.0.0.5', 41000, '127.0.0.1', 7431)).toEqual([
      '-N',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=30',
      '-L', '127.0.0.1:41000:127.0.0.1:7431',
      'root@10.0.0.5',
    ])
  })

  it('refuses a destination that ssh would read as an option', () => {
    expect(() => sshTunnelArgs('-oProxyCommand=x', 1, 'h', 1)).toThrow(/destination/)
  })

  it('shares one tunnel per destination and target', () => {
    const a = { host: '127.0.0.1', port: 7431, ssh: 'htr' }
    expect(tunnelKey(a)).toBe(tunnelKey({ ...a }))
    expect(tunnelKey(a)).not.toBe(tunnelKey({ ...a, port: 5432 }))
    expect(tunnelKey(a)).not.toBe(tunnelKey({ ...a, ssh: 'other' }))
  })
})
