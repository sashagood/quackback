import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { updateBoardSchema, type UpdateBoardInput } from '@/lib/shared/schemas/boards'
import {
  parseTemplateText,
  readBoardTemplate,
  validateBoardTemplate,
} from '@/lib/shared/post-templates'
import {
  BOARD_TEMPLATE_HEADING_MAX_LENGTH,
  BOARD_TEMPLATE_MAX_HEADINGS,
  type BoardSettings,
} from '@/lib/shared/db-types'
import { Input } from '@/components/ui/input'
import { FormError } from '@/components/shared/form-error'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { useNavigate } from '@tanstack/react-router'
import { useUpdateBoard } from '@/lib/client/mutations'
import type { BoardId } from '@quackback/ids'

interface Board {
  id: BoardId
  name: string
  slug: string
  description: string | null
  settings?: BoardSettings
}

interface BoardGeneralFormProps {
  board: Board
}

export function BoardGeneralForm({ board }: BoardGeneralFormProps) {
  const mutation = useUpdateBoard()
  const navigate = useNavigate()

  const [templateError, setTemplateError] = useState<string | null>(null)

  const form = useForm<UpdateBoardInput>({
    resolver: standardSchemaResolver(updateBoardSchema),
    defaultValues: {
      name: board.name,
      description: board.description || '',
      // readBoardTemplate: a hand-edited settings JSON must not crash the page.
      templateText: readBoardTemplate(board.settings?.template).join('\n'),
    },
  })

  function onSubmit(data: UpdateBoardInput) {
    // The textarea is parsed (one heading per line) and validated with the
    // same rules the server applies; the server merges `settings` so the
    // board's other settings (custom fields, roadmap statuses) survive.
    const parsed = validateBoardTemplate(parseTemplateText(data.templateText ?? ''))
    if (!parsed.ok) {
      setTemplateError(parsed.message)
      return
    }
    setTemplateError(null)
    mutation.mutate(
      {
        id: board.id,
        name: data.name,
        description: data.description,
        settings: { template: parsed.value },
      },
      {
        onSuccess: (updated) => {
          if (updated.slug !== board.slug) {
            void navigate({
              to: '/admin/settings/boards/$slug',
              params: { slug: updated.slug },
              search: {},
              replace: true,
            })
          }
        },
      }
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {mutation.isError && <FormError message={mutation.error?.message ?? 'An error occurred'} />}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Board name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="templateText"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Post template</FormLabel>
              <FormControl>
                <Textarea
                  rows={5}
                  placeholder={'What went wrong?\nWhat should happen?'}
                  {...field}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                One heading per line, up to {BOARD_TEMPLATE_MAX_HEADINGS} headings of{' '}
                {BOARD_TEMPLATE_HEADING_MAX_LENGTH} characters. New posts on this board start with
                these as section headings; leave empty for none.
              </p>
              {templateError && <p className="text-sm text-destructive">{templateError}</p>}
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
