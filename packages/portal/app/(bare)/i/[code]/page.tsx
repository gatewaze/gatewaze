import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ code: string }>
}

export default async function ShortLinkPage({ params }: Props) {
  const { code } = await params
  redirect(`/event-invites/${code}`)
}
