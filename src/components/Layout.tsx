import { useState, useRef, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import { useViewMode } from '../context/ViewModeContext'
import SearchBar from './SearchBar'
import styles from './Layout.module.css'

interface Props {
  title: string
  children: React.ReactNode
  showNav?: boolean
}

export default function Layout({ title, children, showNav }: Props) {
  const loc = useLocation()
  const navigate = useNavigate()
  const { session, logout } = useSession()
  const path = loc.pathname
  const { viewMode, toggleViewMode } = useViewMode()
  const [accountOpen, setAccountOpen] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!accountOpen) return
    function onDocClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false)
      }
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [accountOpen])

  function handleSwitchAccount() {
    setAccountOpen(false)
    logout()
    navigate('/login', { replace: true })
    window.location.reload()
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        {showNav && (
          <Link to="/feed" className={styles.logoLink} aria-label="ArtSky – back to feed">
            <img src={`${import.meta.env.BASE_URL || '/'}icon.svg`} alt="" className={styles.logoIcon} />
            <span className={styles.logoText}>ArtSky</span>
          </Link>
        )}
        {showNav && (
          <div className={styles.searchSlot}>
            <SearchBar />
          </div>
        )}
        <h1 className={styles.title}>{title}</h1>
        {showNav && (
          <button
            type="button"
            className={styles.viewModeBtn}
            onClick={toggleViewMode}
            title={viewMode === 'compact' ? 'Switch to larger previews' : 'Switch to more columns'}
          >
            {viewMode === 'compact' ? 'Large view' : 'Compact view'}
          </button>
        )}
        {showNav && session && (
          <div className={styles.accountWrap} ref={accountRef}>
            <button
              type="button"
              className={styles.accountBtn}
              onClick={() => setAccountOpen((o) => !o)}
              aria-expanded={accountOpen}
              aria-haspopup="true"
              title="Account"
            >
              Account
            </button>
            {accountOpen && (
              <div className={styles.accountDropdown}>
                <p className={styles.accountUser}>@{session.handle}</p>
                <button type="button" className={styles.accountSwitch} onClick={handleSwitchAccount}>
                  Switch account
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      <main className={styles.main}>
        {children}
      </main>
      {showNav && (
        <nav className={styles.nav} aria-label="Main">
          <Link
            to="/feed"
            className={path === '/feed' ? styles.navActive : ''}
            aria-current={path === '/feed' ? 'page' : undefined}
          >
            Feed
          </Link>
          <Link
            to="/artboards"
            className={path === '/artboards' ? styles.navActive : ''}
            aria-current={path === '/artboards' ? 'page' : undefined}
          >
            Artboards
          </Link>
        </nav>
      )}
    </div>
  )
}
