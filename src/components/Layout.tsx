import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
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

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
    window.location.reload()
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        {showNav && (
          <Link to="/feed" className={styles.logoLink} aria-label="artsky – back to feed">
            <img src={`${import.meta.env.BASE_URL || '/'}icon.svg`} alt="" className={styles.logoIcon} />
            <span className={styles.logoText}>artsky</span>
          </Link>
        )}
        <h1 className={styles.title}>{title}</h1>
        {showNav && session && (
          <button type="button" className={styles.logout} onClick={handleLogout} title="Sign out">
            Sign out
          </button>
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
