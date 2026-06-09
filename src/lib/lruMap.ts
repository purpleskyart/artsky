/** Set a Map entry and evict oldest keys when over maxSize (LRU by insertion order). */
export function lruMapSet<K, V>(map: Map<K, V>, key: K, value: V, maxSize: number): void {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
  while (map.size > maxSize) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

/** Trim a Map to maxSize by removing oldest entries. */
export function lruMapTrim<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size > maxSize) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}
