import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PatientDevices from '.'

vi.mock('../../api/patient', () => ({
  getDevices: vi.fn(),
  syncDevice: vi.fn(),
  setDeviceConnected: vi.fn(),
  connectDevice: vi.fn(),
}))
const api = await import('../../api/patient')

const DEVICE = {
  id: 1, kind: 'glucometer', name: 'Глюкометр', model: '[модель глюкометра]',
  connected: true, lastSync: '2026-11-25T18:56:00+03:00',
}
const DATA = { devices: [DEVICE], options: [{ kind: 'glucometer', label: 'Глюкометр' }] }

function renderDevices() {
  render(
    <MemoryRouter>
      <PatientDevices />
    </MemoryRouter>,
  )
}

describe('PatientDevices', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.getDevices.mockResolvedValue(DATA)
  })

  it('синхронизирует и отключает устройство', async () => {
    api.syncDevice.mockResolvedValue({ device: DEVICE })
    api.setDeviceConnected.mockResolvedValue({ device: { ...DEVICE, connected: false } })
    renderDevices()

    expect(await screen.findByText('[модель глюкометра]')).toBeInTheDocument()
    expect(screen.getByText('подключён')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Синхронизировать' }))
    expect(api.syncDevice).toHaveBeenCalledWith(1)

    await userEvent.click(screen.getByRole('button', { name: 'Отключить' }))
    expect(api.setDeviceConnected).toHaveBeenCalledWith(1, false)
    expect(api.getDevices).toHaveBeenCalledTimes(3)
  })

  it('подключает устройство через мастер', async () => {
    api.getDevices.mockResolvedValue({ devices: [], options: [{ kind: 'glucometer', label: 'Глюкометр' }] })
    api.connectDevice.mockResolvedValue({ device: DEVICE })
    renderDevices()

    await userEvent.click(await screen.findByRole('button', { name: 'Подключить глюкометр' }))
    expect(screen.getByText('Включите Bluetooth на телефоне.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Найти' }))
    expect(api.connectDevice).toHaveBeenCalledWith('glucometer')
  })
})
