import type { Request, Response, NextFunction } from 'express'

interface HATEOASLink {
  href: string
  method?: string
}

interface HATEOASLinks {
  self?: HATEOASLink
  register?: HATEOASLink
  speakers?: HATEOASLink
  calendar?: HATEOASLink
}

function isEvent(obj: Record<string, unknown>): boolean {
  return typeof obj.event_id === 'string' && typeof obj.event_title === 'string' && 'event_start' in obj
}

function isRegistration(obj: Record<string, unknown>): boolean {
  return typeof obj.id === 'string' && typeof obj.event_id === 'string' && 'user_id' in obj
}

function isPerson(obj: Record<string, unknown>): boolean {
  return typeof obj.id === 'string' && typeof obj.first_name === 'string' && typeof obj.last_name === 'string'
}

function addEventLinks(event: Record<string, unknown>): HATEOASLinks {
  const id = event.event_id || event.id
  const links: HATEOASLinks = {
    self: { href: `/api/events/${id}` },
  }

  if (event.enable_registration === true || event.registration_status === 'open') {
    links.register = { href: '/api/registrations', method: 'POST' }
  }

  return links
}

function addRegistrationLinks(reg: Record<string, unknown>): HATEOASLinks {
  return {
    self: { href: `/api/registrations/${reg.id}` },
  }
}

function addPersonLinks(person: Record<string, unknown>): HATEOASLinks {
  return {
    self: { href: `/api/people/${person.id}` },
  }
}

function injectLinks(obj: Record<string, unknown>): Record<string, unknown> {
  if (isEvent(obj)) {
    return { ...obj, _links: addEventLinks(obj) }
  }
  if (isRegistration(obj)) {
    return { ...obj, _links: addRegistrationLinks(obj) }
  }
  if (isPerson(obj)) {
    return { ...obj, _links: addPersonLinks(obj) }
  }
  return obj
}

export function hateoasMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res)

  res.json = function (body: unknown) {
    try {
      if (body && typeof body === 'object') {
        if (Array.isArray(body)) {
          body = body.map((item) =>
            item && typeof item === 'object' ? injectLinks(item as Record<string, unknown>) : item,
          )
        } else {
          const obj = body as Record<string, unknown>
          // Handle paginated responses with a data array
          if (Array.isArray(obj.data)) {
            obj.data = obj.data.map((item: unknown) =>
              item && typeof item === 'object' ? injectLinks(item as Record<string, unknown>) : item,
            )
            body = obj
          } else {
            body = injectLinks(obj)
          }
        }
      }
    } catch (err) {
      // Fail open — return original response without _links
      console.error('HATEOAS middleware error:', err)
    }

    return originalJson(body)
  }

  next()
}
