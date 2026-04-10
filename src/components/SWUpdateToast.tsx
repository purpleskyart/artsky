import { useState } from 'react'
import { useSWUpdate } from '../hooks/useSWUpdate'
import styles from './SWUpdateToast.module.css'

export default function SWUpdateToast() {
  const { needRefresh, updateServiceWorker, close } = useSWUpdate()
  const [updateError, setUpdateError] = useState<string | null>(null)

  if (!needRefresh) return null

  const handleUpdate = async () => {
    try {
      await updateServiceWorker(true)
      window.location.reload()
    } catch (err) {
      console.error('Service worker update failed:', err)
      setUpdateError('Failed to update. Please try again.')
    }
  }

  return (
    <div className={`sw-update-toast ${styles.toast}`} role="alert" aria-live="polite">
      <span className={styles.message}>Update available</span>
      {updateError && (
        <p className={styles.error} style={{ margin: '0.5rem 0 0', color: '#ff4444', fontSize: '0.85rem' }}>
          {updateError}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.updateBtn}
          onClick={handleUpdate}
        >
          Update
        </button>
        <button type="button" className={styles.dismissBtn} onClick={close}>
          Later
        </button>
      </div>
    </div>
  )
}
