/**
 * Markdown Converter
 *
 * Converts Markdown text (like Meetup event descriptions) to HTML.
 * Tracks images found in the content for later processing.
 */

import { marked } from 'marked';

/**
 * Markdown to HTML converter with image tracking
 */
export class MarkdownConverter {
  constructor() {
    this.images = [];

    // Configure marked options
    marked.setOptions({
      gfm: true, // GitHub Flavored Markdown
      breaks: true, // Convert line breaks to <br>
    });
  }

  /**
   * Convert Markdown to HTML
   * @param {string} markdown - The Markdown text
   * @returns {string} HTML output
   */
  convert(markdown) {
    if (!markdown) return '';

    this.images = [];

    // Pre-process: Extract and track image URLs
    const processedMarkdown = this._extractImages(markdown);

    // Convert Markdown to HTML
    const html = marked.parse(processedMarkdown);

    return html;
  }

  /**
   * Extract image URLs from Markdown
   * @param {string} markdown
   * @returns {string} Markdown with images tracked
   * @private
   */
  _extractImages(markdown) {
    // Match Markdown image syntax: ![alt](url)
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

    return markdown.replace(imageRegex, (match, alt, url) => {
      // Track the image URL
      if (url && !this.images.includes(url)) {
        this.images.push(url);
      }
      return match; // Keep original syntax, marked will convert it
    });
  }

  /**
   * Get list of image URLs found in the content
   * @returns {string[]}
   */
  getImages() {
    return [...this.images];
  }

  /**
   * Replace an image URL in HTML
   * @param {string} html - The HTML content
   * @param {string} originalUrl - Original image URL
   * @param {string} newUrl - New image URL
   * @returns {string} HTML with replaced URL
   */
  static replaceImageUrl(html, originalUrl, newUrl) {
    // Escape special regex characters in URL
    const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedUrl, 'g');
    return html.replace(regex, newUrl);
  }
}

export default MarkdownConverter;
