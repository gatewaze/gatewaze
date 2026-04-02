import { redirect } from 'next/navigation'

// Redirect /calendars/[identifier] to /calendars/[identifier]/upcoming
export default async function CalendarIndexPage({
  params,
}: {
  params: Promise<{ identifier: string }>
}) {
  const { identifier } = await params
  redirect(`/calendars/${identifier}/upcoming`)
}
