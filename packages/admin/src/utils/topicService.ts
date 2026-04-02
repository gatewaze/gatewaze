import { supabase } from '@/lib/supabase';

export interface TopicOption {
  value: string;
  label: string;
  category: string;
}

// Module-level cache — shared across component instances within a session
let cachedTopics: TopicOption[] | null = null;
let cachePromise: Promise<TopicOption[]> | null = null;

async function fetchTopics(): Promise<TopicOption[]> {
  const [topicsRes, membershipsRes, categoriesRes] = await Promise.all([
    supabase.from('events_topics').select('id, name').order('display_order'),
    supabase.from('events_topic_category_memberships').select('topic_id, category_id'),
    supabase.from('events_topic_categories').select('id, name, parent_id'),
  ]);

  if (topicsRes.error) throw topicsRes.error;
  if (membershipsRes.error) throw membershipsRes.error;
  if (categoriesRes.error) throw categoriesRes.error;

  const catNameMap = new Map<string, string>();
  for (const c of categoriesRes.data || []) {
    catNameMap.set(c.id, c.name);
  }

  // Build topic → primary category name map (use first membership's category)
  const topicCategoryMap = new Map<string, string>();
  for (const m of membershipsRes.data || []) {
    if (!topicCategoryMap.has(m.topic_id)) {
      topicCategoryMap.set(m.topic_id, catNameMap.get(m.category_id) || 'Uncategorized');
    }
  }

  return (topicsRes.data || []).map((t) => ({
    value: t.name,
    label: t.name,
    category: topicCategoryMap.get(t.id) || 'Uncategorized',
  }));
}

export const getAllTopics = async (): Promise<TopicOption[]> => {
  if (cachedTopics) return cachedTopics;

  if (!cachePromise) {
    cachePromise = fetchTopics().then((topics) => {
      cachedTopics = topics;
      cachePromise = null;
      return topics;
    }).catch((err) => {
      cachePromise = null;
      throw err;
    });
  }

  return cachePromise;
};

export const searchTopics = async (query: string): Promise<TopicOption[]> => {
  const allTopics = await getAllTopics();
  const lowerQuery = query.toLowerCase();
  return allTopics.filter(
    (topic) =>
      topic.label.toLowerCase().includes(lowerQuery) ||
      topic.category.toLowerCase().includes(lowerQuery)
  );
};

export const getTopicsByCategory = async (): Promise<Record<string, TopicOption[]>> => {
  const topics = await getAllTopics();
  const categorized: Record<string, TopicOption[]> = {};
  for (const topic of topics) {
    if (!categorized[topic.category]) categorized[topic.category] = [];
    categorized[topic.category].push(topic);
  }
  return categorized;
};

/** Invalidate the cache (call after admin edits topics) */
export const invalidateTopicCache = () => {
  cachedTopics = null;
  cachePromise = null;
};
