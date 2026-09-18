import { useParams } from 'react-router-dom'
import Layout from '../components/Layout'
import ProfileContent from './ProfileContent'
import styles from './ProfilePage.module.css'

export default function ProfilePage() {
  const { handle: handleParam } = useParams<{ handle: string }>()
  const handle = handleParam ? decodeURIComponent(handleParam) : ''

  if (!handle) {
    return (
      <Layout title="Profile" showNav>
        <div className={styles.wrap}>
          <p className={styles.empty}>No profile specified.</p>
        </div>
      </Layout>
    )
  }

  return (
    <Layout title={`@${handle}`} showNav>
      <ProfileContent
        handle={handle}
        openProfileModal={() => {}}
        openPostModal={() => {}}
        isModalOpen={false}
      />
    </Layout>
  )
}
