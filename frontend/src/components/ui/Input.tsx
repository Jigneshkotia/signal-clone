"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import { SearchIcon, XIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string | null;
  leading?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leading, className, id, ...props },
  ref,
) {
  const inputId = id ?? props.name ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[13px] font-medium text-secondary"
        >
          {label}
        </label>
      )}

      <div className="relative flex items-center">
        {leading && (
          <span className="pointer-events-none absolute left-3 text-tertiary">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "h-11 w-full rounded-lg bg-[var(--surface-input)] px-3.5",
            "text-[14px] text-primary placeholder:text-tertiary",
            "border border-transparent outline-none",
            "focus:border-ultramarine focus-visible:outline-none",
            leading && "pl-10",
            error && "border-accent-red",
            className,
          )}
          aria-invalid={error ? true : undefined}
          {...props}
        />
      </div>

      {error ? (
        <p className="text-[12px] text-accent-red">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
});

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * The pill-shaped search field in Signal's left pane: a magnifier on the left
 * and a clear button that appears only once there is something to clear.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  className,
}: SearchInputProps) {
  return (
    <div className={cn("relative flex items-center", className)}>
      <SearchIcon
        size={16}
        className="pointer-events-none absolute left-3 text-tertiary"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          "h-8 w-full rounded-full bg-[var(--surface-input)] pl-9 pr-9",
          "text-[13px] text-primary placeholder:text-tertiary",
          "border border-transparent outline-none",
          "focus:border-ultramarine",
          // Hide the native clear affordance so ours is the only one.
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-full text-tertiary hover:bg-[var(--surface-active)] hover:text-primary"
        >
          <XIcon size={13} />
        </button>
      )}
    </div>
  );
}
