/**
 * Saving a board template must MERGE into boards.settings (custom fields and
 * roadmap statuses survive), never replace the column. updateBoard() replaces
 * settings wholesale when given them, so the server fn must route settings
 * through updateBoardSettings() instead. Pinned at the source level, like the
 * permission contracts in this directory.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'boards.ts'), 'utf-8')
const updateFn = src.slice(
  src.indexOf('export const updateBoardFn'),
  src.indexOf('export const deleteBoardFn')
)

describe('updateBoardFn settings handling', () => {
  it('accepts settings.template in its schema', () => {
    expect(src).toMatch(/const boardSettingsSchema[\s\S]*?template:\s*z\.array\(z\.string\(\)\)/)
  })
  it('validates the template with the shared rules', () => {
    expect(updateFn).toMatch(/validateBoardTemplate\(/)
  })
  it('merges settings through updateBoardSettings and never hands them to updateBoard', () => {
    expect(updateFn).toMatch(/updateBoardSettings\(/)
    expect(updateFn).not.toMatch(/updateBoard\([\s\S]*?settings:\s*data\.settings/)
  })
})
