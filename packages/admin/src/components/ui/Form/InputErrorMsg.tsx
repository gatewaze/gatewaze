import clsx from "clsx";
import { ReactNode } from "react";

export type InputErrorMsgProps = {
  when: boolean;
  children: ReactNode;
  className?: string;
};

export function InputErrorMsg({
  when,
  children,
  className,
}: InputErrorMsgProps) {
  return when ? (
    <span
      className={clsx(
        "mt-1 text-xs text-[var(--red-9)]",
        className,
      )}
    >
      {children}
    </span>
  ) : null;
}
