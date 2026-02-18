import { useSWUpdate } from '../hooks/useSWUpdate'
import styles from './SWUpdateToast.module.css'

export default function SWUpdateToast() {
  const { needRefresh, offlineReady, updateServiceWorker, close } = useSWUpdate()

  if (!needRefresh && !offlineReady) return null

  return (
    <div className={`sw-update-toast ${styles.toast}`} role="alert" aria-live="polite">
      <span className={styles.message}>
        {needRefresh ? 'Update available' : 'App ready for offline use'}
      </span>
      <div className={styles.actions}>
        {needRefresh && (
          <button
            type="button"
            className={styles.updateBtn}
            onClick={() => updateServiceWorker(true)}
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
