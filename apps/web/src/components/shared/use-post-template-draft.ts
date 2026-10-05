/**
 * The template state of one composer. `editorSeed` is what the editor is
 * handed as `value`: it changes identity only when this hook decides the body
 * should be replaced or extended (new object → the editor's value-sync effect
 * calls setContent), so typing never fights a controlled value. The empty
 * seed is `''`, never an empty document object, so a composer's own fallback
 * value (a host prefill, for example) is never shadowed by "no template".
 */
import { useCallback, useMemo, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import type { TiptapContent } from '@/lib/shared/db-types'
import {
  appendTemplate,
  buildTemplateDoc,
  finalizeTemplateDoc,
  isUntouchedTemplate,
  readBoardTemplate,
} from '@/lib/shared/post-templates'

/** Composers hand over the editor's own JSONContent; the pure module reads the DB shape. */
type Doc = TiptapContent | JSONContent | null | undefined
const asDoc = (doc: Doc) => doc as TiptapContent | null | undefined

export interface PostTemplateDraft {
  editorSeed: TiptapContent | ''
  /**
   * A board was chosen. Replaces the body with its headings when the body is
   * untouched (no template clears it back to the empty seed) and returns
   * true; keeps a dirty body and returns false. Accepts whatever is stored:
   * a malformed template reads as no template.
   */
  applyTemplate: (headings: unknown, currentDoc: Doc) => boolean
  /** Append the headings after the current body (the "Insert template" affordance). */
  insertTemplate: (headings: unknown, currentDoc: Doc) => void
  /** The body to submit: empty template sections stripped, marker removed. */
  finalize: (currentDoc: Doc) => TiptapContent | null
  reset: () => void
}

export function usePostTemplateDraft(): PostTemplateDraft {
  const [editorSeed, setEditorSeed] = useState<TiptapContent | ''>('')

  const applyTemplate = useCallback((headings: unknown, currentDoc: Doc) => {
    if (!isUntouchedTemplate(asDoc(currentDoc))) return false
    const safe = readBoardTemplate(headings)
    setEditorSeed(safe.length === 0 ? '' : buildTemplateDoc(safe))
    return true
  }, [])

  const insertTemplate = useCallback((headings: unknown, currentDoc: Doc) => {
    const safe = readBoardTemplate(headings)
    if (safe.length === 0) return
    setEditorSeed(appendTemplate(asDoc(currentDoc), safe))
  }, [])

  const finalize = useCallback((currentDoc: Doc) => finalizeTemplateDoc(asDoc(currentDoc)), [])
  const reset = useCallback(() => setEditorSeed(''), [])

  return useMemo(
    () => ({ editorSeed, applyTemplate, insertTemplate, finalize, reset }),
    [editorSeed, applyTemplate, insertTemplate, finalize, reset]
  )
}
