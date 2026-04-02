// Import Dependencies
import { useMergedRef } from "@/hooks";
import {
  useRef,
  InputHTMLAttributes,
  ReactNode,
  ChangeEvent,
  forwardRef,
} from "react";

interface UploadProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "hidden" | "onChange" | "children"
  > {
  onChange?: (file: File[]) => void;
  children: (props: any) => ReactNode;
  disabled?: boolean;
  inputProps?: Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "type" | "hidden" | "ref"
  >;
}

// ----------------------------------------------------------------------

const Upload = forwardRef<HTMLInputElement, UploadProps>((props, ref) => {
  const {
    onChange = () => {},
    children,
    accept,
    name,
    form,
    disabled,
    capture,
    inputProps,
    ...rest
  } = props;

  const inputRef = useRef<HTMLInputElement>(null);

  const onClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files;
    if (!files) return;

    onChange(Array.from(files));
  };

  const mergedRef = useMergedRef(ref, inputRef);

  return (
    <>
      {children({ onClick, disabled, ...rest })}

      <input
        hidden
        type="file"
        accept={accept}
        onChange={handleChange}
        ref={mergedRef}
        name={name}
        form={form}
        capture={capture}
        disabled={disabled}
        {...inputProps}
      />
    </>
  );
});

Upload.displayName = "Upload";

export { Upload };
