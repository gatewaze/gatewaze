// Import Dependencies
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  ReactNode,
} from "react";
import clsx from "clsx";
import Quill from "quill";
import type { Delta as DeltaStatic } from "quill";
import quillCSS from "quill/dist/quill.snow.css?inline";

// Local Imports
import { InputErrorMsg } from "@/components/ui";
import { useUncontrolled } from "@/hooks";
import {
  injectStyles,
  insertStylesToHead,
  makeStyleTag,
} from "@/utils/dom/injectStylesToHead";

// ----------------------------------------------------------------------

const styles = `@layer vendor {
  ${quillCSS} 
}`;

const sheet = makeStyleTag();

injectStyles(sheet, styles);
insertStylesToHead(sheet);

const Delta = Quill.import("delta");
const DEFAULT_PLACEHOLDER = "Type here...";

type RangeStatic = {
  index: number;
  length: number;
};

interface TextEditorProps {
  readOnly?: boolean;
  value?: DeltaStatic;
  defaultValue?: DeltaStatic;
  onTextChange?: (
    delta: DeltaStatic,
    oldDelta: DeltaStatic,
    source: string,
  ) => void;
  onSelectionChange?: (
    range: RangeStatic | null,
    oldRange: RangeStatic | null,
    source: string,
  ) => void;
  onChange?: (value: DeltaStatic, quill?: Quill) => void;
  placeholder?: string;
  modules?: Record<string, any>;
  className?: string;
  error?: boolean | ReactNode;
  classNames?: {
    root?: string;
    container?: string;
    error?: string;
  };
  label?: ReactNode;
}

interface TextEditorRef {
  getQuillInstance: () => Quill | null;
  blur: () => void;
  focus: () => void;
  hasFocus: () => boolean;
}

const TextEditor = forwardRef<TextEditorRef, TextEditorProps>(
  (
    {
      readOnly,
      value,
      defaultValue,
      onTextChange,
      onSelectionChange,
      onChange,
      placeholder,
      modules,
      className,
      error,
      classNames,
      label,
    },
    forwardedRef,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const quillRef = useRef<Quill | null>(null);
    const onTextChangeRef = useRef(onTextChange);
    const onSelectionChangeRef = useRef(onSelectionChange);

    const [_value, handleChange] = useUncontrolled<DeltaStatic>({
      value,
      defaultValue,
      finalValue: new Delta(),
      onChange,
    });

    const onChangeRef = useRef(handleChange);

    useLayoutEffect(() => {
      onTextChangeRef.current = onTextChange;
      onSelectionChangeRef.current = onSelectionChange;
      onChangeRef.current = handleChange;
    }, [handleChange, onSelectionChange, onTextChange]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const editorContainer = container.appendChild(
        container.ownerDocument.createElement("div"),
      );

      const quill = new Quill(editorContainer, {
        theme: "snow",
        placeholder: placeholder || DEFAULT_PLACEHOLDER,
        modules: modules || {},
      });

      quill.enable(!readOnly);

      quill.setContents(_value);

      quillRef.current = quill;

      quill.on(Quill.events.TEXT_CHANGE, (...args) => {
        const [delta, oldDelta, source] = args;
        if (source === "user") {
          const newContent = quill.getContents();
          onChangeRef?.current(newContent, quill);
          onTextChangeRef.current?.(delta, oldDelta, source);
        }
      });

      quill.on(Quill.events.SELECTION_CHANGE, (...args) => {
        const [range, oldRange, source] = args;
        onSelectionChangeRef.current?.(range, oldRange, source);
      });

      return () => {
        quill.off(Quill.events.TEXT_CHANGE);
        quill.off(Quill.events.SELECTION_CHANGE);
        quillRef.current = null;
        container.innerHTML = "";
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readOnly, modules, placeholder]);

    useImperativeHandle(forwardedRef, () => ({
      getQuillInstance: () => quillRef.current,
      blur: () => quillRef.current?.blur(),
      focus: () => quillRef.current?.focus(),
      hasFocus: () => quillRef.current?.hasFocus() ?? false,
    }));

    useEffect(() => {
      if (quillRef.current && value !== undefined) {
        const currentContent = quillRef.current.getContents();

        const diff = currentContent.diff(value);

        if (diff && diff?.ops?.length > 0) {
          quillRef.current.setContents(value);
        }
      }
    }, [value]);

    return (
      <div
        className={clsx(
          "flex flex-col",
          className,
          error && "ql-error",
          classNames?.root,
        )}
      >
        {label && <label>{label}</label>}
        <div
          className={clsx(
            "ql-container",
            label && "mt-1.5!",
            classNames?.container,
          )}
          ref={containerRef}
        ></div>

        <InputErrorMsg
          when={!!error && typeof error !== "boolean"}
          className={classNames?.error}
        >
          {error}
        </InputErrorMsg>
      </div>
    );
  },
);

TextEditor.displayName = "TextEditor";

export { TextEditor, Delta, Quill };
export type { DeltaStatic, TextEditorProps, TextEditorRef };
