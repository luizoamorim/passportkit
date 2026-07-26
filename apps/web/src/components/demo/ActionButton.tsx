/**
 * The one button the demo pages act through. Four intents, because the demo
 * reads as a story: the trade is primary, the issuer's approval is green, the
 * revocation is red, everything else is quiet.
 */

export type ActionVariant = 'primary' | 'default' | 'verify' | 'danger';

const VARIANT_STYLES: Record<ActionVariant, string> = {
  primary:
    'bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] text-white border-transparent hover:opacity-90',
  default: 'bg-white text-[#0D1428] border-[#DDE1EA] hover:border-[#4A9EFF]',
  verify: 'bg-white text-green-700 border-green-200 hover:border-green-500',
  danger: 'bg-white text-red-600 border-red-200 hover:border-red-500',
};

export function ActionButton({
  children,
  onClick,
  disabled = false,
  variant = 'default',
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: ActionVariant;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-45 disabled:cursor-wait ${VARIANT_STYLES[variant]}`}
    >
      {children}
    </button>
  );
}
