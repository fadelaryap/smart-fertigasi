"use client";

import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  /** Text to show while the action is pending (defaults to "Memproses…") */
  pendingText?: string;
}

export function SubmitButton({
  children,
  className,
  style,
  disabled,
  pendingText,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      style={style}
      disabled={disabled || pending}
    >
      {pending ? (
        <span className="btn-loading">
          <span className="spinner" />
          {pendingText ?? "Memproses…"}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
