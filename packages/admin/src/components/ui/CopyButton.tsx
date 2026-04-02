import { useClipboard } from "@/hooks/useClipboard";

export type CopyButtonProps = {
    timeout?: number;
    value: string;
    children: (props: { copy: () => void; copied: boolean }) => React.ReactNode;
}

const CopyButton = ({ timeout, value, children, ...rest }: CopyButtonProps) => {
    const clipboard = useClipboard({ timeout });
    const copy = () => clipboard.copy(value);
    return <>{children({ copy, copied: clipboard.copied, ...rest })}</>;
};

export { CopyButton }