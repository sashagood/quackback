/**
 * The author edit window (PRO-573) is decided from the activity log: a post is
 * "reviewed by the team" once a `status.changed` activity exists under a
 * non-service principal. That only holds while every writer of posts.status_id
 * records the activity under the right principal. This guard lists the known
 * writers; a new one must either go through changeStatus / updatePost or be
 * added here deliberately, with its activity row.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const serverRoot = join(here, '..', '..', '..')

/** Writers that record `status.changed` under the acting principal. */
const LOGGING_STATUS_WRITERS = [
  // Human status change (admin UI, bulk action, API): under the actor.
  'domains/posts/post.status.ts',
  // Admin post update carrying a status field: under the actor.
  'domains/posts/post.service.ts',
  // Team comment that also moves the status: under the commenter.
  'domains/comments/comment.service.ts',
  // Integration mirror: under the integration's service principal.
  'domains/posts/post-status-sync.ts',
]

/**
 * Writers that deliberately record nothing: a CSV import assigns the status
 * the file names at import time; that is data entry, not a team review, so an
 * imported post mapped to a portal author keeps its edit window.
 */
const SILENT_STATUS_WRITERS = ['domains/import/import-service.ts']

const KNOWN_STATUS_WRITERS = new Set([...LOGGING_STATUS_WRITERS, ...SILENT_STATUS_WRITERS])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry === '__tests__' || entry === 'node_modules') continue
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

// `update(posts)` … `.set({ … statusId … })` within one statement, or a
// `.set(updateData)` whose object was given a statusId earlier in the file.
const INLINE_STATUS_WRITE = /update\(posts\)[\s\S]{0,400}?\.set\(\{[\s\S]{0,400}?\bstatusId\b/
const INDIRECT_STATUS_WRITE = /update\(posts\)[\s\S]{0,200}?\.set\((\w+)\)/g
const ASSIGNS_STATUS = (name: string) => new RegExp(`\\b${name}\\.statusId\\s*=`)

function writesStatus(src: string): boolean {
  if (INLINE_STATUS_WRITE.test(src)) return true
  for (const match of src.matchAll(INDIRECT_STATUS_WRITE)) {
    if (ASSIGNS_STATUS(match[1]!).test(src)) return true
  }
  return false
}

describe('posts.status_id writers', () => {
  it('are exactly the known ones (add a new writer here, with its activity row)', () => {
    const writers = new Set<string>()
    for (const file of walk(serverRoot)) {
      if (writesStatus(readFileSync(file, 'utf-8'))) writers.add(relative(serverRoot, file))
    }
    expect([...writers].sort()).toEqual([...KNOWN_STATUS_WRITERS].sort())
  })

  it('every logging writer records the status.changed activity', () => {
    for (const file of LOGGING_STATUS_WRITERS) {
      const src = readFileSync(join(serverRoot, file), 'utf-8')
      expect(src, file).toMatch(/type:\s*'status\.changed'/)
    }
  })
})
