import type { ButtonHTMLAttributes } from 'react';
import { SpinnerIcon } from './icons';

const VARIANTS = {
  primary: 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 disabled:bg-rose-300',
  // An outlined, not filled, destructive action -- "Delete" next to a plain
  // "Edit", where a filled `danger` button would visually outweigh the
  // primary action on the page instead of sitting as its quiet sibling.
  dangerOutline: 'border border-slate-200 bg-white text-rose-600 shadow-sm hover:bg-rose-50 disabled:text-rose-300',
};

// Touch targets are 36px by default -- this is a dense, desktop-first admin
// console (see docs/PRODUCT.md's ICP), not a phone-first product, so the
// usual 44px guideline would visibly bloat every toolbar. A page also used
// from a phone-sized viewport (PublicKb, PublicStatus) should pass size="lg"
// for the full 44px target instead.
//
// Regular and icon-only variants get separate class strings, not one set of
// padding classes an iconOnly branch tries to override afterwards -- two
// Tailwind classes touching the same property (px-3 vs px-0) both land in
// the generated stylesheet, and which one wins depends on Tailwind's output
// order, not on where each class sits in this template string. Keeping them
// disjoint per size avoids ever relying on that override order.
const SIZES = {
  sm: 'min-h-[32px] px-3 text-[12.5px]',
  md: 'min-h-[36px] px-4 text-[13px]',
  lg: 'min-h-[44px] px-5 text-[14px]',
};

const ICON_ONLY_SIZES = {
  sm: 'h-8 w-8 text-[12.5px]',
  md: 'h-9 w-9 text-[13px]',
  lg: 'h-11 w-11 text-[14px]',
};

type BaseProps = {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  // Disables the button while true, on top of the `disabled` prop, so a
  // caller can't forget to guard against a duplicate submit while a request
  // is in flight -- the loading state and the disabled state are the same
  // state, not two things that can drift apart.
  isLoading?: boolean;
};

type IconOnlyProps = BaseProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
    iconOnly: true;
    'aria-label': string;
  };

type RegularProps = BaseProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    iconOnly?: false;
  };

export type ButtonProps = IconOnlyProps | RegularProps;

export function Button({ variant = 'primary', size = 'md', isLoading, iconOnly, className = '', disabled, children, ...rest }: ButtonProps) {
  const sizeClass = iconOnly ? ICON_ONLY_SIZES[size] : SIZES[size];
  return (
    <button
      disabled={disabled || isLoading}
      className={`inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:cursor-not-allowed ${VARIANTS[variant]} ${sizeClass} ${className}`}
      {...rest}
    >
      {isLoading ? <SpinnerIcon className="animate-spin motion-reduce:animate-none" width={15} height={15} /> : children}
    </button>
  );
}
