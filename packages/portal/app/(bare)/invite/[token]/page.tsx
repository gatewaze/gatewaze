import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ token: string }>
}

// Legacy invite route — redirect to short link handler which resolves the event
export default async function LegacyInvitePage({ params }: Props) {
  const { token } = await params
  // Reuse the /i/ short link logic
  redirect(`/i/${token}`)
}
