export default function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <svg className="brand-mark-svg" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect width="48" height="48" rx="15" fill="currentColor" />
      <path d="M15 33.5V24a9 9 0 0 1 18 0v8.5" stroke="#EAF3E8" strokeWidth="3" strokeLinecap="round" />
      <path d="M24 15v4.5" stroke="#EAF3E8" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="13" r="3.5" fill="#D8B46A" stroke="#173F2E" strokeWidth="1.5" />
      <circle cx="15" cy="34" r="3.5" fill="#fff" stroke="#173F2E" strokeWidth="1.5" />
      <circle cx="33" cy="34" r="3.5" fill="#fff" stroke="#173F2E" strokeWidth="1.5" />
    </svg>
  );
}

