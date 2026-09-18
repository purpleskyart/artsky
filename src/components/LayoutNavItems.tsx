import { memo, type MouseEvent, type RefObject } from 'react'
import { resizedAvatarUrl } from '../lib/imageUtils'
import styles from './Layout.module.css'

function HomeIcon({ active }: { active?: boolean }) {
  if (active) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 12h6v10H9z"
        />
      </svg>
    )
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function SearchIcon({ active }: { active?: boolean }) {
  const sw = active ? 2.5 : 2
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

function CollectionsBookmarkNavIcon({ active }: { active?: boolean }) {
  const sw = active ? 2.5 : 2
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      {active ? (
        <path fill="currentColor" d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z" />
      ) : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2v16z"
        />
      )}
    </svg>
  )
}

function AccountIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

interface LayoutNavItemsProps {
  isDesktop: boolean
  homeActive: boolean
  searchActive: boolean
  collectionsActive: boolean
  currentAccountAvatar?: string | null
  accountBtnRef: RefObject<HTMLButtonElement | null>
  startHomeHold: () => void
  endHomeHold: () => void
  homeBtnClick: (e: MouseEvent) => void
  openCompose: () => void
  focusSearch: () => void
  handleCollectionsNavClick: () => void
  accountBtnClick: () => void
  accountMenuOpen: boolean
}

const LayoutNavItems = memo(function LayoutNavItems({
  isDesktop,
  homeActive,
  searchActive,
  collectionsActive,
  currentAccountAvatar,
  accountBtnRef,
  startHomeHold,
  endHomeHold,
  homeBtnClick,
  openCompose,
  focusSearch,
  handleCollectionsNavClick,
  accountBtnClick,
  accountMenuOpen,
}: LayoutNavItemsProps) {
  const navTrayItems = (
    <>
      <button
        type="button"
        className={homeActive ? styles.navActive : ''}
        aria-current={homeActive ? 'page' : undefined}
        onPointerDown={startHomeHold}
        onPointerUp={endHomeHold}
        onPointerLeave={endHomeHold}
        onPointerCancel={endHomeHold}
        onClick={homeBtnClick}
        title="Home (hold to show all seen posts)"
      >
        <span className={styles.navIcon}><HomeIcon active={homeActive} /></span>
        <span className={styles.navLabel}>Home</span>
      </button>
      <button type="button" className={styles.navBtn} onClick={openCompose} aria-label="New post">
        <span className={styles.navIcon}><PlusIcon /></span>
        <span className={styles.navLabel}>New</span>
      </button>
      <button
        type="button"
        className={searchActive ? styles.navActive : styles.navBtn}
        onClick={focusSearch}
        aria-label="Search"
        aria-pressed={searchActive}
      >
        <span className={styles.navIcon}><SearchIcon active={searchActive} /></span>
        <span className={styles.navLabel}>Search</span>
      </button>
      <button
        type="button"
        className={collectionsActive ? styles.navActive : styles.navBtn}
        onClick={handleCollectionsNavClick}
        aria-current={collectionsActive ? 'page' : undefined}
        aria-label="Collections"
        title="Collections"
      >
        <span className={styles.navIcon}><CollectionsBookmarkNavIcon active={collectionsActive} /></span>
        <span className={styles.navLabel}>Collections</span>
      </button>
    </>
  )

  if (isDesktop) {
    return navTrayItems
  }

  return (
    <>
      <div className={styles.navHomeWrap}>
        <button
          type="button"
          className={homeActive ? styles.navActive : ''}
          aria-current={homeActive ? 'page' : undefined}
          onPointerDown={startHomeHold}
          onPointerUp={endHomeHold}
          onPointerLeave={endHomeHold}
          onPointerCancel={endHomeHold}
          onClick={homeBtnClick}
          title="Home (hold to show all read posts)"
        >
          <span className={styles.navIcon}><HomeIcon active={homeActive} /></span>
        </button>
      </div>
      <button
        type="button"
        className={collectionsActive ? styles.navActive : styles.navBtn}
        onClick={handleCollectionsNavClick}
        aria-current={collectionsActive ? 'page' : undefined}
        aria-label="Collections"
        title="Collections"
      >
        <span className={styles.navIcon}><CollectionsBookmarkNavIcon active={collectionsActive} /></span>
      </button>
      <button type="button" className={styles.navBtn} onClick={openCompose} aria-label="New post">
        <span className={styles.navIcon}><PlusIcon /></span>
      </button>
      <button
        type="button"
        className={searchActive ? styles.navActive : styles.navBtn}
        onClick={focusSearch}
        aria-label="Search"
        aria-pressed={searchActive}
      >
        <span className={styles.navIcon}><SearchIcon active={searchActive} /></span>
      </button>
      <div className={styles.navProfileWrap}>
        <button
          ref={accountBtnRef}
          type="button"
          className={styles.navProfileBtn}
          onClick={accountBtnClick}
          aria-label="Account menu"
          aria-expanded={accountMenuOpen}
          title="Account menu"
        >
          <span className={styles.navIcon}>
            {currentAccountAvatar ? (
              <img
                src={resizedAvatarUrl(currentAccountAvatar, 32)}
                alt=""
                className={styles.navProfileAvatar}
                loading="lazy"
                decoding="async"
                onContextMenu={(e) => e.preventDefault()}
                draggable={false}
              />
            ) : (
              <span className={styles.navProfileIcon} aria-hidden><AccountIcon /></span>
            )}
          </span>
        </button>
      </div>
    </>
  )
})

export default LayoutNavItems
