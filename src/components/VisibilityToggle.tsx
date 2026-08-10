interface VisibilityToggleProps {
  readonly concealed: boolean;
  readonly showLabel: string;
  readonly hideLabel: string;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
}

export function VisibilityToggle({
  concealed,
  showLabel,
  hideLabel,
  disabled = false,
  onToggle,
}: VisibilityToggleProps) {
  const label = concealed ? showLabel : hideLabel;

  return (
    <button
      type="button"
      className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl border border-transparent bg-transparent text-heading transition-all duration-150 hover:-translate-y-px hover:border-theme-border hover:bg-panel focus-visible:border-theme-border focus-visible:bg-panel focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:translate-y-0 disabled:hover:border-transparent disabled:hover:bg-transparent"
      aria-label={label}
      aria-pressed={concealed}
      title={label}
      disabled={disabled}
      onClick={onToggle}
    >
      {concealed ? (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 3 18 18" />
          <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
          <path d="M9.9 4.3A10.7 10.7 0 0 1 12 4c5.4 0 9 5.2 9 5.2a12.4 12.4 0 0 1-2.2 2.8" />
          <path d="M6.6 6.6A13.7 13.7 0 0 0 3 9.2S6.6 14.4 12 14.4c.8 0 1.6-.1 2.3-.3" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12s3.6-5.2 9-5.2 9 5.2 9 5.2-3.6 5.2-9 5.2S3 12 3 12Z" />
          <circle cx="12" cy="12" r="2.6" />
        </svg>
      )}
    </button>
  );
}
