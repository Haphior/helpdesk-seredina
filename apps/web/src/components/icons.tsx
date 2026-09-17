import type { SVGProps } from 'react';

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

export function TicketIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 8.5 5.5 3h9L17 8.5M3 8.5v6a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-6M3 8.5h4.2c.3 0 .55.2.65.48l.4 1.14c.1.28.36.48.65.48h2.2c.3 0 .55-.2.65-.48l.4-1.14c.1-.28.35-.48.65-.48H17" />
    </Icon>
  );
}

export function AssetsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 2.5 17 6.25v7.5L10 17.5 3 13.75v-7.5L10 2.5Z" />
      <path d="M3 6.25 10 10l7-3.75M10 10v7.5" />
    </Icon>
  );
}

export function KeyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="7" cy="13" r="3.2" />
      <path d="M9.3 10.7 16 4M16 4l-2 2M16 4h-2.6" />
    </Icon>
  );
}

export function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="14" cy="6.8" r="2.1" />
      <path d="M2.3 15.5c0-2.2 1.9-3.9 4.2-3.9s4.2 1.7 4.2 3.9M10.8 12c.4-.9 1.5-1.5 2.8-1.5 1.9 0 3.4 1.3 3.4 3" />
    </Icon>
  );
}

export function MailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="5" width="15" height="10" rx="1.5" />
      <path d="M3 5.8 10 11l7-5.2" />
    </Icon>
  );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M17 17l-3.8-3.8" />
    </Icon>
  );
}

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 7.5 10 12.5 15 7.5" />
    </Icon>
  );
}

export function LockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="4.5" y="8.5" width="11" height="7.5" rx="1.5" />
      <path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" />
    </Icon>
  );
}

export function LogoutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M13 13l4-4-4-4M17 9H8" />
    </Icon>
  );
}

export function BackArrowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12.5 4 6 10l6.5 6" />
    </Icon>
  );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 10.5 8 14.5 16 5.5" />
    </Icon>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 5l10 10M15 5 5 15" />
    </Icon>
  );
}

export function BoltIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M11 3 5.5 11h4L9 17l6.5-9h-4L11 3Z" />
    </Icon>
  );
}

export function WebhookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="14.5" r="2" />
      <circle cx="14.5" cy="14.5" r="2" />
      <circle cx="10" cy="5" r="2" />
      <path d="M10 7v3.5M8.2 13 9.3 11M11.8 13 10.7 11M8 14.5h4.5" />
    </Icon>
  );
}

export function ChecklistIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 5.5 5.2 6.7 7.5 4.4" />
      <path d="M4 11.5 5.2 12.7 7.5 10.4" />
      <path d="M10 5.5h6M10 12h6" />
    </Icon>
  );
}

export function LayersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 3 17 7l-7 4-7-4Z" />
      <path d="M3 11l7 4 7-4" />
    </Icon>
  );
}

export function SlidersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 6h7M14 6h2M4 14h2M9 14h7" />
      <circle cx="11" cy="6" r="2" />
      <circle cx="6" cy="14" r="2" />
    </Icon>
  );
}

export function SparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 3.5 11.4 8 16 9.5 11.4 11 10 15.5 8.6 11 4 9.5 8.6 8Z" />
    </Icon>
  );
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </Icon>
  );
}

export function CalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M7 3v3M13 3v3" />
    </Icon>
  );
}

export function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.3" />
      <rect x="12" y="3" width="5" height="4.5" rx="1.3" />
      <rect x="12" y="9.5" width="5" height="7.5" rx="1.3" />
      <rect x="3" y="12" width="7" height="5" rx="1.3" />
    </Icon>
  );
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2 10c1.8-3.5 4.8-5.5 8-5.5s6.2 2 8 5.5c-1.8 3.5-4.8 5.5-8 5.5S3.8 13.5 2 10Z" />
      <circle cx="10" cy="10" r="2.4" />
    </Icon>
  );
}

export function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2 10c1.8-3.5 4.8-5.5 8-5.5s6.2 2 8 5.5c-1.8 3.5-4.8 5.5-8 5.5S3.8 13.5 2 10Z" />
      <circle cx="10" cy="10" r="2.4" />
      <path d="M3 3l14 14" />
    </Icon>
  );
}

export function ChevronUpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 12.5 10 7.5 15 12.5" />
    </Icon>
  );
}

export function WarningIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 3.5 2.5 16.5h15Z" />
      <path d="M10 8v4" />
      <path d="M10 14.5v.1" />
    </Icon>
  );
}

export function CatalogIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="5.5" height="5.5" rx="1.2" />
      <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.2" />
      <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.2" />
    </Icon>
  );
}

export function ServiceMapIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="3.8" r="2" />
      <circle cx="4.5" cy="15" r="2" />
      <circle cx="15.5" cy="15" r="2" />
      <path d="M10 5.8v3M8.6 9.8 5.6 13.4M11.4 9.8l3 3.6" />
    </Icon>
  );
}

export function BookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3.5 4.2c1.8-.9 4-.9 5.8 0v11.6c-1.8-.9-4-.9-5.8 0Z" />
      <path d="M16.5 4.2c-1.8-.9-4-.9-5.8 0v11.6c1.8-.9 4-.9 5.8 0Z" />
    </Icon>
  );
}

export function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 14.5V9a5 5 0 0 1 10 0v5.5" />
      <path d="M3.5 14.5h13" />
      <path d="M8.3 17a1.8 1.8 0 0 0 3.4 0" />
    </Icon>
  );
}

export function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 3v9.5M6.5 9 10 12.5 13.5 9" />
      <path d="M3.5 15h13" />
    </Icon>
  );
}
