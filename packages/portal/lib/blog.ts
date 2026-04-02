import { createClient } from '@supabase/supabase-js'

export interface BlogPostPreview {
  id: string
  title: string
  slug: string
  excerpt: string | null
  featured_image: string | null
  featured_image_alt: string | null
  published_at: string | null
  reading_time: number | null
  category: {
    name: string
    slug: string
    color: string
  } | null
}

export async function getBlogPosts(limit?: number): Promise<BlogPostPreview[]> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) return []

  const supabase = createClient(url, key, {
    global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) },
  })

  let query = supabase
    .from('blog_posts')
    .select(`
      id, title, slug, excerpt, featured_image, featured_image_alt,
      published_at, reading_time,
      category:blog_categories(name, slug, color)
    `)
    .eq('status', 'published')
    .eq('visibility', 'public')
    .order('published_at', { ascending: false })

  if (limit) {
    query = query.limit(limit)
  }

  const { data, error } = await query

  if (error) {
    console.error('[blog] Failed to fetch posts:', error)
    return []
  }

  return (data ?? []).map((row: any) => ({
    ...row,
    category: Array.isArray(row.category) ? row.category[0] ?? null : row.category,
  }))
}
