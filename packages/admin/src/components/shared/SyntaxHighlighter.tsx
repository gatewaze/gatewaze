// Import Dependencies
import { PrismLight, SyntaxHighlighterProps as PrismProps } from 'react-syntax-highlighter';
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';

// Register the JSX language for syntax highlighting
PrismLight.registerLanguage('jsx', jsx);

// ----------------------------------------------------------------------

function SyntaxHighlighter({ children, ...rest }: PrismProps) {
  return (
    <PrismLight style={atomDark} {...rest}>
      {children}
    </PrismLight>
  );
}

export { SyntaxHighlighter };
