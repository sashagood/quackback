import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { listChangelogCategories } from '@/lib/server/domains/changelog/changelog-category.service'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const Route = createFileRoute('/api/v1/changelog/categories')({
  server: {
    handlers: {
      /**
       * GET /api/v1/changelog/categories
       * List changelog categories (labels) so integrations can resolve a label
       * name to its ID once and attach it to entries by ID afterwards.
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.CHANGELOG_VIEW_DRAFT })

          const categories = await listChangelogCategories()
          return successResponse(
            categories.map((category) => ({
              id: category.id,
              name: category.name,
              color: category.color,
              position: category.position,
            }))
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
