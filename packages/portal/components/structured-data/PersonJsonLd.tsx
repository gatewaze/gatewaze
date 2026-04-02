interface PersonJsonLdProps {
  name: string
  jobTitle?: string
  company?: string
  imageUrl?: string
  url?: string
}

export function PersonJsonLd({ name, jobTitle, company, imageUrl, url }: PersonJsonLdProps) {
  if (!name) return null

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
    ...(jobTitle && { jobTitle }),
    ...(company && { worksFor: { '@type': 'Organization', name: company } }),
    ...(imageUrl && { image: imageUrl }),
    ...(url && { url }),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  )
}
