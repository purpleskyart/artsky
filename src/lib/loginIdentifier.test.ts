import { describe, it, expect } from 'vitest'
import { normalizeLoginIdentifier } from './loginIdentifier'

describe('normalizeLoginIdentifier', () => {
  it('appends .bsky.social to bare handles', () => {
    expect(normalizeLoginIdentifier('alice')).toBe('alice.bsky.social')
    expect(normalizeLoginIdentifier('@alice')).toBe('alice.bsky.social')
    expect(normalizeLoginIdentifier('  alice  ')).toBe('alice.bsky.social')
  })

  it('leaves full handles, emails, and DIDs unchanged', () => {
    expect(normalizeLoginIdentifier('alice.bsky.social')).toBe('alice.bsky.social')
    expect(normalizeLoginIdentifier('alice.example.com')).toBe('alice.example.com')
    expect(normalizeLoginIdentifier('user@gmail.com')).toBe('user@gmail.com')
    expect(normalizeLoginIdentifier('did:plc:abc123')).toBe('did:plc:abc123')
  })

  it('returns empty string for blank input', () => {
    expect(normalizeLoginIdentifier('')).toBe('')
    expect(normalizeLoginIdentifier('   ')).toBe('')
    expect(normalizeLoginIdentifier('@')).toBe('')
  })
})
