import React, { useCallback, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Youtube from '@tiptap/extension-youtube';
import CharacterCount from '@tiptap/extension-character-count';
import { Modal } from './Modal';
import { ImageUpload } from './ImageUpload';
import { Button } from './Button';
import { TemplateVariableSelector } from './TemplateVariableSelector';
import { rewriteImgSrcToPublicUrl, rewriteImgSrcToStoragePath } from '@gatewaze/shared';

// Import icons
import {
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  CommandLineIcon,
  H1Icon,
  H2Icon,
  H3Icon,
  ListBulletIcon,
  NumberedListIcon,
  LinkIcon,
  PhotoIcon,
  VideoCameraIcon,
  TableCellsIcon,
  PaintBrushIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  Bars3BottomLeftIcon,
  Bars3Icon,
  Bars3BottomRightIcon,
} from '@heroicons/react/24/outline';

// Template variable configuration
export interface TemplateVariableConfig {
  enabled: boolean;
  availableScopes?: string[];
}

// Allowed HTML tags for sanitization
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'a', 'img',
  'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'div', 'span',
]);

// Attributes to preserve (by tag)
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height']),
  div: new Set(['style']),
  span: new Set(['style']),
};

/**
 * Sanitize pasted HTML to remove unwanted elements, styles, and classes
 */
function sanitizePastedHtml(html: string): string {
  // Create a temporary DOM element to parse the HTML
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Process all elements
  const processNode = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode();
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const element = node as Element;
    const tagName = element.tagName.toLowerCase();

    // Check if this is a paragraph with only whitespace/nbsp content
    if (tagName === 'p') {
      const textContent = element.textContent || '';
      // Match only nbsp characters, regular spaces, or empty
      if (/^[\s\u00A0]*$/.test(textContent) || textContent === '\u00A0') {
        return null; // Remove empty/nbsp-only paragraphs
      }
    }

    // If tag is not allowed, process children and return them as a fragment
    if (!ALLOWED_TAGS.has(tagName)) {
      const fragment = document.createDocumentFragment();
      for (const child of Array.from(element.childNodes)) {
        const processed = processNode(child);
        if (processed) {
          fragment.appendChild(processed);
        }
      }
      return fragment.childNodes.length > 0 ? fragment : null;
    }

    // Create a clean element with only allowed attributes
    const cleanElement = document.createElement(tagName);
    const allowedAttrs = ALLOWED_ATTRIBUTES[tagName] || new Set();

    for (const attr of Array.from(element.attributes)) {
      if (allowedAttrs.has(attr.name)) {
        cleanElement.setAttribute(attr.name, attr.value);
      }
    }

    // Process children
    for (const child of Array.from(element.childNodes)) {
      const processed = processNode(child);
      if (processed) {
        cleanElement.appendChild(processed);
      }
    }

    // Skip empty elements (except self-closing ones like br, img)
    if (!cleanElement.hasChildNodes() && !['br', 'img'].includes(tagName)) {
      return null;
    }

    return cleanElement;
  };

  // Process the body content
  const fragment = document.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) {
    const processed = processNode(child);
    if (processed) {
      fragment.appendChild(processed);
    }
  }

  // Convert back to HTML string
  const temp = document.createElement('div');
  temp.appendChild(fragment);
  return temp.innerHTML;
}

interface RichTextEditorProps {
  content?: string;
  onChange: (content: string) => void;
  placeholder?: string;
  className?: string;
  maxLength?: number;
  editable?: boolean;
  templateVariables?: TemplateVariableConfig;
  /**
   * When provided, `<img src>` attributes are handled in both directions:
   *   - incoming `content` has relative storage paths resolved to full URLs for display
   *   - outgoing content (via onChange) has full storage URLs stripped back to
   *     relative paths before persistence.
   * See spec-relative-storage-paths.md for the overall pattern.
   */
  storageBucketUrl?: string;
}

interface MenuBarProps {
  editor: any;
  templateVariables?: TemplateVariableConfig;
  onInsertVariable?: (variable: string) => void;
}

interface ImageUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImageSelect: (url: string) => void;
}

const ImageUploadModal: React.FC<ImageUploadModalProps> = ({
  isOpen,
  onClose,
  onImageSelect,
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const handleImageChange = (url: string | null) => {
    setImageUrl(url);
  };

  const handleInsert = () => {
    if (imageUrl) {
      onImageSelect(imageUrl);
      setImageUrl(null);
      onClose();
    }
  };

  const handleCancel = () => {
    setImageUrl(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title="Insert Image">
      <div className="space-y-4">
        <ImageUpload
          value={imageUrl || undefined}
          onChange={handleImageChange}
          label="Select an image"
          placeholder="Upload an image or enter URL"
        />

        <div className="flex justify-end space-x-3 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            color="cyan"
            onClick={handleInsert}
            disabled={!imageUrl}
          >
            Insert Image
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const MenuBar: React.FC<MenuBarProps> = ({ editor, templateVariables, onInsertVariable }) => {
  const [showImageModal, setShowImageModal] = useState(false);

  const addImage = useCallback(() => {
    setShowImageModal(true);
  }, []);

  const handleImageSelect = useCallback((url: string) => {
    editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const addLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('Enter URL', previousUrl);

    if (url === null) {
      return;
    }

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const addYoutube = useCallback(() => {
    const url = prompt('Enter YouTube URL');
    if (url) {
      editor.commands.setYoutubeVideo({
        src: url,
        width: Math.max(320, parseInt('640', 10)) || 640,
        height: Math.max(180, parseInt('480', 10)) || 480,
      });
    }
  }, [editor]);

  const addTable = useCallback(() => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  if (!editor) {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-1 p-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-t-lg">
      {/* Template Variables - positioned first/left */}
      {templateVariables?.enabled && onInsertVariable && (
        <div className="flex gap-1 pr-2 border-r border-gray-300 dark:border-gray-600">
          <TemplateVariableSelector
            onInsert={onInsertVariable}
            availableScopes={templateVariables.availableScopes}
          />
        </div>
      )}

      {/* Text Formatting */}
      <div className="flex gap-1 pr-2 border-r border-gray-300 dark:border-gray-600">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('bold') ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Bold"
        >
          <BoldIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('italic') ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Italic"
        >
          <ItalicIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('strike') ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Strikethrough"
        >
          <StrikethroughIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleCode().run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('code') ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Code"
        >
          <CommandLineIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Headers */}
      <div className="flex gap-1 pr-2 border-r border-gray-300 dark:border-gray-600">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('heading', { level: 1 }) ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Heading 1"
        >
          <H1Icon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('heading', { level: 2 }) ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Heading 2"
        >
          <H2Icon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('heading', { level: 3 }) ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Heading 3"
        >
          <H3Icon className="w-4 h-4" />
        </button>
      </div>

      {/* Lists */}
      <div className="flex gap-1 pr-2 border-r border-gray-300 dark:border-gray-600">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('bulletList') ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Bullet List"
        >
          <ListBulletIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('orderedList') ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Numbered List"
        >
          <NumberedListIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Alignment */}
      <div className="flex gap-1 pr-2 border-r border-gray-300 dark:border-gray-600">
        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive({ textAlign: 'left' }) || !editor.isActive({ textAlign: 'center' }) && !editor.isActive({ textAlign: 'right' }) ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Align Left"
        >
          <Bars3BottomLeftIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive({ textAlign: 'center' }) ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Align Center"
        >
          <Bars3Icon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive({ textAlign: 'right' }) ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Align Right"
        >
          <Bars3BottomRightIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Media & Links */}
      <div className="flex gap-1 pr-2 border-r border-gray-300 dark:border-gray-600">
        <button
          type="button"
          onClick={addLink}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('link') ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Add Link"
        >
          <LinkIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={addImage}
          className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          title="Add Image"
        >
          <PhotoIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={addYoutube}
          className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          title="Add YouTube Video"
        >
          <VideoCameraIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={addTable}
          className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
          title="Add Table"
        >
          <TableCellsIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Text Color & Highlight */}
      <div className="flex gap-1 pr-2 border-r border-gray-300 dark:border-gray-600">
        <input
          type="color"
          onInput={(event) =>
            editor.chain().focus().setColor((event.target as HTMLInputElement).value).run()
          }
          value={editor.getAttributes('textStyle').color || '#000000'}
          className="w-8 h-8 rounded border-0 cursor-pointer"
          title="Text Color"
        />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
            editor.isActive('highlight') ? 'bg-gray-200 dark:bg-gray-700' : ''
          }`}
          title="Highlight"
        >
          <PaintBrushIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Undo/Redo */}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Undo"
        >
          <ArrowUturnLeftIcon className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Redo"
        >
          <ArrowUturnRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>

      <ImageUploadModal
        isOpen={showImageModal}
        onClose={() => setShowImageModal(false)}
        onImageSelect={handleImageSelect}
      />
    </>
  );
};

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  content = '',
  onChange,
  placeholder = 'Start writing...',
  className = '',
  maxLength,
  editable = true,
  templateVariables,
  storageBucketUrl,
}) => {
  const [isHtmlMode, setIsHtmlMode] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');

  // Resolve incoming content's relative <img src>s for display inside the editor.
  // Passes through unchanged if no bucketUrl or if src is already full.
  const displayContent = storageBucketUrl
    ? rewriteImgSrcToPublicUrl(content, storageBucketUrl)
    : content;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded',
        },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          class: 'underline cursor-text',
        },
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right'],
        defaultAlignment: 'left',
      }),
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: {
          class: 'bg-gray-100 dark:bg-gray-700 font-semibold',
        },
      }),
      TableCell,
      Youtube.configure({
        width: 640,
        height: 480,
        HTMLAttributes: {
          class: 'rounded',
        },
      }),
      CharacterCount.configure({
        limit: maxLength,
      }),
    ],
    content: displayContent,
    editable,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      // On save, strip any absolute storage URLs in <img src> back to relative paths.
      // Idempotent — if no bucketUrl is provided, emits as-is.
      onChange(
        storageBucketUrl ? rewriteImgSrcToStoragePath(html, storageBucketUrl) : html,
      );
    },
    editorProps: {
      attributes: {
        // Set US English for spellcheck
        lang: 'en-US',
        spellcheck: 'true',
      },
      transformPastedHTML(html) {
        // Sanitize pasted HTML to remove styles, classes, and unwanted elements
        return sanitizePastedHtml(html);
      },
      handleClick(view, pos, event) {
        // Prevent link navigation when clicking on links in the editor
        const target = event.target as HTMLElement;
        if (target.tagName === 'A' || target.closest('a')) {
          event.preventDefault();
          event.stopPropagation();
          return true; // Mark as handled
        }
        return false;
      },
      handleDOMEvents: {
        // Also prevent mousedown from triggering link behavior
        mousedown: (view, event) => {
          const target = event.target as HTMLElement;
          if (target.tagName === 'A' || target.closest('a')) {
            // Allow the click for text selection but prevent navigation
            event.preventDefault();
          }
          return false;
        },
      },
    },
  });

  if (!editor) {
    return null;
  }

  const characterCount = editor.storage.characterCount || { characters: () => 0 };
  const currentLength = characterCount.characters();

  const toggleHtmlMode = () => {
    if (!isHtmlMode) {
      // Switching to HTML mode - get current HTML
      setHtmlContent(editor.getHTML());
    } else {
      // Switching back to visual mode - update editor with HTML
      editor.commands.setContent(htmlContent);
      onChange(
        storageBucketUrl
          ? rewriteImgSrcToStoragePath(htmlContent, storageBucketUrl)
          : htmlContent,
      );
    }
    setIsHtmlMode(!isHtmlMode);
  };

  const handleHtmlChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newHtml = e.target.value;
    setHtmlContent(newHtml);
    onChange(newHtml);
  };

  // Handle inserting template variables at cursor position
  const handleInsertVariable = useCallback((variable: string) => {
    if (isHtmlMode) {
      // In HTML mode, just append to the content
      setHtmlContent(prev => prev + variable);
      onChange(htmlContent + variable);
    } else {
      // In visual mode, insert at cursor position
      editor.chain().focus().insertContent(variable).run();
    }
  }, [editor, isHtmlMode, htmlContent, onChange]);

  return (
    <div className={`border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden ${className}`}>
      {editable && (
        <div className="sticky top-0 z-10 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          {!isHtmlMode && (
            <MenuBar
              editor={editor}
              templateVariables={templateVariables}
              onInsertVariable={handleInsertVariable}
            />
          )}
          <div className={`flex justify-end ${!isHtmlMode ? 'border-t border-gray-200 dark:border-gray-700' : ''}`}>
            <button
              type="button"
              onClick={toggleHtmlMode}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              title={isHtmlMode ? 'Switch to Visual Editor' : 'Switch to HTML Editor'}
            >
              {isHtmlMode ? '👁️ Visual' : '</> HTML'}
            </button>
          </div>
        </div>
      )}

      <div className="relative max-h-[600px] overflow-y-auto">
        {isHtmlMode ? (
          <textarea
            value={htmlContent}
            onChange={handleHtmlChange}
            className="w-full p-4 min-h-[400px] font-mono text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none resize-none"
            placeholder="Enter HTML..."
            spellCheck={false}
          />
        ) : (
          <>
            <EditorContent
              editor={editor}
              className={`
                prose prose-sm sm:prose lg:prose-lg xl:prose-xl max-w-none
                focus-within:outline-none
                p-4 min-h-[400px]
                dark:prose-invert
                prose-headings:mt-4 prose-headings:mb-2
                prose-p:mb-3 prose-p:mt-0
                prose-ul:my-2 prose-ul:list-disc prose-ul:pl-6
                prose-ol:my-2 prose-ol:list-decimal prose-ol:pl-6
                prose-li:my-0 prose-li:py-0.5
                prose-table:border-collapse prose-table:w-full
                prose-th:border prose-th:border-gray-300 prose-th:p-2
                prose-td:border prose-td:border-gray-300 prose-td:p-2
                prose-img:rounded prose-img:shadow-sm
                prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                [&_.ProseMirror]:outline-none [&_.ProseMirror]:focus:outline-none
                [&_.ProseMirror]:focus-visible:outline-none
                [&_.ProseMirror_p]:mb-4 [&_.ProseMirror_p]:mt-0 [&_.ProseMirror_p:last-child]:mb-0
                [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ul]:ml-0 [&_.ProseMirror_ul]:my-2
                [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ol]:ml-0 [&_.ProseMirror_ol]:my-2
                [&_.ProseMirror_li]:my-0 [&_.ProseMirror_li]:py-0.5
                [&_.ProseMirror_a]:cursor-text [&_.ProseMirror_a]:pointer-events-auto
              `}
            />

            {!editor.getText() && editable && (
              <div className="absolute top-4 left-4 text-gray-400 pointer-events-none select-none">
                {placeholder}
              </div>
            )}
          </>
        )}
      </div>

      {/* Character Count */}
      {maxLength && (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 flex justify-end">
          <span className={currentLength > maxLength ? 'text-red-500' : ''}>
            {currentLength}{maxLength && ` / ${maxLength}`}
          </span>
        </div>
      )}
    </div>
  );
};

export default RichTextEditor;