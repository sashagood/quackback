import { describe, it, expect } from 'vitest'
import type { TiptapContent } from '@/lib/shared/db-types'
import {
  TEMPLATE_HEADING_ATTR,
  appendTemplate,
  buildTemplateDoc,
  finalizeTemplateDoc,
  isDocEmpty,
  isUntouchedTemplate,
  parseTemplateText,
  validateBoardTemplate,
} from '../post-templates'

const BUG = ['What went wrong?', 'What should happen?']

const text = (t: string): TiptapContent => ({ type: 'text', text: t })
const p = (...content: TiptapContent[]): TiptapContent =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
const h2 = (t: string, template = false): TiptapContent => ({
  type: 'heading',
  attrs: { level: 2, [TEMPLATE_HEADING_ATTR]: template },
  content: [text(t)],
})
const doc = (...content: TiptapContent[]): TiptapContent => ({ type: 'doc', content })

describe('buildTemplateDoc', () => {
  it('emits one marked H2 followed by one empty paragraph per heading', () => {
    expect(buildTemplateDoc(BUG)).toEqual(
      doc(h2('What went wrong?', true), p(), h2('What should happen?', true), p())
    )
  })
  it('is untouched by definition', () => {
    expect(isUntouchedTemplate(buildTemplateDoc(BUG))).toBe(true)
  })
})

describe('isUntouchedTemplate', () => {
  it('is true for an empty or missing document', () => {
    expect(isUntouchedTemplate(null)).toBe(true)
    expect(isUntouchedTemplate(doc())).toBe(true)
    expect(isUntouchedTemplate(doc(p()))).toBe(true)
  })
  it('is false once any paragraph has text', () => {
    expect(isUntouchedTemplate(doc(h2('What went wrong?', true), p(text('It crashed'))))).toBe(
      false
    )
  })
  it('is false for a heading the user typed (unmarked)', () => {
    expect(isUntouchedTemplate(doc(h2('My own heading')))).toBe(false)
  })
  it('stays untouched when a template heading is renamed but still unanswered', () => {
    expect(isUntouchedTemplate(doc(h2('Renamed', true), p()))).toBe(true)
  })
  it('treats a paragraph containing only whitespace or a hard break as empty', () => {
    expect(
      isUntouchedTemplate(
        doc(h2('What went wrong?', true), p(text('   ')), p({ type: 'hardBreak' }))
      )
    ).toBe(true)
  })
})

describe('appendTemplate', () => {
  it('keeps the existing body and adds the headings after it', () => {
    const body = doc(p(text('Already written')))
    expect(appendTemplate(body, ['How so?'])).toEqual(
      doc(p(text('Already written')), h2('How so?', true), p())
    )
  })
  it('starts from a fresh skeleton when there is no body', () => {
    expect(appendTemplate(null, ['How so?'])).toEqual(buildTemplateDoc(['How so?']))
  })
})

describe('finalizeTemplateDoc', () => {
  it('drops a template heading whose section is empty and keeps answered ones, unmarked', () => {
    const input = doc(
      h2('What went wrong?', true),
      p(text('It crashed on save')),
      h2('What should happen?', true),
      p()
    )
    expect(finalizeTemplateDoc(input)).toEqual(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('What went wrong?')] },
        p(text('It crashed on save'))
      )
    )
  })
  it('returns null when only untouched headings remain', () => {
    expect(finalizeTemplateDoc(buildTemplateDoc(BUG))).toBeNull()
  })
  it('keeps user-authored headings even when their section is empty', () => {
    expect(finalizeTemplateDoc(doc(h2('Notes'), p()))).toEqual(
      doc({ type: 'heading', attrs: { level: 2 }, content: [text('Notes')] }, p())
    )
  })
  it('counts a non-text block (image) as section content', () => {
    const input = doc(h2('What went wrong?', true), { type: 'resizableImage', attrs: { src: 'x' } })
    expect(finalizeTemplateDoc(input)).toEqual(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('What went wrong?')] },
        { type: 'resizableImage', attrs: { src: 'x' } }
      )
    )
  })
  it('ends a section at the next heading of level 1 or 2 but not at level 3', () => {
    const input = doc(
      h2('What went wrong?', true),
      { type: 'heading', attrs: { level: 3 }, content: [text('Sub')] },
      p(text('deep answer')),
      h2('What should happen?', true),
      p()
    )
    expect(finalizeTemplateDoc(input)!.content?.map((n) => n.type)).toEqual([
      'heading',
      'heading',
      'paragraph',
    ])
  })
  it('is idempotent', () => {
    const once = finalizeTemplateDoc(doc(h2('A', true), p(text('x')), h2('B', true), p()))
    expect(finalizeTemplateDoc(once)).toEqual(once)
  })
  it('never mutates its input', () => {
    const input = buildTemplateDoc(BUG)
    const snapshot = JSON.stringify(input)
    finalizeTemplateDoc(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('isDocEmpty', () => {
  it('is true for null, empty doc, and whitespace-only paragraphs', () => {
    expect(isDocEmpty(null)).toBe(true)
    expect(isDocEmpty(doc())).toBe(true)
    expect(isDocEmpty(doc(p(text(' '))))).toBe(true)
  })
  it('is false for text or a block node', () => {
    expect(isDocEmpty(doc(p(text('a'))))).toBe(false)
    expect(isDocEmpty(doc({ type: 'horizontalRule' }))).toBe(false)
  })
})

describe('validateBoardTemplate', () => {
  it('accepts an empty list (no template) and trims headings', () => {
    expect(validateBoardTemplate([])).toEqual({ ok: true, value: [] })
    expect(validateBoardTemplate([' Why? ', 'How?'])).toEqual({
      ok: true,
      value: ['Why?', 'How?'],
    })
  })
  it.each([
    [new Array(9).fill('a'), /8/],
    [['   '], /empty/i],
    [['x'.repeat(121)], /120/],
    ['not a list', /list/i],
    [[1], /text/i],
  ])('rejects %j', (input, message) => {
    const r = validateBoardTemplate(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(message)
  })
})

describe('parseTemplateText', () => {
  it('splits lines, trims, and drops blanks', () => {
    expect(parseTemplateText(' Why?\n\n  How? \n')).toEqual(['Why?', 'How?'])
    expect(parseTemplateText('')).toEqual([])
  })
})
