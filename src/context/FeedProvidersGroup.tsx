import { memo, useMemo, type ReactNode } from 'react'
import { ViewModeProvider } from './ViewModeContext'
import { ArtOnlyProvider } from './ArtOnlyContext'
import { MediaOnlyProvider } from './MediaOnlyContext'
import { FeedMixProvider } from './FeedMixContext'
import { SeenPostsProvider } from './SeenPostsContext'
import { HideRepostsProvider } from './HideRepostsContext'
import { LikeOverridesProvider } from './LikeOverridesContext'

interface FeedProvidersGroupProps {
  children: ReactNode
}

/**
 * FeedProvidersGroup combines feed-related providers (ViewMode, ArtOnly, MediaOnly, 
 * FeedMix, SeenPosts, HideReposts, LikeOverrides) into a single memoized component to reduce nesting 
 * depth and improve render performance.
 * 
 * Each individual provider already memoizes its context values internally, and this wrapper
 * is memoized to prevent unnecessary re-renders of the provider tree itself.
 */
function FeedProvidersGroupComponent({ children }: FeedProvidersGroupProps) {
  // Memoize the children to prevent unnecessary re-renders
  const memoizedChildren = useMemo(() => children, [children])

  return (
    <ViewModeProvider>
      <ArtOnlyProvider>
        <MediaOnlyProvider>
          <FeedMixProvider>
            <SeenPostsProvider>
              <HideRepostsProvider>
                <LikeOverridesProvider>
                  {memoizedChildren}
                </LikeOverridesProvider>
              </HideRepostsProvider>
            </SeenPostsProvider>
          </FeedMixProvider>
        </MediaOnlyProvider>
      </ArtOnlyProvider>
    </ViewModeProvider>
  )
}

/**
 * Memoized FeedProvidersGroup component to prevent re-renders when props haven't changed.
 * This optimization ensures that the entire provider tree doesn't re-render unnecessarily.
 */
export const FeedProvidersGroup = memo(FeedProvidersGroupComponent)
