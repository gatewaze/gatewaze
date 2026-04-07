import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ token: string }>
}

// Legacy route — redirect to module-managed invite page
export default async function LegacyInvitePage({ params }: Props) {
  const { token } = await params
  redirect(`/event-invites/${token}`)
}
