import { redirect } from 'next/navigation'

// Redirect homepage to upcoming events
// The homepage will eventually have custom content, but for now redirects to events
export default function HomePage() {
  redirect('/events/upcoming')
}
