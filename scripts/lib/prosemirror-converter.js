/**
 * ProseMirror to HTML Converter
 *
 * Converts ProseMirror JSON documents (from Luma's description_mirror)
 * to HTML. Tracks image URLs for later processing.
 */

/**
 * @typedef {Object} ProseMirrorNode
 * @property {string} type - Node type (doc, paragraph, text, image, etc.)
 * @property {Array<ProseMirrorNode>} [content] - Child nodes
 * @property {string} [text] - Text content (for text nodes)
 * @property {Array<Object>} [marks] - Formatting marks (bold, italic, link)
 * @property {Object} [attrs] - Node attributes
 */

/**
 * @typedef {Object} ImageInfo
 * @property {string} originalUrl - Original URL from lumacdn.com
 * @property {number} index - Position in the document
 * @property {string} [alt] - Alt text if provided
 * @property {number} [width] - Original width
 * @property {number} [height] - Original height
 */

export class ProseMirrorConverter {
  constructor() {
    this.images = [];
    this.imageIndex = 0;
  }

  /**
   * Convert a ProseMirror document to HTML
   * @param {ProseMirrorNode} doc - The ProseMirror document
   * @returns {string} HTML string
   */
  convert(doc) {
    if (!doc || doc.type !== 'doc') {
      return '';
    }
    this.images = [];
    this.imageIndex = 0;
    return this.processNodes(doc.content || []);
  }

  /**
   * Get all images found during conversion
   * @returns {Array<ImageInfo>}
   */
  getImages() {
    return this.images;
  }

  /**
   * Process an array of nodes
   * @param {Array<ProseMirrorNode>} nodes
   * @returns {string}
   */
  processNodes(nodes) {
    if (!nodes || !Array.isArray(nodes)) {
      return '';
    }
    return nodes.map((node) => this.processNode(node)).join('');
  }

  /**
   * Process a single node
   * @param {ProseMirrorNode} node
   * @returns {string}
   */
  processNode(node) {
    if (!node) return '';

    switch (node.type) {
      case 'paragraph': {
        const content = this.processInlineContent(node.content || []);
        // Don't wrap empty paragraphs
        return content ? `<p>${content}</p>\n` : '';
      }

      case 'heading': {
        const level = node.attrs?.level || 2;
        const content = this.processInlineContent(node.content || []);
        return `<h${level}>${content}</h${level}>\n`;
      }

      case 'bullet_list':
        return `<ul>\n${this.processNodes(node.content || [])}</ul>\n`;

      case 'ordered_list':
        return `<ol>\n${this.processNodes(node.content || [])}</ol>\n`;

      case 'list_item':
        return `<li>${this.processNodes(node.content || [])}</li>\n`;

      case 'blockquote':
        return `<blockquote>\n${this.processNodes(node.content || [])}</blockquote>\n`;

      case 'code_block': {
        const content = this.processInlineContent(node.content || []);
        const lang = node.attrs?.language || '';
        return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${content}</code></pre>\n`;
      }

      case 'horizontal_rule':
        return '<hr />\n';

      case 'image': {
        const src = node.attrs?.src || '';
        const alt = node.attrs?.alt || '';
        const width = node.attrs?.width;
        const height = node.attrs?.height;

        // Track images from lumacdn for later migration
        if (src.includes('lumacdn.com') || src.includes('images.lumacdn.com')) {
          this.images.push({
            originalUrl: src,
            index: this.imageIndex,
            alt,
            width,
            height,
          });
        }
        this.imageIndex++;

        // Build image tag with optional dimensions
        let imgTag = `<img src="${this.escapeHtml(src)}" alt="${this.escapeHtml(alt)}"`;
        if (width) imgTag += ` width="${width}"`;
        if (height) imgTag += ` height="${height}"`;
        imgTag += ' />';
        return imgTag + '\n';
      }

      case 'hard_break':
        return '<br />';

      case 'text':
        return this.processTextNode(node);

      default:
        // For unknown block nodes, try to process their content
        if (node.content) {
          return this.processNodes(node.content);
        }
        return '';
    }
  }

  /**
   * Process inline content (text nodes with marks)
   * @param {Array<ProseMirrorNode>} content
   * @returns {string}
   */
  processInlineContent(content) {
    if (!content || !Array.isArray(content)) {
      return '';
    }
    return content.map((item) => this.processInlineNode(item)).join('');
  }

  /**
   * Process an inline node (text or other inline elements)
   * @param {ProseMirrorNode} node
   * @returns {string}
   */
  processInlineNode(node) {
    if (!node) return '';

    if (node.type === 'text') {
      return this.processTextNode(node);
    }

    if (node.type === 'hard_break') {
      return '<br />';
    }

    if (node.type === 'image') {
      return this.processNode(node);
    }

    // For other inline nodes, process their content
    if (node.content) {
      return this.processInlineContent(node.content);
    }

    return '';
  }

  /**
   * Process a text node with marks
   * @param {ProseMirrorNode} node
   * @returns {string}
   */
  processTextNode(node) {
    if (node.type !== 'text' || !node.text) {
      return '';
    }

    let text = this.escapeHtml(node.text);

    // Apply marks in order (inner to outer)
    const marks = node.marks || [];
    for (const mark of marks) {
      text = this.applyMark(text, mark);
    }

    return text;
  }

  /**
   * Apply a mark to text
   * @param {string} text
   * @param {Object} mark
   * @returns {string}
   */
  applyMark(text, mark) {
    switch (mark.type) {
      case 'bold':
      case 'strong':
        return `<strong>${text}</strong>`;

      case 'italic':
      case 'em':
        return `<em>${text}</em>`;

      case 'underline':
        return `<u>${text}</u>`;

      case 'strike':
      case 'strikethrough':
        return `<s>${text}</s>`;

      case 'code':
        return `<code>${text}</code>`;

      case 'link': {
        const href = mark.attrs?.href || '#';
        const target = mark.attrs?.target || '_blank';
        const rel = target === '_blank' ? ' rel="noopener noreferrer"' : '';
        return `<a href="${this.escapeHtml(href)}" target="${target}"${rel}>${text}</a>`;
      }

      case 'subscript':
        return `<sub>${text}</sub>`;

      case 'superscript':
        return `<sup>${text}</sup>`;

      default:
        // Unknown mark, return text unchanged
        return text;
    }
  }

  /**
   * Escape HTML special characters
   * @param {string} text
   * @returns {string}
   */
  escapeHtml(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Replace an image URL in the HTML
   * @param {string} html - The HTML string
   * @param {string} oldUrl - The original URL to replace
   * @param {string} newUrl - The new URL
   * @returns {string}
   */
  static replaceImageUrl(html, oldUrl, newUrl) {
    // Escape special regex characters in the URL
    const escapedUrl = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`src="${escapedUrl}"`, 'g');
    return html.replace(regex, `src="${newUrl}"`);
  }
}

export default ProseMirrorConverter;
