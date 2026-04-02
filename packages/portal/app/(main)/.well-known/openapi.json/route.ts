import { NextResponse } from 'next/server'
import { getServerBrandConfig } from '@/config/brand'

export async function GET() {
  const brandConfig = await getServerBrandConfig()
  const domain = brandConfig.domain

  const spec = {
    openapi: '3.1.0',
    info: {
      title: `${brandConfig.name} API`,
      description: `API for ${brandConfig.name}, powered by Gatewaze — an open-source event and community management platform.`,
      version: '1.0.0',
      contact: {
        name: brandConfig.name,
        url: `https://${domain}`,
      },
    },
    servers: [
      { url: `https://${domain}`, description: 'Production' },
    ],
    paths: {
      '/api/health': {
        get: {
          summary: 'Health check',
          operationId: 'getHealth',
          tags: ['System'],
          responses: {
            '200': {
              description: 'Service is healthy',
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] } } } } },
            },
          },
        },
      },
      '/api/ai-search': {
        post: {
          summary: 'Semantic event search',
          description: 'Search for events and blog posts using natural language. Combines keyword matching with vector similarity search.',
          operationId: 'searchEvents',
          tags: ['Search'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SearchRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Search results',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      results: { type: 'array', items: { $ref: '#/components/schemas/SearchResult' } },
                      summary: { type: 'string' },
                    },
                  },
                },
              },
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '500': { $ref: '#/components/responses/InternalError' },
          },
        },
      },
      '/api/chat': {
        post: {
          summary: 'AI chat (streaming)',
          description: 'Conversational AI assistant for event discovery, registration, and networking. Returns a Server-Sent Events stream using the Vercel AI SDK Data Stream Protocol.',
          operationId: 'chat',
          tags: ['AI'],
          security: [{ BearerAuth: [] }, {}],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'SSE stream of AI responses and tool results',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '429': { $ref: '#/components/responses/RateLimited' },
            '500': { $ref: '#/components/responses/InternalError' },
            '503': {
              description: 'Chat feature disabled',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/api/events': {
        get: {
          summary: 'List events',
          description: 'Returns a paginated list of events, ordered by start date descending.',
          operationId: 'listEvents',
          tags: ['Events'],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 100 } },
            { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Filter by event title' },
          ],
          responses: {
            '200': {
              description: 'Paginated event list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/EventSummary' } },
                      total: { type: 'integer' },
                      page: { type: 'integer' },
                      limit: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '500': { $ref: '#/components/responses/InternalError' },
          },
        },
      },
      '/api/events/{identifier}': {
        get: {
          summary: 'Get event details',
          description: 'Returns full details for a single event by UUID.',
          operationId: 'getEvent',
          tags: ['Events'],
          parameters: [
            { name: 'identifier', in: 'path', required: true, schema: { type: 'string' }, description: 'Event UUID' },
          ],
          responses: {
            '200': {
              description: 'Event details',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/EventDetail' } } },
            },
            '404': { description: 'Event not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            '500': { $ref: '#/components/responses/InternalError' },
          },
        },
      },
      '/api/calendars/{slug}': {
        get: {
          summary: 'Get calendar events',
          description: 'Returns events for a specific calendar by slug.',
          operationId: 'getCalendarEvents',
          tags: ['Calendars'],
          parameters: [
            { name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: {
            '200': {
              description: 'Calendar events',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/CalendarEvent' } },
                },
              },
            },
            '404': { description: 'Calendar not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            '500': { $ref: '#/components/responses/InternalError' },
          },
        },
      },
      '/api/registrations': {
        post: {
          summary: 'Register for an event',
          description: 'Register the authenticated user for an event. User identity is derived from the JWT token.',
          operationId: 'registerForEvent',
          tags: ['Registration'],
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RegistrationRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Registration successful',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Registration' } } },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { description: 'Event not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            '409': { description: 'Already registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
            '500': { $ref: '#/components/responses/InternalError' },
          },
        },
      },
      '/api/mcp': {
        post: {
          summary: 'MCP Streamable HTTP endpoint',
          description: 'Model Context Protocol server for AI agent integration. Accepts MCP JSON-RPC messages.',
          operationId: 'mcpEndpoint',
          tags: ['MCP'],
          security: [{ BearerAuth: [] }, {}],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { type: 'object', description: 'MCP JSON-RPC request' },
              },
            },
          },
          responses: {
            '200': {
              description: 'MCP JSON-RPC response',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '500': { $ref: '#/components/responses/InternalError' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Supabase Auth JWT token. Obtain via Supabase Auth sign-in flow.',
        },
      },
      schemas: {
        SearchRequest: {
          type: 'object',
          required: ['query', 'brandId'],
          properties: {
            query: { type: 'string', description: 'Natural language search query' },
            brandId: { type: 'string', description: 'Brand identifier' },
            contentTypes: { type: 'array', items: { type: 'string', enum: ['events', 'blog'] }, description: 'Content types to search' },
            userLocation: {
              type: 'object',
              properties: { lat: { type: 'number' }, lng: { type: 'number' } },
              description: 'User location for proximity scoring',
            },
          },
        },
        SearchResult: {
          type: 'object',
          properties: {
            content_type: { type: 'string', enum: ['event', 'blog'] },
            id: { type: 'string' },
            slug: { type: 'string' },
            title: { type: 'string' },
            relevance_score: { type: 'number', minimum: 0, maximum: 100 },
            match_reason: { type: 'string' },
            is_upcoming: { type: 'boolean' },
            image_url: { type: 'string', nullable: true },
            subtitle: { type: 'string', nullable: true },
          },
        },
        ChatRequest: {
          type: 'object',
          required: ['messages'],
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                  role: { type: 'string', enum: ['user', 'assistant'] },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        EventSummary: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            event_id: { type: 'string' },
            event_title: { type: 'string' },
            event_slug: { type: 'string' },
            event_start: { type: 'string', format: 'date-time' },
            event_end: { type: 'string', format: 'date-time', nullable: true },
            event_city: { type: 'string', nullable: true },
            event_country_code: { type: 'string', nullable: true },
            event_logo: { type: 'string', nullable: true },
            screenshot_url: { type: 'string', nullable: true },
          },
        },
        EventDetail: {
          type: 'object',
          allOf: [
            { $ref: '#/components/schemas/EventSummary' },
            {
              type: 'object',
              properties: {
                event_description: { type: 'string', nullable: true },
                event_location: { type: 'string', nullable: true },
                venue_address: { type: 'string', nullable: true },
                event_link: { type: 'string', nullable: true },
                enable_registration: { type: 'boolean', nullable: true },
                listing_intro: { type: 'string', nullable: true },
                _links: { $ref: '#/components/schemas/HATEOASLinks' },
              },
            },
          ],
        },
        CalendarEvent: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time', nullable: true },
            url: { type: 'string' },
          },
        },
        HATEOASLinks: {
          type: 'object',
          properties: {
            self: { $ref: '#/components/schemas/Link' },
            register: { $ref: '#/components/schemas/Link' },
            speakers: { $ref: '#/components/schemas/Link' },
            calendar: { $ref: '#/components/schemas/Link' },
          },
        },
        Link: {
          type: 'object',
          required: ['href'],
          properties: {
            href: { type: 'string' },
            method: { type: 'string' },
          },
        },
        RegistrationRequest: {
          type: 'object',
          required: ['eventId'],
          properties: {
            eventId: { type: 'string', description: 'Event UUID to register for' },
          },
        },
        Registration: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            eventId: { type: 'string' },
            userId: { type: 'string' },
            status: { type: 'string', enum: ['confirmed', 'pending'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Bad request',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        Unauthorized: {
          description: 'Unauthorized — invalid or missing JWT',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        RateLimited: {
          description: 'Rate limit exceeded',
          headers: { 'Retry-After': { schema: { type: 'integer' }, description: 'Seconds to wait before retrying' } },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
        InternalError: {
          description: 'Internal server error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
        },
      },
    },
  }

  return NextResponse.json(spec, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
