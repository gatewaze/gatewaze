export interface Calendar {
  id: string
  calendar_id: string
  name: string
  description: string | null
  slug: string | null
  color: string | null
  logo_url: string | null
  cover_image_url: string | null
  visibility: 'public' | 'private' | 'unlisted'
}
