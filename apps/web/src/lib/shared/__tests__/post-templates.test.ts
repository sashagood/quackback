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
  readBoardTemplate,
  validateBoardTemplate,
} from '../post-templates'

const BUG = ['What went wrong?', 'What should happen?']

const text = (t: string): TiptapContent => ({ type: 'text', text: t })
const p = (...content: TiptapContent[]): TiptapContent =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
/** A heading; when `template` is set the marker carries the ORIGINAL template text. */
const h2 = (t: string, template: string | false = false): TiptapContent => ({
  type: 'heading',
  attrs: { level: 2, ...(template ? { [TEMPLATE_HEADING_ATTR]: template } : {}) },
  content: [text(t)],
})
const doc = (...content: TiptapContent[]): TiptapContent => ({ type: 'doc', content })

describe('buildTemplateDoc', () => {
  it('emits one marked H2 followed by one empty paragraph per heading', () => {
    expect(buildTemplateDoc(BUG)).toEqual(
      doc(
        h2('What went wrong?', 'What went wrong?'),
        p(),
        h2('What should happen?', 'What should happen?'),
        p()
      )
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
    expect(
      isUntouchedTemplate(doc(h2('What went wrong?', 'What went wrong?'), p(text('It crashed'))))
    ).toBe(false)
  })
  it('is false for a heading the user typed (unmarked)', () => {
    expect(isUntouchedTemplate(doc(h2('My own heading')))).toBe(false)
  })
  it('an edited template heading counts as user content', () => {
    // The marker carries the original text; once the heading reads something
    // else the user wrote it, and it must survive a board switch and submit.
    const edited = doc(h2('What went wrong? App crashes on save', 'What went wrong?'), p())
    expect(isUntouchedTemplate(edited)).toBe(false)
    expect(finalizeTemplateDoc(edited)).toEqual(
      doc(
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [text('What went wrong? App crashes on save')],
        },
        p()
      )
    )
  })

  it('ignores surrounding whitespace when matching a heading to its marker', () => {
    expect(isUntouchedTemplate(doc(h2(' What went wrong? ', 'What went wrong?'), p()))).toBe(true)
  })
  it('treats a paragraph containing only whitespace or a hard break as empty', () => {
    expect(
      isUntouchedTemplate(
        doc(h2('What went wrong?', 'What went wrong?'), p(text('   ')), p({ type: 'hardBreak' }))
      )
    ).toBe(true)
  })
})

describe('appendTemplate', () => {
  it('keeps the existing body and adds the headings after it', () => {
    const body = doc(p(text('Already written')))
    expect(appendTemplate(body, ['How so?'])).toEqual(
      doc(p(text('Already written')), h2('How so?', 'How so?'), p())
    )
  })
  it('starts from a fresh skeleton when there is no body', () => {
    expect(appendTemplate(null, ['How so?'])).toEqual(buildTemplateDoc(['How so?']))
  })
})

describe('finalizeTemplateDoc', () => {
  it('drops a template heading whose section is empty and keeps answered ones, unmarked', () => {
    const input = doc(
      h2('What went wrong?', 'What went wrong?'),
      p(text('It crashed on save')),
      h2('What should happen?', 'What should happen?'),
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
    const input = doc(h2('What went wrong?', 'What went wrong?'), {
      type: 'resizableImage',
      attrs: { src: 'x' },
    })
    expect(finalizeTemplateDoc(input)).toEqual(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('What went wrong?')] },
        { type: 'resizableImage', attrs: { src: 'x' } }
      )
    )
  })
  it('ends a section at the next heading of level 1 or 2 but not at level 3', () => {
    const input = doc(
      h2('What went wrong?', 'What went wrong?'),
      { type: 'heading', attrs: { level: 3 }, content: [text('Sub')] },
      p(text('deep answer')),
      h2('What should happen?', 'What should happen?'),
      p()
    )
    expect(finalizeTemplateDoc(input)!.content?.map((n) => n.type)).toEqual([
      'heading',
      'heading',
      'paragraph',
    ])
  })
  it('is idempotent', () => {
    const once = finalizeTemplateDoc(doc(h2('A', 'A'), p(text('x')), h2('B', 'B'), p()))
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

describe('readBoardTemplate', () => {
  it('returns [] for anything that is not a list of headings', () => {
    expect(readBoardTemplate(undefined)).toEqual([])
    expect(readBoardTemplate(null)).toEqual([])
    expect(readBoardTemplate('oops')).toEqual([])
    expect(readBoardTemplate({ a: 1 })).toEqual([])
  })
  it('keeps only non-empty strings, trimmed, within the limits', () => {
    expect(readBoardTemplate(['', ' Why? ', 1, null, 'x'.repeat(121), 'How?'])).toEqual([
      'Why?',
      'How?',
    ])
    expect(readBoardTemplate(new Array(10).fill('h'))).toHaveLength(8)
  })
})

describe('parseTemplateText', () => {
  it('splits lines, trims, and drops blanks', () => {
    expect(parseTemplateText(' Why?\n\n  How? \n')).toEqual(['Why?', 'How?'])
    expect(parseTemplateText('')).toEqual([])
  })
})
