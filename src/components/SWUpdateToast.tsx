import { useState } from 'react'
import { useSWUpdate } from '../hooks/useSWUpdate'
import styles from './SWUpdateToast.module.css'

export default function SWUpdateToast() {
  const { needRefresh, offlineReady, updateServiceWorker, close } = useSWUpdate()
  const [updateError, setUpdateError] = useState<string | null>(null)

  if (!needRefresh && !offlineReady) return null

  const handleUpdate = async () => {
    try {
      await updateServiceWorker(true)
      close()
    } catch (err) {
      console.error('Service worker update failed:', err)
      setUpdateError('Failed to update. Please try again.')
    }
  }

  return (
    <div className={`sw-update-toast ${styles.toast}`} role="alert" aria-live="polite">
      <span className={styles.message}>
        {needRefresh ? 'Update available' : 'App ready for offline use'}
      </span>
      {updateError && (
        <p className={styles.error} style={{ margin: '0.5rem 0 0', color: '#ff4444', fontSize: '0.85rem' }}>
          {updateError}
        </p>
      )}
      <div className={styles.actions}>
        {needRefresh && (
          <button
            type="button"
            className={styles.updateBtn}
            onClick={handleUpdate}
          >
            Update
          </button>
        )}
        <button
          type="button"
          className={styles.dismissBtn}
          onClick={close}
        >
          {needRefresh ? 'Later' : 'Dismiss'}
        </button>
      </div>
    </div>
  )
}
