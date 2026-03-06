interface ScrapexLogoProps {
  size?: number;
  className?: string;
}

export default function ScrapexLogo({ size = 32, className = "" }: ScrapexLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer hexagon frame */}
      <path
        d="M20 2L36 11V29L20 38L4 29V11L20 2Z"
        stroke="white"
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="round"
      />
      {/* Inner spider-web crosshair */}
      <line x1="20" y1="7" x2="20" y2="33" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="7" y1="14" x2="33" y2="26" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
      <line x1="33" y1="14" x2="7" y2="26" stroke="white" strokeWidth="1" strokeOpacity="0.4" />
      {/* X symbol in center */}
      <path
        d="M14 14L26 26M26 14L14 26"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* Corner accent dots */}
      <circle cx="20" cy="4" r="1.5" fill="white" />
      <circle cx="20" cy="36" r="1.5" fill="white" />
    </svg>
  );
}
