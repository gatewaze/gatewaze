import { supabase } from '@/lib/supabase';
import md5 from 'md5';

export type AvatarSource = 'uploaded' | 'linkedin' | 'gravatar';

const AVATAR_BUCKET = 'media';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export class PeopleAvatarService {
  /**
   * Initialize avatar storage bucket (run once)
   * This should be called during app initialization or manually via admin panel
   */
  static async initializeBucket(): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if bucket exists
      const { data: buckets } = await supabase.storage.listBuckets();
      const bucketExists = buckets?.some(b => b.name === AVATAR_BUCKET);

      if (!bucketExists) {
        // Create bucket
        const { error } = await supabase.storage.createBucket(AVATAR_BUCKET, {
          public: true,
          fileSizeLimit: MAX_FILE_SIZE,
          allowedMimeTypes: ALLOWED_TYPES
        });

        if (error) {
          return { success: false, error: error.message };
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Upload an avatar image for a person
   */
  static async uploadAvatar(
    personId: number,
    file: File
  ): Promise<{ success: boolean; error?: string; path?: string }> {
    try {
      // Validate file
      if (!ALLOWED_TYPES.includes(file.type)) {
        return { success: false, error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF' };
      }

      if (file.size > MAX_FILE_SIZE) {
        return { success: false, error: 'File too large. Maximum size: 5MB' };
      }

      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${personId}-${Date.now()}.${fileExt}`;
      const filePath = `people/${fileName}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        return { success: false, error: uploadError.message };
      }

      // Update person record
      const { error: updateError } = await supabase.rpc('people_update_avatar', {
        p_person_id: personId,
        p_avatar_source: 'uploaded',
        p_storage_path: filePath,
        p_linkedin_url: null
      });

      if (updateError) {
        // Rollback storage upload
        await supabase.storage.from(AVATAR_BUCKET).remove([filePath]);
        return { success: false, error: updateError.message };
      }

      return { success: true, path: filePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Download an image from a URL and store it in Supabase Storage
   */
  static async downloadAndStoreAvatar(
    personId: number,
    imageUrl: string,
    source: AvatarSource
  ): Promise<{ success: boolean; error?: string; path?: string }> {
    try {
      // Fetch image
      const response = await fetch(imageUrl);
      if (!response.ok) {
        return { success: false, error: `Failed to fetch image: ${response.statusText}` };
      }

      // Get blob
      const blob = await response.blob();

      // Validate size
      if (blob.size > MAX_FILE_SIZE) {
        return { success: false, error: 'Image too large. Maximum size: 5MB' };
      }

      // Validate type
      if (!ALLOWED_TYPES.includes(blob.type)) {
        return { success: false, error: `Invalid image type: ${blob.type}` };
      }

      // Generate filename
      const fileExt = blob.type.split('/')[1];
      const fileName = `${personId}-${source}-${Date.now()}.${fileExt}`;
      const filePath = `people/${fileName}`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(filePath, blob, {
          contentType: blob.type,
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        return { success: false, error: uploadError.message };
      }

      // Update person record
      const { error: updateError } = await supabase.rpc('people_update_avatar', {
        p_person_id: personId,
        p_avatar_source: source,
        p_storage_path: filePath,
        p_linkedin_url: source === 'linkedin' ? imageUrl : null
      });

      if (updateError) {
        // Rollback storage upload
        await supabase.storage.from(AVATAR_BUCKET).remove([filePath]);
        return { success: false, error: updateError.message };
      }

      return { success: true, path: filePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get LinkedIn profile image URL from LinkedIn profile URL
   * Note: This requires scraping or API access. For now, we'll extract from attributes.
   */
  static getLinkedInAvatarUrl(linkedinProfileUrl: string): string | null {
    // LinkedIn profile images require authentication or scraping
    // For now, we'll return null and handle this in the sync script
    // where we can use puppeteer or other scraping tools
    return null;
  }

  /**
   * Get Gravatar URL for an email
   */
  static getGravatarUrl(email: string, size: number = 200): string {
    const trimmedEmail = email.trim().toLowerCase();
    const hash = md5(trimmedEmail);
    return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=404`;
  }

  /**
   * Check if Gravatar exists for an email
   */
  static async checkGravatarExists(email: string): Promise<boolean> {
    try {
      const url = this.getGravatarUrl(email);
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Download Gravatar and store it
   */
  static async downloadGravatar(
    personId: number,
    email: string
  ): Promise<{ success: boolean; error?: string; path?: string }> {
    const gravatarUrl = this.getGravatarUrl(email);
    return this.downloadAndStoreAvatar(personId, gravatarUrl, 'gravatar');
  }

  /**
   * Get public URL for an avatar
   */
  static getAvatarPublicUrl(path: string): string {
    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  /**
   * Delete avatar from storage and clear person record
   */
  static async deleteAvatar(
    personId: number,
    storagePath: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .remove([storagePath]);

      if (storageError) {
        return { success: false, error: storageError.message };
      }

      // Clear person record
      const { error: updateError } = await supabase.rpc('people_clear_avatar', {
        p_person_id: personId
      });

      if (updateError) {
        return { success: false, error: updateError.message };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Sync avatar for a person using fallback logic:
   * 1. If uploaded avatar exists, keep it
   * 2. Try to get LinkedIn avatar
   * 3. Fall back to Gravatar
   */
  static async syncPersonAvatar(
    personId: number,
    email: string,
    linkedinAvatarUrl?: string
  ): Promise<{ success: boolean; error?: string; source?: AvatarSource }> {
    try {
      // Get current person data
      const { data: person, error: fetchError } = await supabase
        .from('people')
        .select('avatar_source, avatar_storage_path')
        .eq('id', personId)
        .single();

      if (fetchError) {
        return { success: false, error: fetchError.message };
      }

      // If uploaded avatar exists, don't override
      if (person?.avatar_source === 'uploaded') {
        return { success: true, source: 'uploaded' };
      }

      // Try LinkedIn avatar first
      if (linkedinAvatarUrl) {
        const result = await this.downloadAndStoreAvatar(
          personId,
          linkedinAvatarUrl,
          'linkedin'
        );
        if (result.success) {
          return { success: true, source: 'linkedin' };
        }
      }

      // Fall back to Gravatar
      const hasGravatar = await this.checkGravatarExists(email);
      if (hasGravatar) {
        const result = await this.downloadGravatar(personId, email);
        if (result.success) {
          return { success: true, source: 'gravatar' };
        }
      }

      return { success: false, error: 'No avatar source available' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
