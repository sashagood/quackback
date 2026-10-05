/**
 * The template state of one composer. `editorSeed` is what the editor is
 * handed as `value`: it changes identity only when this hook decides the body
 * should be replaced or extended (new object → the editor's value-sync effect
 * calls setContent), so typing never fights a controlled value.
 */
import { useCallback, useState } from 'react'
import type { TiptapContent } from '@/lib/shared/db-types'
import {
  appendTemplate,
  buildTemplateDoc,
  finalizeTemplateDoc,
  isUntouchedTemplate,
} from '@/lib/shared/post-templates'

type Doc = TiptapContent | null | undefined

export interface PostTemplateDraft {
  editorSeed: TiptapContent | ''
  /**
   * A board was chosen. Replaces the body with its headings when the body is
   * untouched (an undefined/empty template clears it) and returns true;
   * keeps a dirty body and returns false.
   */
  applyTemplate: (headings: readonly string[] | undefined, currentDoc: Doc) => boolean
  /** Append the headings after the current body (the "Insert template" affordance). */
  insertTemplate: (headings: readonly string[], currentDoc: Doc) => void
  /** The body to submit: empty template sections stripped, marker removed. */
  finalize: (currentDoc: Doc) => TiptapContent | null
  reset: () => void
}

export function usePostTemplateDraft(): PostTemplateDraft {
  const [editorSeed, setEditorSeed] = useState<TiptapContent | ''>('')

  const applyTemplate = useCallback((headings: readonly string[] | undefined, currentDoc: Doc) => {
    if (!isUntouchedTemplate(currentDoc)) return false
    // A hand-edited settings JSON may hold anything; anything but a string
    // list is "no template" rather than a crash in every composer.
    const safe = Array.isArray(headings) ? headings.filter((h) => typeof h === 'string') : []
    setEditorSeed(buildTemplateDoc(safe))
    return true
  }, [])

  const insertTemplate = useCallback((headings: readonly string[], currentDoc: Doc) => {
    setEditorSeed(appendTemplate(currentDoc, headings))
  }, [])

  const finalize = useCallback((currentDoc: Doc) => finalizeTemplateDoc(currentDoc), [])
  const reset = useCallback(() => setEditorSeed(''), [])

  return { editorSeed, applyTemplate, insertTemplate, finalize, reset }
}
