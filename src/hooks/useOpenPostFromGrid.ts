import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getPostAppPath } from '../lib/appUrl'
import { getOverlayBackgroundLocation } from '../lib/overlayNavigation'

/** Open a post in-modal or navigate with overlay background (tag/search/profile grids). */
export function useOpenPostFromGrid(
  inModal: boolean,
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void,
) {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(
    (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => {
      if (inModal) {
        openPostModal(uri, openReply, focusUri, authorHandle)
        return
      }
      const path = getPostAppPath(uri, authorHandle)
      const q = new URLSearchParams()
      if (openReply) q.set('reply', '1')
      if (focusUri) q.set('focus', focusUri)
      const qs = q.toString()
      navigate(
        { pathname: path, search: qs ? `?${qs}` : '' },
        { state: { backgroundLocation: getOverlayBackgroundLocation(location) } },
      )
    },
    [inModal, openPostModal, navigate, location],
  )
}
