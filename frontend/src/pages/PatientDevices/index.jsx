import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { connectDevice, getDevices, setDeviceConnected, syncDevice } from '../../api/patient'
import Button from '../../components/Button'
import FormError from '../../components/FormError'
import { formatDayTime } from '../../utils/format'
import './style.css'

// Устройства: состояние, синхронизация и подключение нового
function PatientDevices() {
  const [data, setData] = useState(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const load = useCallback(() => {
    return getDevices()
      .then((payload) => {
        setData(payload)
        setError('')
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function act(action) {
    setPending(true)
    setError('')
    try {
      await action()
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  if (!data) {
    return (
      <div className="patient-page devices">
        {error ? <FormError>{error}</FormError> : <p className="patient-hint">Загружаем устройства…</p>}
      </div>
    )
  }

  const option = data.options[0]
  const device = data.devices.find((item) => item.kind === option.kind)

  return (
    <div className="patient-page devices">
      <Link to="/patient/profile" className="devices__back">← Профиль</Link>
      <h1>Устройства</h1>
      <FormError>{error}</FormError>

      <section className="patient-section" aria-labelledby="devices-title">
        <h2 id="devices-title">{option.label}</h2>

        {device ? (
          <>
            <div className="devices__row"><span>Модель</span><span>{device.model}</span></div>
            <div className="devices__row">
              <span>Состояние</span>
              <span className={device.connected ? '' : 'devices__state--off'}>
                {device.connected ? 'подключён' : 'отключён'}
              </span>
            </div>
            <div className="devices__row">
              <span>Синхронизация</span>
              <span className="num">{device.lastSync ? formatDayTime(device.lastSync) : 'ещё не синхронизирован'}</span>
            </div>

            {device.connected ? (
              <div className="devices__actions">
                <Button
                  variant="primary"
                  size="md"
                  disabled={pending}
                  onClick={() => act(() => syncDevice(device.id))}
                >
                  Синхронизировать
                </Button>
                <Button
                  size="md"
                  disabled={pending}
                  onClick={() => act(() => setDeviceConnected(device.id, false))}
                >
                  Отключить
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                size="md"
                disabled={pending}
                onClick={() => act(() => setDeviceConnected(device.id, true))}
              >
                Подключить снова
              </Button>
            )}
          </>
        ) : (
          <>
            <p className="patient-hint">
              Не подключён. Подключите, если врач назначил контроль показателя. Без устройства показатели можно
              вносить вручную.
            </p>

            {step === 0 && (
              <Button size="md" onClick={() => setStep(1)}>Подключить {option.label.toLowerCase()}</Button>
            )}

            {step === 1 && (
              <div className="devices__wizard">
                <ol className="devices__steps">
                  <li>Включите Bluetooth на телефоне.</li>
                  <li>Зажмите кнопку Bluetooth на устройстве на 3 секунды.</li>
                  <li>Положите устройство рядом с телефоном.</li>
                </ol>
                <div className="devices__actions">
                  <Button size="md" onClick={() => setStep(0)}>Отмена</Button>
                  <Button
                    variant="primary"
                    size="md"
                    disabled={pending}
                    onClick={() => {
                      act(() => connectDevice(option.kind))
                      setStep(0)
                    }}
                  >
                    Найти
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <p className="patient-hint">
        Поддерживаются модели, согласованные с клиникой. Данные передаются в зашифрованном виде и хранятся
        на серверах в РФ.
      </p>
    </div>
  )
}

export default PatientDevices
