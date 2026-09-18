/**
 * EXAMPLE: How to use the Avatar component (optional migration)
 * 
 * The Avatar component provides automatic error handling for broken avatar URLs.
 * It silently handles 404 errors by hiding the image when it fails to load.
 * 
 * You can optionally migrate existing avatar <img> tags to use this component
 * for cleaner error handling, but it's not required since ProgressiveImage
 * already handles errors for feed images.
 */

// Example usage patterns:

// BEFORE (current pattern - still works fine):
// {avatarUrl ? (
//   <img src={avatarUrl} alt="" className="avatar" loading="lazy" />
// ) : (
//   <FallbackIcon />
// )}

// AFTER (optional - using Avatar component):
// import { Avatar } from './Avatar'
// 
// <Avatar
//   src={avatarUrl}
//   alt=""
//   className="avatar"
//   loading="lazy"
//   fallback={<FallbackIcon />}
// />

// The Avatar component automatically handles:
// - Missing/null/undefined src
// - 404 errors from broken CDN URLs
// - Network failures
// - Shows fallback UI when image fails to load

export {}
