// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { act, renderHook } from '@testing-library/react'
import { usePostTemplateDraft } from '../use-post-template-draft'
import { buildTemplateDoc, TEMPLATE_HEADING_ATTR } from '@/lib/shared/post-templates'
import type { TiptapContent } from '@/lib/shared/db-types'

const BUG = ['What went wrong?', 'What should happen?']
const typed: TiptapContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2, [TEMPLATE_HEADING_ATTR]: 'What went wrong?' },
      content: [{ type: 'text', text: 'What went wrong?' }],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'It crashed' }] },
  ],
}

describe('usePostTemplateDraft module boundary', () => {
  // Usage-based code splitting turns a module with a unique set of importers
  // into its own chunk. This hook is loaded only through the editor facade so
  // it ships in the chunk every composer already requests; a direct import
  // from anywhere else would split it back out into a request of its own.
  it('is imported only through the lazy editor facade', () => {
    const src = join(import.meta.dirname, '..', '..', '..')
    const importers: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (entry === '__tests__' || entry === 'node_modules') continue
        if (statSync(full).isDirectory()) walk(full)
        else if (
          /\.tsx?$/.test(entry) &&
          readFileSync(full, 'utf-8').includes("/use-post-template-draft'")
        )
          importers.push(relative(src, full))
      }
    }
    walk(src)
    expect(importers.sort()).toEqual(['components/ui/lazy-rich-text-editor.tsx'])
  })
})

describe('usePostTemplateDraft', () => {
  it('starts with an empty seed', () => {
    const { result } = renderHook(() => usePostTemplateDraft())
    expect(result.current.editorSeed).toBe('')
  })

  it('applies a template onto an untouched body and reports it did', () => {
    const { result } = renderHook(() => usePostTemplateDraft())
    let replaced = false
    act(() => {
      replaced = result.current.applyTemplate(BUG, null)
    })
    expect(replaced).toBe(true)
    expect(result.current.editorSeed).toEqual(buildTemplateDoc(BUG))
  })

  it('switching board while untouched replaces the skeleton', () => {
    const { result } = renderHook(() => usePostTemplateDraft())
    act(() => void result.current.applyTemplate(BUG, null))
    act(() => void result.current.applyTemplate(['Goal?'], buildTemplateDoc(BUG)))
    expect(result.current.editorSeed).toEqual(buildTemplateDoc(['Goal?']))
  })

  it('a board without a template clears an untouched skeleton back to the empty seed', () => {
    const { result } = renderHook(() => usePostTemplateDraft())
    act(() => void result.current.applyTemplate(BUG, null))
    act(() => void result.current.applyTemplate(undefined, buildTemplateDoc(BUG)))
    // '' (not an empty doc object): the composers fall back to their own
    // value for '', so a host prefill is never shadowed by an empty seed.
    expect(result.current.editorSeed).toBe('')
  })

  it('a board without a template is a no-op on a fresh composer', () => {
    const { result } = renderHook(() => usePostTemplateDraft())
    act(() => void result.current.applyTemplate(undefined, null))
    expect(result.current.editorSeed).toBe('')
    act(() => void result.current.applyTemplate([], null))
    expect(result.current.editorSeed).toBe('')
  })

  it('keeps a dirty body and reports it did not replace', () => {
    const { result } = renderHook(() => usePostTemplateDraft())
    act(() => void result.current.applyTemplate(BUG, null))
    const before = result.current.editorSeed
    let replaced = true
    act(() => {
      replaced = result.current.applyTemplate(['Goal?'], typed)
    })
    expect(replaced).toBe(false)
    expect(result.current.editorSeed).toBe(before)
  })

  it('insertTemplate appends the headings after the body', () => {
    const { result } = renderHook(() => usePostTemplateDraft())
    act(() => result.current.insertTemplate(['Goal?'], typed))
    const seed = result.current.editorSeed as TiptapContent
    expect(seed.content?.at(-2)?.content?.[0]?.text).toBe('Goal?')
  })

  it('treats a malformed stored template as no template', () => {
    const { result } = renderHook(() => usePostTemplateDraft())
    act(() => void result.current.applyTemplate(BUG, null))
    act(
      () => void result.current.applyTemplate('oops' as unknown as string[], buildTemplateDoc(BUG))
    )
    expect(result.current.editorSeed).toBe('')
  })

  it('insertTemplate ignores a malformed template instead of throwing', () => {
    const { result } = renderHook(() => usePostTemplateDraft())
    expect(() =>
      act(() => result.current.insertTemplate('oops' as unknown as string[], typed))
    ).not.toThrow()
    expect(result.current.editorSeed).toBe('')
  })

  it('finalize strips empty template sections and reset clears the seed', () => {
    const { result } = renderHook(() => usePostTemplateDraft())
    expect(result.current.finalize(buildTemplateDoc(BUG))).toBeNull()
    act(() => void result.current.applyTemplate(BUG, null))
    act(() => result.current.reset())
    expect(result.current.editorSeed).toBe('')
  })
})
