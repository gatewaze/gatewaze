interface OrganizationJsonLdProps {
  name: string
  url: string
  logoUrl?: string
  description?: string
  sameAs?: string[]
}

export function OrganizationJsonLd({ name, url, logoUrl, description, sameAs }: OrganizationJsonLdProps) {
  if (!name) return null

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    url,
    ...(logoUrl && { logo: logoUrl }),
    ...(description && { description }),
    ...(sameAs && sameAs.length > 0 && { sameAs }),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}
