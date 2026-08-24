// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConnectionForm from '#/components/ConnectionForm'
import type { ConnectionPreset } from '#/lib/types'

/**
 * The form is where the credentials already are, so it is also where they are
 * saved and forgotten. Removing one is a destructive act on a secret that may
 * not be written down anywhere else — it asks first.
 */
const local: ConnectionPreset = {
  name: 'Local Postgres',
  host: '127.0.0.1',
  port: 5432,
  database: 'example_local',
  user: 'postgres',
  password: 'secret',
}

function setup(presets: ConnectionPreset[] = [local]) {
  const onSavePreset = vi.fn().mockResolvedValue(undefined)
  const onDeletePreset = vi.fn().mockResolvedValue(undefined)
  render(
    <ConnectionForm
      onConnect={vi.fn().mockResolvedValue(undefined)}
      isLoading={false}
      error={null}
      presets={presets}
      onSavePreset={onSavePreset}
      onDeletePreset={onDeletePreset}
    />,
  )
  return { onSavePreset, onDeletePreset }
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const button = (name: RegExp | string) => screen.getByRole('button', { name })

afterEach(cleanup)

describe('ConnectionForm preset management', () => {
  it('saves the values in the form under the name given', async () => {
    const { onSavePreset } = setup([])

    fireEvent.change(field('Database'), { target: { value: 'scratch' } })
    fireEvent.click(button(/save current/i))
    fireEvent.change(field('Preset name'), { target: { value: 'Scratch' } })
    fireEvent.click(button('Save'))

    await waitFor(() =>
      expect(onSavePreset).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Scratch', database: 'scratch' }),
      ),
    )
  })

  it('suggests a name from the connection rather than leaving it blank', () => {
    setup([])
    fireEvent.click(button(/save current/i))
    expect(field('Preset name').value).toBe('postgres@localhost')
  })

  it('asks before forgetting a preset', async () => {
    const { onDeletePreset } = setup()

    fireEvent.click(button(/remove Local Postgres/i))
    expect(onDeletePreset).not.toHaveBeenCalled()

    fireEvent.click(button(/^forget$/i))
    await waitFor(() => expect(onDeletePreset).toHaveBeenCalledWith('Local Postgres'))
  })

  it('keeps the preset when the removal is called off', () => {
    const { onDeletePreset } = setup()

    fireEvent.click(button(/remove Local Postgres/i))
    fireEvent.click(button(/cancel/i))

    expect(onDeletePreset).not.toHaveBeenCalled()
    expect(button('Local Postgres')).toBeTruthy()
  })

  it('applies a preset to the fields when its chip is clicked', () => {
    setup([local, { ...local, name: 'Staging', database: 'staging_db' }])

    fireEvent.click(button('Staging'))

    expect(field('Database').value).toBe('staging_db')
  })
})
