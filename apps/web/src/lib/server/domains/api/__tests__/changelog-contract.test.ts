import { describe, expect, it } from 'vitest'
import '../schemas'
import { generateOpenAPISpec } from '../openapi'

describe('changelog OpenAPI contract', () => {
  const spec = generateOpenAPISpec()
  const collection = spec.paths?.['/changelog'] as {
    get?: unknown
    post?: { requestBody?: unknown; responses?: unknown }
  }
  const detail = spec.paths?.['/changelog/{entryId}'] as {
    get?: { responses?: unknown }
    patch?: { requestBody?: unknown; responses?: unknown }
  }

  const categories = spec.paths?.['/changelog/categories'] as {
    get?: { responses?: unknown }
  }

  it('documents categories on create and update bodies', () => {
    const createBody = JSON.stringify(collection.post?.requestBody)
    const updateBody = JSON.stringify(detail.patch?.requestBody)

    expect(createBody).toContain('"categories"')
    expect(updateBody).toContain('"categories"')
  })

  it('documents categories on list, get, create, and update responses', () => {
    for (const part of [
      collection.get,
      collection.post?.responses,
      detail.get?.responses,
      detail.patch?.responses,
    ]) {
      expect(JSON.stringify(part)).toContain('"categories"')
    }
  })

  it('documents GET /changelog/categories with id, name, color, and position', () => {
    expect(categories?.get).toBeDefined()
    const response = JSON.stringify(categories.get?.responses)
    for (const field of ['"id"', '"name"', '"color"', '"position"']) {
      expect(response).toContain(field)
    }
  })

  it('documents linkedPostIds on create and update bodies', () => {
    const createBody = JSON.stringify(collection.post?.requestBody)
    const updateBody = JSON.stringify(detail.patch?.requestBody)

    expect(createBody).toContain('linkedPostIds')
    expect(updateBody).toContain('linkedPostIds')
  })

  it('documents linkedPosts on list, get, create, and update responses', () => {
    const listResponse = JSON.stringify(collection.get)
    const createResponse = JSON.stringify(collection.post?.responses)
    const getResponse = JSON.stringify(detail.get?.responses)
    const patchResponse = JSON.stringify(detail.patch?.responses)

    expect(listResponse).toContain('linkedPosts')
    expect(createResponse).toContain('linkedPosts')
    expect(getResponse).toContain('linkedPosts')
    expect(patchResponse).toContain('linkedPosts')
  })
})
