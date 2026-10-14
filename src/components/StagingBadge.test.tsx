// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import StagingBadge from './StagingBadge'

afterEach(cleanup)

describe('StagingBadge', () => {
  it('shows STAGING on a staging build', () => {
    render(<StagingBadge show />)
    expect(screen.getByRole('status', { name: 'Staging app' }).textContent).toBe('STAGING')
  })
  it('renders nothing in the real app', () => {
    const { container } = render(<StagingBadge show={false} />)
    expect(container.innerHTML).toBe('')
  })
  it('is off in the test build, where VITE_APP_ENV is unset', () => {
    const { container } = render(<StagingBadge />)
    expect(container.innerHTML).toBe('')
  })
})
