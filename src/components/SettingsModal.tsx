import { useCallback, useEffect, useState } from 'react'
import {
  getTotalStorageUsage,
  clearImageCache,
  clearLocalData,
  formatBytes,
  type CacheUsage,
} from '../lib/storageUtils'
import styles from './Layout.module.css'

interface Props {
  onClose: () => void
  showToast: (msg: string) => void
  onLocalDataCleared?: () => void
}

export default function SettingsModal({ onClose, showToast, onLocalDataCleared }: Props) {
  const [loading, setLoading] = useState(true)
  const [storage, setStorage] = useState<{
    localStorageBytes: number
    cacheBytes: number
    cacheBreakdown: CacheUsage[]
  } | null>(null)
  const [clearing, setClearing] = useState<'image' | 'local' | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [localDataConfirm, setLocalDataConfirm] = useState(false)

  const refreshStorage = useCallback(async () => {
    setLoading(true)
    try {
      const s = await getTotalStorageUsage()
      setStorage(s)
    } catch {
      setStorage({ localStorageBytes: 0, cacheBytes: 0, cacheBreakdown: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshStorage()
  }, [refreshStorage])

  const handleClearImageCache = async () => {
    setClearing('image')
    try {
      await clearImageCache()
      await refreshStorage()
      showToast('Image cache cleared')
    } catch {
      showToast('Could not clear image cache')
    } finally {
      setClearing(null)
    }
  }

  const handleClearLocalData = async () => {
    if (!localDataConfirm) {
      setLocalDataConfirm(true)
      return
    }
    setClearing('local')
    try {
      clearLocalData()
      showToast('Local data cleared')
      onLocalDataCleared?.()
      onClose()
      window.location.reload()
    } catch {
      showToast('Could not clear local data')
    } finally {
      setClearing(null)
    }
  }

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true)
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      if (!reg) {
        showToast('Service worker not active')
        return
      }
      await reg.update()
      if (reg.waiting) {
        showToast('Update available. Refresh to apply.')
      } else {
        showToast('You\'re up to date')
      }
    } catch {
      showToast('Could not check for updates')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const totalBytes = storage
    ? storage.localStorageBytes + storage.cacheBytes
    : 0

  const imageCache = storage?.cacheBreakdown.find(
    (c) => c.name === 'artsky-images'
  )

  return (
    <>
      <div
        className={styles.searchOverlayBackdrop}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={styles.settingsOverlay}
        role="dialog"
        aria-label="Storage & Cache"
        onClick={onClose}
      >
        <div
          className={styles.settingsCard}
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className={styles.settingsTitle}>Storage & Cache</h2>

          <section className={styles.settingsSection}>
            <h3 className={styles.settingsSubtitle}>Storage usage</h3>
            {loading ? (
              <p className={styles.settingsMuted}>Loading…</p>
            ) : storage ? (
              <>
                <p className={styles.settingsUsage}>
                  <strong>Total:</strong>{' '}
                  {formatBytes(totalBytes)}
                </p>
                <ul className={styles.settingsBreakdown}>
                  <li>
                    App data (settings, artboards, sessions):{' '}
                    {formatBytes(storage.localStorageBytes)}
                  </li>
                  {storage.cacheBreakdown.map((c) => (
                    <li key={c.name}>
                      {c.name === 'artsky-images'
                        ? 'Image cache'
                        : c.name}:{' '}
                      {formatBytes(c.bytes)} ({c.entries} items)
                    </li>
                  ))}
                  {storage.cacheBreakdown.length === 0 && (
                    <li className={styles.settingsMuted}>
                      No cache data
                    </li>
                  )}
                </ul>
              </>
            ) : null}
          </section>

          <section className={styles.settingsSection}>
            <h3 className={styles.settingsSubtitle}>Actions</h3>
            <div className={styles.settingsActions}>
              <button
                type="button"
                className={styles.settingsActionBtn}
                onClick={handleClearImageCache}
                disabled={clearing !== null || !imageCache?.bytes}
                title="Clear cached Bluesky images"
              >
                {clearing === 'image' ? 'Clearing…' : 'Clear image cache'}
              </button>
              <button
                type="button"
                className={`${styles.settingsActionBtn} ${styles.settingsActionBtnDanger}`}
                onClick={handleClearLocalData}
                disabled={clearing !== null}
                title="Clear all local data including artboards, drafts, and sessions. You will be logged out."
              >
                {clearing === 'local'
                  ? 'Clearing…'
                  : localDataConfirm
                    ? 'Yes, clear everything'
                    : 'Clear local data'}
              </button>
              {localDataConfirm && (
                <button
                  type="button"
                  className={styles.settingsActionBtn}
                  onClick={() => setLocalDataConfirm(false)}
                >
                  Cancel
                </button>
              )}
            </div>
          </section>

          <section className={styles.settingsSection}>
            <h3 className={styles.settingsSubtitle}>App updates</h3>
            <button
              type="button"
              className={styles.settingsActionBtn}
              onClick={handleCheckUpdates}
              disabled={checkingUpdate || !('serviceWorker' in navigator)}
              title="Check for a new version of ArtSky"
            >
              {checkingUpdate ? 'Checking…' : 'Check for updates'}
            </button>
          </section>

          <button
            type="button"
            className={styles.aboutClose}
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>
      </div>
    </>
  )
}
