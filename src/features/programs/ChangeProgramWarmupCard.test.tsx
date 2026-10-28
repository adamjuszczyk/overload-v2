// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { captureRender } from '../../testing/captureRender'
import ChangeProgramWarmupCard, { splitDose, type ChangeProgramWarmupCardProps } from './ChangeProgramWarmupCard'

// Chunk 51a: the warmup routine card (boards PL1 "WARMUP ROUTINE", PL8 the remove confirm, PL9 "EDITING AN ITEM / TAPPED AN ITEM / ADDING
// AN ITEM / NO ITEMS"). The card writes nothing: each action asks a callback, which is what these read.

afterEach(() => cleanup())

const ITEMS = [
  { id: 'r1', key: 'r:r1', body: 'Band pull-aparts, 2 × 15' },
  { id: 'r2', key: 'r:r2', body: 'Dead hang, 30 s' },
]

function props(over: Partial<ChangeProgramWarmupCardProps> = {}): ChangeProgramWarmupCardProps {
  return { number: 1, items: ITEMS, everyText: 'EVERY WEEK', everyWord: 'week', onAdd: vi.fn(), onEdit: vi.fn(), onMove: vi.fn(), onRemove: vi.fn(), ...over }
}

describe('splitDose', () => {
  it('splits at the last comma: the name, and the dose PL1 draws apart', () => {
    expect(splitDose('Dead hang, 30 s')).toEqual({ name: 'Dead hang', dose: '30 s' })
    expect(splitDose('Hip circles, both sides, 10 each')).toEqual({ name: 'Hip circles, both sides', dose: '10 each' })
  })
  it('a body with no comma is a name alone', () => {
    expect(splitDose('5 min easy bike')).toEqual({ name: '5 min easy bike', dose: null })
  })
})

describe('the card', () => {
  it('PL1: numbered, says it is every week, and draws each item as a name and a dose', () => {
    render(<ChangeProgramWarmupCard {...props({ number: 2 })} />)
    expect(screen.getByText('2 · WARMUP ROUTINE')).toBeTruthy()
    expect(screen.getByText('EVERY WEEK')).toBeTruthy()
    expect(screen.getByText('Band pull-aparts')).toBeTruthy()
    expect(screen.getByText('2 × 15')).toBeTruthy()
    expect(screen.getByText('Dead hang')).toBeTruthy()
    expect(screen.getByText('30 s')).toBeTruthy()
  })

  it('a sequence run says EVERY CYCLE', () => {
    render(<ChangeProgramWarmupCard {...props({ everyText: 'EVERY CYCLE', everyWord: 'cycle' })} />)
    expect(screen.getByText('EVERY CYCLE')).toBeTruthy()
  })

  it('PL9 NO ITEMS: only + ADD ITEM, no placeholder (the standing UI rule)', () => {
    render(<ChangeProgramWarmupCard {...props({ items: [] })} />)
    expect(screen.getByRole('button', { name: '+ ADD ITEM' })).toBeTruthy()
    expect(screen.queryByText(/no warmup/i)).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('PL9 EDITING AN ITEM', () => {
  it('tapping the text opens it in a field holding the whole body; Enter commits it', () => {
    const p = props()
    render(<ChangeProgramWarmupCard {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Band pull-aparts, 2 × 15' }))
    const box = screen.getByLabelText('Warmup item') as HTMLInputElement
    expect(box.value).toBe('Band pull-aparts, 2 × 15')
    fireEvent.change(box, { target: { value: 'Band pull-aparts, 2 × 20' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(p.onEdit).toHaveBeenCalledWith('r:r1', 'Band pull-aparts, 2 × 20')
    expect(screen.queryByLabelText('Warmup item')).toBeNull()
  })

  it('leaving the field commits it; Escape does not', () => {
    const p = props()
    render(<ChangeProgramWarmupCard {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Dead hang, 30 s' }))
    fireEvent.change(screen.getByLabelText('Warmup item'), { target: { value: 'Dead hang, 45 s' } })
    fireEvent.blur(screen.getByLabelText('Warmup item'))
    expect(p.onEdit).toHaveBeenCalledWith('r:r2', 'Dead hang, 45 s')
    cleanup()
    const q = props()
    render(<ChangeProgramWarmupCard {...q} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Dead hang, 30 s' }))
    fireEvent.change(screen.getByLabelText('Warmup item'), { target: { value: 'Dead hang, 45 s' } })
    fireEvent.keyDown(screen.getByLabelText('Warmup item'), { key: 'Escape' })
    expect(q.onEdit).not.toHaveBeenCalled()
    expect(screen.getByText('Dead hang')).toBeTruthy()
  })

  it('a blank text and an unchanged one write nothing', () => {
    const p = props()
    render(<ChangeProgramWarmupCard {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Dead hang, 30 s' }))
    fireEvent.change(screen.getByLabelText('Warmup item'), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByLabelText('Warmup item'), { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Dead hang, 30 s' }))
    fireEvent.keyDown(screen.getByLabelText('Warmup item'), { key: 'Enter' })
    expect(p.onEdit).not.toHaveBeenCalled()
  })
})

describe('PL9 TAPPED AN ITEM', () => {
  it('the ⋯ opens MOVE UP / MOVE DOWN / REMOVE under the item and highlights it; the first can’t go up, the last can’t go down', () => {
    const p = props()
    render(<ChangeProgramWarmupCard {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Band pull-aparts, 2 × 15: options' }))
    expect((screen.getByRole('button', { name: 'MOVE UP' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'MOVE DOWN' }))
    expect(p.onMove).toHaveBeenCalledWith('r:r1', 'down')
    fireEvent.click(screen.getByRole('button', { name: 'Band pull-aparts, 2 × 15: options' })) // closes
    expect(screen.queryByRole('button', { name: 'MOVE UP' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dead hang, 30 s: options' }))
    expect((screen.getByRole('button', { name: 'MOVE DOWN' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'MOVE UP' }))
    expect(p.onMove).toHaveBeenLastCalledWith('r:r2', 'up')
  })

  it('PL8: REMOVE asks first, with the item’s words; CANCEL keeps it, REMOVE removes it', () => {
    const p = props()
    render(<ChangeProgramWarmupCard {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dead hang, 30 s: options' }))
    fireEvent.click(screen.getByRole('button', { name: 'REMOVE' }))
    expect(p.onRemove).not.toHaveBeenCalled()
    const title = screen.getByText('Remove this item?')
    expect(screen.getByText('"Dead hang, 30 s" leaves the routine for every week. This can\'t be undone.')).toBeTruthy()
    fireEvent.click(within(title.parentElement!).getByRole('button', { name: 'CANCEL' }))
    expect(p.onRemove).not.toHaveBeenCalled()
    expect(screen.queryByText('Remove this item?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Dead hang, 30 s: options' }))
    fireEvent.click(screen.getByRole('button', { name: 'REMOVE' }))
    fireEvent.click(within(screen.getByText('Remove this item?').parentElement!).getByRole('button', { name: 'REMOVE' }))
    expect(p.onRemove).toHaveBeenCalledWith('r:r2')
  })

  it('a sequence run’s confirm says "every cycle"', () => {
    render(<ChangeProgramWarmupCard {...props({ everyWord: 'cycle' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dead hang, 30 s: options' }))
    fireEvent.click(screen.getByRole('button', { name: 'REMOVE' }))
    expect(screen.getByText(/leaves the routine for every cycle\./)).toBeTruthy()
  })
})

describe('PL9 ADDING AN ITEM', () => {
  it('+ ADD ITEM opens a field with the board’s hint and an ADD button, which is off until there is text', () => {
    const p = props()
    render(<ChangeProgramWarmupCard {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '+ ADD ITEM' }))
    const box = screen.getByLabelText('New warmup item') as HTMLInputElement
    expect(box.placeholder).toBe('e.g. 5 min easy bike')
    expect((screen.getByRole('button', { name: 'ADD' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(box, { target: { value: '  5 min easy bike ' } })
    fireEvent.click(screen.getByRole('button', { name: 'ADD' }))
    expect(p.onAdd).toHaveBeenCalledWith('5 min easy bike')
    expect(screen.queryByLabelText('New warmup item')).toBeNull()
  })

  it('Enter adds, Escape closes without adding', () => {
    const p = props()
    render(<ChangeProgramWarmupCard {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '+ ADD ITEM' }))
    fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: 'Cat-cow' } })
    fireEvent.keyDown(screen.getByLabelText('New warmup item'), { key: 'Enter' })
    expect(p.onAdd).toHaveBeenCalledWith('Cat-cow')
    fireEvent.click(screen.getByRole('button', { name: '+ ADD ITEM' }))
    fireEvent.change(screen.getByLabelText('New warmup item'), { target: { value: 'Never' } })
    fireEvent.keyDown(screen.getByLabelText('New warmup item'), { key: 'Escape' })
    expect(p.onAdd).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('New warmup item')).toBeNull()
  })
})

describe('draws PL9’s four routine states, one under another', () => {
  it('editing an item, a tapped item, adding an item, no items', () => {
    const states = ['EDITING AN ITEM', 'TAPPED AN ITEM', 'ADDING AN ITEM', 'NO ITEMS']
    const { container } = render(
      <div>
        {states.map((label) => (
          <section key={label} aria-label={label}>
            <p>WARMUP ROUTINE · {label}</p>
            <ChangeProgramWarmupCard {...props({ items: label === 'NO ITEMS' ? [] : ITEMS })} />
          </section>
        ))}
      </div>,
    )
    const section = (label: string) => within(container.querySelector(`[aria-label="${label}"]`) as HTMLElement)
    fireEvent.click(section('EDITING AN ITEM').getByRole('button', { name: 'Edit Band pull-aparts, 2 × 15' }))
    fireEvent.click(section('TAPPED AN ITEM').getByRole('button', { name: 'Dead hang, 30 s: options' }))
    fireEvent.click(section('ADDING AN ITEM').getByRole('button', { name: '+ ADD ITEM' }))
    captureRender('change-program-warmup-states', container)
  })
})
