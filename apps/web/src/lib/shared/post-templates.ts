/**
 * Board post templates as pure functions over the Tiptap JSON document.
 *
 * A template is an ordered list of H2 question headings stored on
 * boards.settings.template. The editor inserts them as heading nodes carrying
 * `attrs[TEMPLATE_HEADING_ATTR] = <the original heading text>` so a composer
 * can tell provenance (template vs user-authored) without comparing whole
 * documents, and so a heading the user edited stops being "template". The
 * marker never reaches the database: `finalizeTemplateDoc` strips it on
 * submit and the server sanitizer drops unknown heading attrs.
 *
 * Definitions (all total, none mutate their input):
 *  - empty paragraph: a paragraph with no text leaf containing non-whitespace
 *    and no non-text leaf other than hardBreak.
 *  - section: a heading plus the nodes after it up to the next heading with
 *    level <= 2 (a level-3 heading belongs to the enclosing section).
 *  - untouched: every block is a template heading or an empty paragraph.
 */
import type { TiptapContent } from '@/lib/shared/db-types'
import {
  BOARD_TEMPLATE_HEADING_MAX_LENGTH,
  BOARD_TEMPLATE_MAX_HEADINGS,
  BOARD_TITLE_PLACEHOLDER_MAX_LENGTH,
} from '@/lib/shared/db-types'

export const TEMPLATE_HEADING_ATTR = 'templateHeading'

const SECTION_HEADING_MAX_LEVEL = 2

type Node = TiptapContent

function isParagraphEmpty(node: Node): boolean {
  if (node.type !== 'paragraph') return false
  for (const child of node.content ?? []) {
    if (child.type === 'text') {
      if ((child.text ?? '').trim() !== '') return false
    } else if (child.type !== 'hardBreak') {
      return false
    }
  }
  return true
}

function headingText(node: Node): string {
  return (node.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('')
}

/**
 * A heading is "template" only while it still reads what the template put
 * there: the marker carries the ORIGINAL text, so a heading the user rewrote
 * (or typed into) counts as their content and is never replaced or stripped.
 */
function isTemplateHeading(node: Node): boolean {
  if (node.type !== 'heading') return false
  const marker = node.attrs?.[TEMPLATE_HEADING_ATTR]
  return typeof marker === 'string' && headingText(node).trim() === marker
}

function isSectionHeading(node: Node): boolean {
  return node.type === 'heading' && Number(node.attrs?.level ?? 1) <= SECTION_HEADING_MAX_LEVEL
}

function templateHeadingNode(text: string): Node {
  return {
    type: 'heading',
    attrs: { level: 2, [TEMPLATE_HEADING_ATTR]: text },
    content: [{ type: 'text', text }],
  }
}

function templateBlocks(headings: readonly string[]): Node[] {
  return headings.flatMap((h) => [templateHeadingNode(h), { type: 'paragraph' }])
}

function stripMarker(node: Node): Node {
  if (node.type !== 'heading' || !node.attrs || !(TEMPLATE_HEADING_ATTR in node.attrs)) return node
  const { [TEMPLATE_HEADING_ATTR]: _marker, ...attrs } = node.attrs
  return { ...node, attrs }
}

/** The skeleton for a board: one marked H2 plus one empty paragraph per heading. */
export function buildTemplateDoc(headings: readonly string[]): TiptapContent {
  return { type: 'doc', content: templateBlocks(headings) }
}

/** The existing body followed by the board's headings (used when the body is dirty). */
export function appendTemplate(
  doc: TiptapContent | null | undefined,
  headings: readonly string[]
): TiptapContent {
  const existing = doc?.type === 'doc' ? (doc.content ?? []) : []
  return { type: 'doc', content: [...existing, ...templateBlocks(headings)] }
}

/** True when nothing in the body was written by the user (see module doc). */
export function isUntouchedTemplate(doc: TiptapContent | null | undefined): boolean {
  if (!doc || doc.type !== 'doc') return true
  return (doc.content ?? []).every((node) => isTemplateHeading(node) || isParagraphEmpty(node))
}

/** True when the body holds no text and no non-paragraph block. */
export function isDocEmpty(doc: TiptapContent | null | undefined): boolean {
  if (!doc || doc.type !== 'doc') return true
  return (doc.content ?? []).every(isParagraphEmpty)
}

/**
 * The body to save: template headings whose section holds no content are
 * removed together with that section's empty paragraphs; every remaining
 * heading loses the marker. Returns null when nothing remains.
 */
export function finalizeTemplateDoc(doc: TiptapContent | null | undefined): TiptapContent | null {
  if (!doc || doc.type !== 'doc') return null
  const blocks = doc.content ?? []
  const out: Node[] = []
  let i = 0
  while (i < blocks.length) {
    const node = blocks[i]
    if (!isTemplateHeading(node)) {
      out.push(stripMarker(node))
      i++
      continue
    }
    let j = i + 1
    while (j < blocks.length && !isSectionHeading(blocks[j])) j++
    const section = blocks.slice(i + 1, j)
    if (section.some((n) => !isParagraphEmpty(n))) {
      out.push(stripMarker(node), ...section.map(stripMarker))
    }
    i = j
  }
  if (out.length === 0 || out.every(isParagraphEmpty)) return null
  return { type: 'doc', content: out }
}

/**
 * The template as every READ site must see it. `boards.settings` is a JSON
 * column that can be hand-edited, so anything that is not a list of strings
 * within the limits is treated as "no template" rather than crashing a
 * composer or the settings page. Total: never throws.
 */
export function readBoardTemplate(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const h of raw) {
    if (typeof h !== 'string') continue
    const t = h.trim()
    if (!t || t.length > BOARD_TEMPLATE_HEADING_MAX_LENGTH) continue
    out.push(t)
    if (out.length === BOARD_TEMPLATE_MAX_HEADINGS) break
  }
  return out
}

/**
 * The board's title-field hint as stored in settings, or undefined when the
 * value is missing, blank, over the limit, or not a string (a hand-edited
 * settings JSON falls back to the generic hint rather than crashing).
 */
export function readBoardTitlePlaceholder(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const t = raw.trim()
  if (!t || t.length > BOARD_TITLE_PLACEHOLDER_MAX_LENGTH) return undefined
  return t
}

/** One heading per non-blank line, trimmed (the settings textarea → list). */
export function parseTemplateText(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * Validate a board template as stored: a list of 0–8 non-empty headings of
 * at most 120 characters each. Shared by the settings form and the server.
 */
export function validateBoardTemplate(
  raw: unknown
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: 'Template must be a list of headings' }
  if (raw.length > BOARD_TEMPLATE_MAX_HEADINGS) {
    return {
      ok: false,
      message: `A template can have at most ${BOARD_TEMPLATE_MAX_HEADINGS} headings`,
    }
  }
  const headings: string[] = []
  for (const h of raw) {
    if (typeof h !== 'string') return { ok: false, message: 'Headings must be text' }
    const t = h.trim()
    if (!t) return { ok: false, message: 'Headings cannot be empty' }
    if (t.length > BOARD_TEMPLATE_HEADING_MAX_LENGTH) {
      return {
        ok: false,
        message: `Headings must be ${BOARD_TEMPLATE_HEADING_MAX_LENGTH} characters or less`,
      }
    }
    headings.push(t)
  }
  return { ok: true, value: headings }
}
