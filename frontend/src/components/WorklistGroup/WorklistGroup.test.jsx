import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import WorklistGroup from '.'

describe('WorklistGroup', () => {
  it('сворачивается кнопкой с aria-expanded', async () => {
    const onToggle = vi.fn()
    const { rerender } = render(
      <WorklistGroup level="crit" label="Критично" count={2} open onToggle={onToggle}>
        <p>Ковалёва</p>
      </WorklistGroup>,
    )
    const button = screen.getByRole('button', { name: /Критично/ })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Ковалёва')).toBeVisible()

    await userEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()

    rerender(
      <WorklistGroup level="crit" label="Критично" count={2} open={false} onToggle={onToggle}>
        <p>Ковалёва</p>
      </WorklistGroup>,
    )
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('Ковалёва')).not.toBeVisible()
  })
})
