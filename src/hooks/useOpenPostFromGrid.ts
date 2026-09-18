import { useCallback } from 'react'

/** Open a post overlay from a grid (delegates to unified overlay entry in ProfileModalContext). */
export function useOpenPostFromGrid(
  _inModal: boolean,
  openPostModal: (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => void,
) {
  return useCallback(
    (uri: string, openReply?: boolean, focusUri?: string, authorHandle?: string) => {
      openPostModal(uri, openReply, focusUri, authorHandle)
    },
    [openPostModal],
  )
}
