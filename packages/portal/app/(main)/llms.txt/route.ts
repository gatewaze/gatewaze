import { NextResponse } from 'next/server'
import { getServerBrandConfig } from '@/config/brand'

export async function GET() {
  const brandConfig = await getServerBrandConfig()
  const orgName = brandConfig.name
  const domain = brandConfig.domain

  const content = `# ${orgName} - Powered by Gatewaze

> Event and community management platform

## About
${orgName} uses Gatewaze, an open-source platform for managing events, communities, and member engagement.

## Capabilities
- Browse and search upcoming events (semantic search supported)
- Register for events (requires authentication)
- View event calendars and schedules
- AI-powered event discovery and networking recommendations

## API
- OpenAPI spec: https://${domain}/.well-known/openapi.json
- Semantic search: POST /api/ai-search (no auth required)
- AI chat: POST /api/chat (streaming, optional auth)
- MCP server: POST /api/mcp (Streamable HTTP, optional auth)

## Authentication
- Public endpoints: event listing, search, calendars, event details
- Authenticated endpoints: registration, profile management, networking matches
- Auth method: Supabase Auth (JWT Bearer token)
- Pass JWT as: Authorization: Bearer <token>

## Data Formats
- All API responses are JSON
- Structured data: Schema.org JSON-LD on event and profile pages
- Event dates: ISO 8601
`

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
