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
  const onConnect = vi.fn().mockResolvedValue(undefined)
  render(
    <ConnectionForm
      onConnect={onConnect}
      isLoading={false}
      error={null}
      presets={presets}
      onSavePreset={onSavePreset}
      onDeletePreset={onDeletePreset}
    />,
  )
  return { onSavePreset, onDeletePreset, onConnect }
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

/**
 * A preset is a connection you keep, so the form is also where you correct one.
 * Editing a chip's fields used to silently detach it: the next save asked for a
 * name, defaulted to `user@host`, and left the original untouched — which is how
 * a presets file ends up holding two entries for the same server.
 */
describe('ConnectionForm preset editing', () => {
  it('keeps the preset selected while its fields are edited', () => {
    setup()

    fireEvent.click(button('Local Postgres'))
    fireEvent.change(field('Database'), { target: { value: 'example_scratch' } })

    expect(screen.getByText(/unsaved changes/i)).toBeTruthy()
  })

  it('saves an edit back over the preset it came from', async () => {
    const { onSavePreset } = setup()

    fireEvent.click(button('Local Postgres'))
    fireEvent.change(field('Database'), { target: { value: 'example_scratch' } })
    fireEvent.click(button(/save changes/i))

    await waitFor(() =>
      expect(onSavePreset).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Local Postgres', database: 'example_scratch' }),
      ),
    )
  })

  it('puts the preset back as it was saved when the edit is reverted', () => {
    setup()

    fireEvent.click(button('Local Postgres'))
    fireEvent.change(field('Database'), { target: { value: 'example_scratch' } })
    fireEvent.click(button(/revert/i))

    expect(field('Database').value).toBe('example_local')
    expect(screen.queryByText(/unsaved changes/i)).toBeNull()
  })

  it('offers the edit as a new preset too, named for the connection', () => {
    setup()

    fireEvent.click(button('Local Postgres'))
    fireEvent.change(field('Host'), { target: { value: 'staging.internal' } })
    fireEvent.click(button(/save as new/i))

    expect(field('Preset name').value).toBe('postgres@staging.internal')
  })

  it('renames a preset by saving it under the new name and forgetting the old', async () => {
    const { onSavePreset, onDeletePreset } = setup()

    fireEvent.click(button(/rename Local Postgres/i))
    fireEvent.change(field('New name for Local Postgres'), { target: { value: 'Dev Postgres' } })
    fireEvent.click(button(/^rename$/i))

    await waitFor(() =>
      expect(onSavePreset).toHaveBeenCalledWith(expect.objectContaining({ name: 'Dev Postgres' })),
    )
    expect(onDeletePreset).toHaveBeenCalledWith('Local Postgres')
  })

  it('connects an unchanged preset as that preset', async () => {
    const { onConnect } = setup()

    fireEvent.click(button('Local Postgres'))
    fireEvent.click(button(/^connect$/i))

    await waitFor(() =>
      expect(onConnect).toHaveBeenCalledWith(expect.anything(), 'Local Postgres'),
    )
  })

  // The session is labelled with the preset name, and an edited connection is
  // not that preset until it is saved.
  it('connects an edited preset as an ad-hoc connection', async () => {
    const { onConnect } = setup()

    fireEvent.click(button('Local Postgres'))
    fireEvent.change(field('Database'), { target: { value: 'example_scratch' } })
    fireEvent.click(button(/^connect$/i))

    await waitFor(() => expect(onConnect).toHaveBeenCalledWith(expect.anything(), undefined))
  })
})
