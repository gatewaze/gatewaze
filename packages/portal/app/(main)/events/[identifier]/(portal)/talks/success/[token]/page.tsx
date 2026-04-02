import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ identifier: string; token: string }>
}

// This route handles magic link redirects where the token is in the path
// e.g., /events/ujgf08/talks/success/abc123token
// It redirects to the main success page with the token as a query parameter
export default async function SpeakerSuccessTokenRedirect({ params }: Props) {
  const { identifier, token } = await params

  // Redirect to the main success page with the token as a query param
  redirect(`/events/${identifier}/talks/success?token=${token}`)
}
