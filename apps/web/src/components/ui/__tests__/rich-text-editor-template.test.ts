// @vitest-environment happy-dom
/**
 * Board templates inside a REAL Tiptap editor (headless): the provenance
 * marker survives a setContent → getJSON round trip only when the composer
 * opts in, a seeded document puts the cursor under the FIRST heading (not at
 * the end), and the attribute never leaks into editors that did not opt in.
 */
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions, placeCursorAfterTemplateSeed } from '../rich-text-editor'
import { buildTemplateDoc, TEMPLATE_HEADING_ATTR } from '@/lib/shared/post-templates'

const SEED = buildTemplateDoc(['What went wrong?', 'What should happen?'])

function headless(features: Parameters<typeof buildExtensions>[0]) {
  return new Editor({
    extensions: buildExtensions(
      { slashMenu: false, mentions: false, ...features },
      { placeholder: '' }
    ),
    content: SEED,
  })
}

describe('template headings in a real editor', () => {
  it('keeps the marker text through setContent → getJSON when templates are enabled', () => {
    const editor = headless({ headings: true, templateHeadings: true })
    const first = editor.getJSON().content?.[0]
    expect(first?.type).toBe('heading')
    expect(first?.attrs?.[TEMPLATE_HEADING_ATTR]).toBe('What went wrong?')
    editor.destroy()
  })

  it('does not add the attribute in editors that did not opt in', () => {
    const editor = headless({ headings: true })
    const first = editor.getJSON().content?.[0]
    expect(first?.type).toBe('heading')
    expect(first?.attrs && TEMPLATE_HEADING_ATTR in first.attrs).toBe(false)
    editor.destroy()
  })

  it('places the cursor in the paragraph under the first heading after a seed', () => {
    const editor = headless({ headings: true, templateHeadings: true })
    placeCursorAfterTemplateSeed(editor)
    const { $from } = editor.state.selection
    // Depth-1 index 1 = the empty paragraph right after the first heading.
    expect($from.index(0)).toBe(1)
    expect($from.parent.type.name).toBe('paragraph')
    editor.destroy()
  })

  it('leaves the selection alone when the document is not a template seed', () => {
    const editor = new Editor({
      extensions: buildExtensions(
        { headings: true, templateHeadings: true, slashMenu: false, mentions: false },
        { placeholder: '' }
      ),
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
      },
    })
    const before = editor.state.selection.from
    placeCursorAfterTemplateSeed(editor)
    expect(editor.state.selection.from).toBe(before)
    editor.destroy()
  })
})
