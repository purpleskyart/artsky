import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../context/SessionContext'
import * as bsky from '../lib/bsky'
import styles from './LoginPage.module.css'

type Mode = 'signin' | 'create'

export default function LoginPage() {
  const { login, refreshSession } = useSession()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(identifier.trim(), password)
      navigate('/feed', { replace: true })
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Sign in failed. Use your Bluesky handle (or email) and an App Password from Settings → App passwords.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await bsky.createAccount({
        email: email.trim(),
        password: createPassword,
        handle: handle.trim().toLowerCase().replace(/^@/, ''),
        inviteCode: inviteCode.trim() || undefined,
      })
      refreshSession()
      navigate('/feed', { replace: true })
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : 'Could not create account. Check that the handle is available and invite code is valid (if required).'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.title}>artsky</h1>
        <p className={styles.subtitle}>Bluesky feed & artboards</p>

        <div className={styles.tabs}>
          <button
            type="button"
            className={mode === 'signin' ? styles.tabActive : styles.tab}
            onClick={() => {
              setMode('signin')
              setError('')
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === 'create' ? styles.tabActive : styles.tab}
            onClick={() => {
              setMode('create')
              setError('')
            }}
          >
            Create account
          </button>
        </div>

        {mode === 'signin' ? (
          <form onSubmit={handleSignIn} className={styles.form}>
            <input
              type="text"
              placeholder="Handle or email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className={styles.input}
              autoComplete="username"
              required
            />
            <input
              type="password"
              placeholder="App password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              autoComplete="current-password"
              required
            />
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <p className={styles.hint}>
              Create an App Password in Bluesky: Settings → App passwords. Do not use your main password.
            </p>
          </form>
        ) : (
          <form onSubmit={handleCreateAccount} className={styles.form}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              autoComplete="email"
              required
            />
            <input
              type="text"
              placeholder="Handle (e.g. you.bsky.social)"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className={styles.input}
              autoComplete="username"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              className={styles.input}
              autoComplete="new-password"
              required
              minLength={8}
            />
            <input
              type="text"
              placeholder="Invite code (if you have one)"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className={styles.input}
              autoComplete="off"
            />
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
            <p className={styles.hint}>
              You’re creating a Bluesky account. An invite code may be required depending on Bluesky’s current signup policy.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
