import { supabase } from '@/lib/supabase';

// TypeScript interfaces for blog entities
export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  color: string;
  image_url?: string | null;
  post_count: number;
  is_featured: boolean;
  meta_title?: string | null;
  meta_description?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogTag {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  color: string;
  post_count: number;
  created_at: string;
  updated_at: string;
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  content: string;
  featured_image?: string | null;
  featured_image_alt?: string | null;
  status: 'draft' | 'published' | 'archived';
  visibility: 'public' | 'private' | 'password_protected';
  password?: string | null;

  // SEO fields
  meta_title?: string | null;
  meta_description?: string | null;
  canonical_url?: string | null;

  // Social media fields
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  twitter_title?: string | null;
  twitter_description?: string | null;
  twitter_image?: string | null;

  // Content management
  reading_time?: number;
  word_count?: number;
  allow_comments: boolean;
  is_featured: boolean;

  // Analytics
  view_count: number;
  like_count: number;
  share_count: number;

  // Timestamps
  published_at?: string | null;
  scheduled_for?: string | null;
  created_at: string;
  updated_at: string;

  // Relationships
  category_id?: string | null;
  author_id: string;

  // Populated relationships
  category?: BlogCategory;
  tags?: BlogTag[];
}

export interface BlogPostTag {
  id: string;
  post_id: string;
  tag_id: string;
  created_at: string;
}

export interface BlogServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Helper functions
export class BlogUtils {
  // Generate URL-friendly slug from text
  static generateSlug(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  }

  // Calculate estimated reading time (assuming 200 words per minute)
  static calculateReadingTime(content: string): number {
    const wordsPerMinute = 200;
    const wordCount = this.countWords(content);
    return Math.ceil(wordCount / wordsPerMinute);
  }

  // Count words in HTML content (strips HTML tags)
  static countWords(content: string): number {
    const textContent = content.replace(/<[^>]*>/g, ' '); // Remove HTML tags
    const words = textContent.trim().split(/\s+/).filter(word => word.length > 0);
    return words.length;
  }

  // Generate excerpt from content
  static generateExcerpt(content: string, maxLength: number = 160): string {
    const textContent = content.replace(/<[^>]*>/g, ' ').trim();
    if (textContent.length <= maxLength) return textContent;

    const truncated = textContent.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    return lastSpace > 0
      ? truncated.substring(0, lastSpace) + '...'
      : truncated + '...';
  }

  // Validate and ensure unique slug
  static async ensureUniqueSlug(
    baseSlug: string,
    table: 'blog_posts' | 'blog_categories' | 'blog_tags',
    excludeId?: string
  ): Promise<string> {
    let slug = baseSlug;
    let counter = 1;

    while (true) {
      const query = supabase
        .from(table)
        .select('id')
        .eq('slug', slug);

      if (excludeId) {
        query.neq('id', excludeId);
      }

      const { data, error } = await query;

      if (error) throw error;

      if (!data || data.length === 0) {
        return slug;
      }

      slug = `${baseSlug}-${counter}`;
      counter++;
    }
  }
}

// Blog Categories Service
export class BlogCategoriesService {
  static async getAll(): Promise<BlogServiceResponse<BlogCategory[]>> {
    try {
      const { data, error } = await supabase
        .from('blog_categories')
        .select('*')
        .order('name');

      if (error) throw error;

      return {
        success: true,
        data: data || []
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async getById(id: string): Promise<BlogServiceResponse<BlogCategory>> {
    try {
      const { data, error } = await supabase
        .from('blog_categories')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      return {
        success: true,
        data
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async create(category: Partial<BlogCategory>): Promise<BlogServiceResponse<BlogCategory>> {
    try {
      // Generate slug if not provided
      const slug = category.slug || BlogUtils.generateSlug(category.name || '');
      const uniqueSlug = await BlogUtils.ensureUniqueSlug(slug, 'blog_categories');

      const { data, error } = await supabase
        .from('blog_categories')
        .insert({
          ...category,
          slug: uniqueSlug
        })
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        data,
        message: 'Category created successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async update(id: string, updates: Partial<BlogCategory>): Promise<BlogServiceResponse<BlogCategory>> {
    try {
      // Generate new slug if name changed
      if (updates.name && !updates.slug) {
        updates.slug = await BlogUtils.ensureUniqueSlug(
          BlogUtils.generateSlug(updates.name),
          'blog_categories',
          id
        );
      }

      const { data, error } = await supabase
        .from('blog_categories')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        data,
        message: 'Category updated successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async delete(id: string): Promise<BlogServiceResponse<void>> {
    try {
      // Check authentication status
      const { data: { user } } = await supabase.auth.getUser();
      console.log('Current user:', user?.id || 'No user');

      const { data, error } = await supabase
        .from('blog_categories')
        .delete()
        .eq('id', id)
        .select();

      console.log('Delete category result:', { data, error, deletedRows: data?.length });

      if (error) throw error;

      // Check if any rows were actually deleted
      if (data?.length === 0) {
        console.warn('No rows deleted - likely RLS policy issue');
      }

      return {
        success: true,
        message: 'Category deleted successfully'
      };
    } catch (error: any) {
      console.error('Delete category error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Blog Tags Service
export class BlogTagsService {
  static async getAll(): Promise<BlogServiceResponse<BlogTag[]>> {
    try {
      const { data, error } = await supabase
        .from('blog_tags')
        .select('*')
        .order('name');

      if (error) throw error;

      return {
        success: true,
        data: data || []
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async create(tag: Partial<BlogTag>): Promise<BlogServiceResponse<BlogTag>> {
    try {
      const slug = tag.slug || BlogUtils.generateSlug(tag.name || '');
      const uniqueSlug = await BlogUtils.ensureUniqueSlug(slug, 'blog_tags');

      const { data, error } = await supabase
        .from('blog_tags')
        .insert({
          ...tag,
          slug: uniqueSlug
        })
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        data,
        message: 'Tag created successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async update(id: string, updates: Partial<BlogTag>): Promise<BlogServiceResponse<BlogTag>> {
    try {
      if (updates.name && !updates.slug) {
        updates.slug = await BlogUtils.ensureUniqueSlug(
          BlogUtils.generateSlug(updates.name),
          'blog_tags',
          id
        );
      }

      const { data, error } = await supabase
        .from('blog_tags')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        data,
        message: 'Tag updated successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async delete(id: string): Promise<BlogServiceResponse<void>> {
    try {
      const { data, error } = await supabase
        .from('blog_tags')
        .delete()
        .eq('id', id)
        .select();

      console.log('Delete tag result:', { data, error });

      if (error) throw error;

      return {
        success: true,
        message: 'Tag deleted successfully'
      };
    } catch (error: any) {
      console.error('Delete tag error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Blog Posts Service
export class BlogPostsService {
  static async getAll(filters?: {
    status?: string;
    category_id?: string;
    author_id?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<BlogServiceResponse<BlogPost[]>> {
    try {
      let query = supabase
        .from('blog_posts')
        .select(`
          *,
          category:blog_categories(*),
          tags:blog_post_tags(tag:blog_tags(*))
        `)
        .order('created_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.category_id) {
        query = query.eq('category_id', filters.category_id);
      }

      if (filters?.author_id) {
        query = query.eq('author_id', filters.author_id);
      }

      if (filters?.search) {
        query = query.or(`title.ilike.%${filters.search}%,content.ilike.%${filters.search}%`);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      if (filters?.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 10) - 1);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Transform the nested tags structure
      const posts = (data || []).map(post => ({
        ...post,
        tags: post.tags?.map((pt: any) => pt.tag) || []
      }));

      return {
        success: true,
        data: posts
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async getById(id: string): Promise<BlogServiceResponse<BlogPost>> {
    try {
      const { data, error } = await supabase
        .from('blog_posts')
        .select(`
          *,
          category:blog_categories(*),
          tags:blog_post_tags(tag:blog_tags(*))
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      // Transform the nested tags structure
      const post = {
        ...data,
        tags: data.tags?.map((pt: any) => pt.tag) || []
      };

      return {
        success: true,
        data: post
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async create(post: Partial<BlogPost>, tagIds?: string[]): Promise<BlogServiceResponse<BlogPost>> {
    try {
      // Calculate content metrics
      const content = post.content || '';
      const wordCount = BlogUtils.countWords(content);
      const readingTime = BlogUtils.calculateReadingTime(content);

      // Generate slug if not provided
      const slug = post.slug || BlogUtils.generateSlug(post.title || '');
      const uniqueSlug = await BlogUtils.ensureUniqueSlug(slug, 'blog_posts');

      // Auto-generate excerpt if not provided
      const excerpt = post.excerpt || BlogUtils.generateExcerpt(content);

      const postData = {
        ...post,
        slug: uniqueSlug,
        excerpt,
        word_count: wordCount,
        reading_time: readingTime,
        published_at: post.status === 'published' ? new Date().toISOString() : null
      };

      const { data, error } = await supabase
        .from('blog_posts')
        .insert(postData)
        .select()
        .single();

      if (error) throw error;

      // Handle tags if provided
      if (tagIds && tagIds.length > 0) {
        await this.updatePostTags(data.id, tagIds);
      }

      return {
        success: true,
        data,
        message: 'Blog post created successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async update(id: string, updates: Partial<BlogPost>, tagIds?: string[]): Promise<BlogServiceResponse<BlogPost>> {
    try {
      // Recalculate content metrics if content changed
      if (updates.content) {
        updates.word_count = BlogUtils.countWords(updates.content);
        updates.reading_time = BlogUtils.calculateReadingTime(updates.content);
      }

      // Auto-generate excerpt if not provided (consistent with create behavior)
      if (updates.content && !updates.excerpt) {
        updates.excerpt = BlogUtils.generateExcerpt(updates.content);
      }

      // Generate new slug if title changed
      if (updates.title && !updates.slug) {
        updates.slug = await BlogUtils.ensureUniqueSlug(
          BlogUtils.generateSlug(updates.title),
          'blog_posts',
          id
        );
      }

      // Set published_at if status changed to published
      if (updates.status === 'published' && !updates.published_at) {
        updates.published_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('blog_posts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // Handle tags if provided
      if (tagIds !== undefined) {
        await this.updatePostTags(id, tagIds);
      }

      return {
        success: true,
        data,
        message: 'Blog post updated successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async delete(id: string): Promise<BlogServiceResponse<void>> {
    try {
      const { error } = await supabase
        .from('blog_posts')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return {
        success: true,
        message: 'Blog post deleted successfully'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Helper method to update post tags
  private static async updatePostTags(postId: string, tagIds: string[]): Promise<void> {
    // First, remove existing tags
    await supabase
      .from('blog_post_tags')
      .delete()
      .eq('post_id', postId);

    // Then add new tags
    if (tagIds.length > 0) {
      const tagAssignments = tagIds.map(tagId => ({
        post_id: postId,
        tag_id: tagId
      }));

      await supabase
        .from('blog_post_tags')
        .insert(tagAssignments);
    }
  }

  // Get posts for public API (published only)
  static async getPublishedPosts(filters?: {
    category_slug?: string;
    tag_slug?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<BlogServiceResponse<BlogPost[]>> {
    try {
      let query = supabase
        .from('blog_posts')
        .select(`
          *,
          category:blog_categories(*),
          tags:blog_post_tags(tag:blog_tags(*))
        `)
        .eq('status', 'published')
        .eq('visibility', 'public')
        .order('published_at', { ascending: false });

      if (filters?.category_slug) {
        query = query.eq('category.slug', filters.category_slug);
      }

      if (filters?.search) {
        query = query.or(`title.ilike.%${filters.search}%,excerpt.ilike.%${filters.search}%`);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      if (filters?.offset) {
        query = query.range(filters.offset, filters.offset + (filters.limit || 10) - 1);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Transform the nested tags structure and filter by tag if needed
      let posts = (data || []).map(post => ({
        ...post,
        tags: post.tags?.map((pt: any) => pt.tag) || []
      }));

      // Filter by tag slug if provided (since we can't do this in the query easily)
      if (filters?.tag_slug) {
        posts = posts.filter(post =>
          post.tags?.some((tag: BlogTag) => tag.slug === filters.tag_slug)
        );
      }

      return {
        success: true,
        data: posts
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Increment view count
  static async incrementViewCount(id: string): Promise<BlogServiceResponse<void>> {
    try {
      const { error } = await supabase.rpc('blog_increment_post_views', {
        post_id: id
      });

      if (error) throw error;

      return {
        success: true
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}