import React, { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  PhotoIcon,
  XMarkIcon,
  CloudArrowUpIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../ui/Button';
import {
  uploadEventLogo,
  deleteEventLogo,
  updateEventLogo,
  extractEventLogoPath,
  validateImageFile,
} from '@/utils/eventLogoUpload';
import LoadingSpinner from '@/components/shared/LoadingSpinner';

interface EventImageUploadProps {
  value?: string;
  onChange: (url: string | null) => void;
  eventId: string;
  type: 'logo' | 'badge' | 'screenshot';
  label?: string;
  placeholder?: string;
  accept?: string;
  maxSizeInMB?: number;
  className?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export const EventImageUpload: React.FC<EventImageUploadProps> = ({
  value,
  onChange,
  eventId,
  type,
  label = 'Image',
  placeholder = 'Upload an image or enter URL',
  accept = 'image/*',
  maxSizeInMB = 5,
  className = '',
  error,
  required = false,
  disabled = false,
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [urlInput, setUrlInput] = useState(value || '');
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(
    async (file: File) => {
      if (disabled) return;

      // Validate file
      const validation = validateImageFile(file, { maxSizeInMB });
      if (!validation.valid) {
        toast.error(validation.error || 'Invalid file');
        return;
      }

      setIsUploading(true);

      try {
        // If we're updating an existing image, delete the old one
        const currentImagePath = value ? extractEventLogoPath(value) : null;

        let result;
        if (currentImagePath) {
          result = await updateEventLogo(currentImagePath, file, eventId, type);
        } else {
          result = await uploadEventLogo(file, eventId, type);
        }

        if (result.success && result.url) {
          onChange(result.url);
          setUrlInput(result.url);
          toast.success('Image uploaded successfully');
        } else {
          toast.error(result.error || 'Upload failed');
        }
      } catch (error) {
        toast.error('An unexpected error occurred');
        console.error('Upload error:', error);
      } finally {
        setIsUploading(false);
      }
    },
    [value, onChange, eventId, type, maxSizeInMB, disabled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (disabled || isUploading) return;

      const files = Array.from(e.dataTransfer.files);
      const imageFile = files.find((file) => file.type.startsWith('image/'));

      if (imageFile) {
        handleFileUpload(imageFile);
      } else {
        toast.error('Please drop an image file');
      }
    },
    [handleFileUpload, disabled, isUploading]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled && !isUploading) {
        setDragActive(true);
      }
    },
    [disabled, isUploading]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload]
  );

  const handleUrlSubmit = useCallback(() => {
    if (!urlInput.trim()) {
      onChange(null);
      return;
    }

    try {
      new URL(urlInput); // Validate URL
      onChange(urlInput);
      toast.success('Image URL updated');
    } catch {
      toast.error('Please enter a valid URL');
    }
  }, [urlInput, onChange]);

  const handleRemoveImage = useCallback(async () => {
    if (disabled) return;

    const imagePath = value ? extractEventLogoPath(value) : null;

    if (imagePath) {
      try {
        await deleteEventLogo(imagePath);
        toast.success('Image removed from storage');
      } catch (error) {
        console.error('Failed to delete image:', error);
        // Continue with removal even if delete fails
      }
    }

    onChange(null);
    setUrlInput('');
  }, [value, onChange, disabled]);

  const openFileDialog = useCallback(() => {
    if (!disabled && !isUploading) {
      fileInputRef.current?.click();
    }
  }, [disabled, isUploading]);

  const hasImage = Boolean(value);

  return (
    <div className={`space-y-3 ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {/* Mode Toggle */}
      <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
        <button
          type="button"
          onClick={() => setMode('upload')}
          className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
            mode === 'upload'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
          disabled={disabled}
        >
          <CloudArrowUpIcon className="w-4 h-4 inline mr-2" />
          Upload
        </button>
        <button
          type="button"
          onClick={() => setMode('url')}
          className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
            mode === 'url'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
          disabled={disabled}
        >
          URL
        </button>
      </div>

      {mode === 'upload' ? (
        <div className="space-y-3">
          {/* Current Image Preview */}
          {hasImage && (
            <div className="relative">
              <img
                src={value}
                alt={`${type} preview`}
                className="w-full h-40 object-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
              <button
                type="button"
                onClick={handleRemoveImage}
                disabled={disabled || isUploading}
                className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Upload Area */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`
              relative border-2 border-dashed rounded-lg p-6 transition-colors cursor-pointer
              ${
                dragActive
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            onClick={openFileDialog}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              onChange={handleFileSelect}
              disabled={disabled || isUploading}
              className="hidden"
            />

            <div className="text-center">
              {isUploading ? (
                <>
                  <div className="mx-auto mb-2">
                    <LoadingSpinner size="medium" />
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Uploading...</p>
                </>
              ) : (
                <>
                  <PhotoIcon className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="mt-2">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      <span className="font-medium text-blue-600 hover:text-blue-500">
                        Click to upload
                      </span>{' '}
                      or drag and drop
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      PNG, JPG, WebP, SVG up to {maxSizeInMB}MB
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* URL Input Mode */}
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={placeholder}
              disabled={disabled}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
            />
            <Button type="button" onClick={handleUrlSubmit} disabled={disabled} variant="outline">
              Set URL
            </Button>
          </div>

          {/* URL Image Preview */}
          {hasImage && urlInput === value && (
            <div className="relative">
              <img
                src={value}
                alt={`${type} URL preview`}
                className="w-full h-40 object-contain rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
              />
              <button
                type="button"
                onClick={handleRemoveImage}
                disabled={disabled}
                className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                <XMarkIcon className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center space-x-2 text-red-600 dark:text-red-400">
          <ExclamationTriangleIcon className="w-4 h-4" />
          <span className="text-sm">{error}</span>
        </div>
      )}
    </div>
  );
};

export default EventImageUpload;
