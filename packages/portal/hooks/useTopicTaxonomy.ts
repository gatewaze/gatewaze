'use client'

import { useState, useEffect } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
export type TopicsData = Record<string, string[] | Record<string, string[]>>

interface Category {
  id: string
  name: string
  parent_id: string | null
  display_order: number
}

interface Membership {
  topic_id: string
  category_id: string
}

interface TopicRow {
  id: string
  name: string
  display_order: number
}

let cachedTaxonomy: TopicsData | null = null

function buildTopicsData(
  categories: Category[],
  topicRows: TopicRow[],
  memberships: Membership[]
): TopicsData {
  // Build category tree
  const catById = new Map<string, Category>()
  for (const c of categories) catById.set(c.id, c)

  const topLevelCats = categories
    .filter((c) => !c.parent_id)
    .sort((a, b) => a.display_order - b.display_order)

  const childrenOf = new Map<string, Category[]>()
  for (const c of categories) {
    if (c.parent_id) {
      if (!childrenOf.has(c.parent_id)) childrenOf.set(c.parent_id, [])
      childrenOf.get(c.parent_id)!.push(c)
    }
  }
  for (const [, children] of childrenOf) {
    children.sort((a, b) => a.display_order - b.display_order)
  }

  // Build topic name lookup
  const topicById = new Map<string, string>()
  const topicOrderById = new Map<string, number>()
  for (const t of topicRows) {
    topicById.set(t.id, t.name)
    topicOrderById.set(t.id, t.display_order)
  }

  // Build category → topic names map
  const topicsByCat = new Map<string, string[]>()
  for (const m of memberships) {
    const name = topicById.get(m.topic_id)
    if (!name) continue
    if (!topicsByCat.has(m.category_id)) topicsByCat.set(m.category_id, [])
    topicsByCat.get(m.category_id)!.push(name)
  }

  // Sort topics within each category by their display_order
  for (const [catId, topicNames] of topicsByCat) {
    // Build a name→order map for sorting
    const orderMap = new Map<string, number>()
    for (const m of memberships) {
      if (m.category_id === catId) {
        const name = topicById.get(m.topic_id)
        const order = topicOrderById.get(m.topic_id) ?? 999
        if (name) orderMap.set(name, order)
      }
    }
    topicNames.sort((a, b) => (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999))
  }

  const result: TopicsData = {}

  for (const topCat of topLevelCats) {
    const subcats = childrenOf.get(topCat.id)

    if (!subcats || subcats.length === 0) {
      // Flat category: string[]
      result[topCat.name] = topicsByCat.get(topCat.id) || []
    } else {
      // Nested category: Record<string, string[]>
      const nested: Record<string, string[]> = {}
      // Include any topics directly under the top-level category
      const directTopics = topicsByCat.get(topCat.id) || []
      if (directTopics.length > 0) {
        nested[topCat.name] = directTopics
      }
      for (const sub of subcats) {
        nested[sub.name] = topicsByCat.get(sub.id) || []
      }
      result[topCat.name] = nested
    }
  }

  return result
}

export function useTopicTaxonomy(): TopicsData {
  const [taxonomy, setTaxonomy] = useState<TopicsData>(cachedTaxonomy || {})

  useEffect(() => {
    if (cachedTaxonomy) {
      setTaxonomy(cachedTaxonomy)
      return
    }

    const supabase = getSupabaseClient()

    Promise.all([
      supabase.from('events_topic_categories').select('id, name, parent_id, display_order'),
      supabase.from('events_topics').select('id, name, display_order'),
      supabase.from('events_topic_category_memberships').select('topic_id, category_id'),
    ]).then(([catRes, topicRes, memRes]) => {
      if (catRes.error || topicRes.error || memRes.error) return

      const data = buildTopicsData(catRes.data, topicRes.data, memRes.data)
      cachedTaxonomy = data
      setTaxonomy(data)
    })
  }, [])

  return taxonomy
}
