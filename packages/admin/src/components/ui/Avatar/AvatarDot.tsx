import { ReactNode, forwardRef, ForwardedRef, ComponentPropsWithoutRef } from "react";
import clsx from "clsx";

import { ColorType } from "@/constants/app";

export type AvatarDotProps = {
  color?: ColorType;
  isPing?: boolean;
  children?: ReactNode;
} & ComponentPropsWithoutRef<"div">;

const dotColorMap: Record<string, string> = {
  primary: "bg-[var(--accent-9)]",
  secondary: "bg-blue-500",
  info: "bg-cyan-500",
  success: "bg-green-500",
  warning: "bg-orange-500",
  error: "bg-red-500",
  neutral: "bg-gray-300 dark:bg-gray-600",
};

const AvatarDot = forwardRef<HTMLDivElement, AvatarDotProps>(
  ({ color = "neutral", isPing, className, children, ...rest }, ref) => {
    return (
      <div
        className={clsx(
          "absolute rounded-full",
          dotColorMap[color] || dotColorMap.neutral,
          className,
        )}
        {...rest}
        ref={ref}
      >
        {isPing && (
          <span className="absolute inset-0 inline-flex h-full w-full animate-ping rounded-full bg-inherit opacity-80" />
        )}
        {children}
      </div>
    );
  },
);

AvatarDot.displayName = "AvatarDot";

export { AvatarDot };
