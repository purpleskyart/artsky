import type { Location } from 'react-router-dom'

/** React Router modal pattern: stack overlays while keeping `backgroundLocation` mounted. */
export type BackgroundLocationState = { backgroundLocation?: Location }

/** Use when pushing a new overlay so the feed (or prior page) stays mounted underneath. */
export function getOverlayBackgroundLocation(location: Location): Location {
  const bg = (location.state as BackgroundLocationState | null)?.backgroundLocation
  return bg ?? location
}

export function hasPathOverlayStack(location: Location): boolean {
  return (location.state as BackgroundLocationState | null)?.backgroundLocation != null
}
