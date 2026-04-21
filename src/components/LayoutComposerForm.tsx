import type { FormEvent, KeyboardEvent, RefObject } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import ComposerSuggestions from './ComposerSuggestions'
import PostText from './PostText'
import CharacterCountWithCircle from './CharacterCountWithCircle'
import styles from './Layout.module.css'

export type ComposeSegment = { id: string; text: string; images: File[]; imageAlts: string[]; hasSpoiler?: boolean; mediaSensitive?: boolean }

export interface LayoutComposerFormProps {
  composeSegments: ComposeSegment[]
  composeSegmentIndex: number
  setComposeSegmentIndex: Dispatch<SetStateAction<number>>
  composePosting: boolean
  composeError: string | null
  composeFormRef: RefObject<HTMLFormElement | null>
  composeFileInputRef: RefObject<HTMLInputElement | null>
  currentSegment: ComposeSegment
  setComposeSegments: Dispatch<SetStateAction<ComposeSegment[]>>
  setCurrentSegmentText: (value: string) => void
  handleComposeSubmit: (e: FormEvent) => void
  handleComposeKeyDown: (e: KeyboardEvent, form: HTMLFormElement | null) => void
  addComposeImages: (files: FileList | File[]) => void
  removeComposeImage: (index: number) => void
  addComposeThreadSegment: () => void
  composePreviewUrls: string[]
  isDesktop: boolean
  postMaxLength: number
  composeImageMax: number
  /** Optional callback to handle Add media button click (for mobile keyboard handling) */
  onAddMediaClick?: () => void
  /** Toggle spoiler flag for text content */
  onToggleSpoiler?: () => void
  /** Toggle media sensitive flag for images */
  onToggleMediaSensitive?: () => void
}

export default function LayoutComposerForm({
  composeSegments,
  composeSegmentIndex,
  setComposeSegmentIndex,
  composePosting,
  composeError,
  composeFormRef,
  composeFileInputRef,
  currentSegment,
  setComposeSegments,
  setCurrentSegmentText,
  handleComposeSubmit,
  handleComposeKeyDown,
  addComposeImages,
  removeComposeImage,
  addComposeThreadSegment,
  composePreviewUrls,
  isDesktop,
  postMaxLength,
  composeImageMax,
  onAddMediaClick,
  onToggleSpoiler,
  onToggleMediaSensitive,
}: LayoutComposerFormProps) {
  return (
    <form id="compose-form" ref={composeFormRef} onSubmit={handleComposeSubmit}>
      {composeSegments.length > 1 && (
        <div className={styles.composePreviousPosts} role="region" aria-label="Posts in thread">
          <p className={styles.composePreviousPostsTitle}>Posts in thread — click to edit</p>
          <div className={styles.composePreviousPostsList}>
            {composeSegments.map((seg, i) =>
              i === composeSegmentIndex ? null : (
                <button
                  key={seg.id}
                  type="button"
                  className={styles.composePreviousPostCard}
                  onClick={() => setComposeSegmentIndex(i)}
                  disabled={composePosting}
                  aria-label={`Edit post ${i + 1}`}
                >
                  <span className={styles.composePreviousPostLabel}>
                    Post {i + 1}
                  </span>
                  {seg.text.trim() ? (
                    <div className={styles.composePreviousPostText}>
                      <PostText text={seg.text} interactive={false} />
                    </div>
                  ) : seg.images.length > 0 ? null : (
                    <div className={styles.composePreviousPostText}><em>Empty</em></div>
                  )}
                  {seg.images.length > 0 && (
                    <p className={styles.composePreviousPostMedia}>
                      {seg.images.length} image{seg.images.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </button>
              )
            )}
          </div>
        </div>
      )}
      {composeSegments.length > 1 && (
        <p className={styles.composeSegmentLabel}>Post {composeSegmentIndex + 1} of {composeSegments.length}</p>
      )}
      <ComposerSuggestions
        className={styles.composeTextarea}
        value={currentSegment.text}
        onChange={setCurrentSegmentText}
        onKeyDown={(e) => handleComposeKeyDown(e, composeFormRef.current)}
        placeholder="What's on your mind? Type @ for users or # for hashtags"
        rows={isDesktop ? 6 : 6}
        maxLength={postMaxLength}
        disabled={composePosting}
        autoFocus={isDesktop}
      />
      {currentSegment.images.length > 0 && (
        <div className={styles.composeMediaSection}>
          <div className={styles.composePreviews}>
            {currentSegment.images.map((img, i) => (
              <div key={`${img.name}-${img.size}-${img.lastModified}`} className={styles.composePreviewWrap}>
                <img
                  src={composePreviewUrls[i]}
                  alt=""
                  className={styles.composePreviewImg}
                />
                <button
                  type="button"
                  className={styles.composePreviewRemove}
                  onClick={() => removeComposeImage(i)}
                  aria-label="Remove image"
                  disabled={composePosting}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <p className={styles.composeAltPrompt}>Describe each image for accessibility (alt text).</p>
          <div className={styles.composeAltFields}>
            {currentSegment.images.map((img, i) => (
              <div key={`${img.name}-${img.size}-${img.lastModified}`} className={styles.composeAltRow}>
                <label htmlFor={`compose-alt-${composeSegmentIndex}-${i}`} className={styles.composeAltLabel}>
                  Image {i + 1}
                </label>
                <input
                  id={`compose-alt-${composeSegmentIndex}-${i}`}
                  type="text"
                  className={styles.composeAltInput}
                  placeholder="Describe this image for people using screen readers"
                  value={currentSegment.imageAlts[i] ?? ''}
                  onChange={(e) => {
                    const val = e.target.value.slice(0, 1000)
                    setComposeSegments((prev) => {
                      const n = [...prev]
                      const s = n[composeSegmentIndex]
                      if (!s) return prev
                      const nextAlts = [...s.imageAlts]
                      while (nextAlts.length < s.images.length) nextAlts.push('')
                      nextAlts[i] = val
                      n[composeSegmentIndex] = { ...s, imageAlts: nextAlts }
                      return n
                    })
                  }}
                  maxLength={1000}
                  disabled={composePosting}
                  aria-label={`Alt text for image ${i + 1}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={styles.composeFooter}>
        <div className={styles.composeFooterLeft}>
          <input
            ref={composeFileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className={styles.composeFileInput}
            onChange={(e) => {
              if (e.target.files?.length) addComposeImages(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className={styles.composeAddMedia}
            onClick={() => {
              // Use provided handler if available (handles mobile keyboard position tracking)
              if (onAddMediaClick) {
                onAddMediaClick()
              } else {
                composeFileInputRef.current?.click()
              }
            }}
            disabled={composePosting || currentSegment.images.length >= composeImageMax}
            title="Add photo"
            aria-label="Add photo"
          >
            Add media
          </button>
          {currentSegment.text.trim().length > 0 && (
            <button
              type="button"
              className={`${styles.composeToggle} ${currentSegment.hasSpoiler ? styles.composeToggleActive : ''}`}
              onClick={onToggleSpoiler}
              disabled={composePosting}
              title="Mark text as spoiler"
              aria-label="Mark text as spoiler"
              aria-pressed={currentSegment.hasSpoiler}
            >
              Spoiler
            </button>
          )}
          {currentSegment.images.length > 0 && (
            <button
              type="button"
              className={`${styles.composeToggle} ${currentSegment.mediaSensitive ? styles.composeToggleActive : ''}`}
              onClick={onToggleMediaSensitive}
              disabled={composePosting}
              title="Mark media as sensitive (content warning)"
              aria-label="Mark media as sensitive (content warning)"
              aria-pressed={currentSegment.mediaSensitive}
            >
              Sensitive
            </button>
          )}
        </div>
        <div className={styles.composeActions}>
          <CharacterCountWithCircle used={currentSegment.text.length} max={postMaxLength} />
          <button
            type="button"
            className={styles.composeAddThread}
            onClick={addComposeThreadSegment}
            disabled={composePosting}
            title="Add to thread"
            aria-label="Add to thread"
          >
            +
          </button>
        </div>
      </div>
      {composeError && <p className={styles.composeError}>{composeError}</p>}
    </form>
  )
}
