import { randomUUID } from 'node:crypto'

/** Bounded latest-change index. A reset invalidates every prior reader cursor. */
export class RequestChanges {
  private generation = randomUUID()
  private sequence = 0
  private readonly changed = new Map<string, number>()

  record(id: string): void {
    this.changed.delete(id)
    this.changed.set(id, ++this.sequence)
  }

  reset(ids: Iterable<string> = []): void {
    this.generation = randomUUID()
    this.sequence = 0
    this.changed.clear()
    for (const id of ids) this.record(id)
  }

  read(
    cursor: string,
    limit: number,
  ): { error: 'cursor_expired' | 'invalid_cursor' } | { ids: string[]; nextCursor: string; hasMore: boolean } {
    let after = 0
    if (cursor !== '') {
      let decoded: unknown
      try {
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      } catch {
        return { error: 'invalid_cursor' }
      }
      if (
        !Array.isArray(decoded) ||
        decoded.length !== 2 ||
        typeof decoded[0] !== 'string' ||
        !Number.isSafeInteger(decoded[1]) ||
        decoded[1] < 0
      ) {
        return { error: 'invalid_cursor' }
      }
      if (decoded[0] !== this.generation) return { error: 'cursor_expired' }
      after = decoded[1]
      if (after > this.sequence) return { error: 'invalid_cursor' }
    }
    const ids: string[] = []
    let sequence = after
    let hasMore = false
    for (const [id, changedAt] of this.changed) {
      if (changedAt <= after) continue
      if (ids.length === limit) {
        hasMore = true
        break
      }
      ids.push(id)
      sequence = changedAt
    }
    return {
      ids,
      nextCursor: Buffer.from(JSON.stringify([this.generation, sequence])).toString('base64url'),
      hasMore,
    }
  }
}
