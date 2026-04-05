import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function GuideContent({ content }: { content: string }) {
  return (
    <div className="module-guide">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
