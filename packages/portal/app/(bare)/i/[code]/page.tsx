import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ code: string }>
}

// Legacy redirect: /i/{code} → /rsvp/{code}
export default async function LegacyShortLinkRedirect({ params }: Props) {
  const { code } = await params
  redirect(`/rsvp/${code}`)
}
