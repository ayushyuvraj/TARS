import React from "react";

interface KatalystKBadgeProps {
  size?: number;
  variant?: "badge" | "icon" | "orb";
  className?: string;
  glow?: boolean;
}

export function KatalystKBadge({
  size = 24,
  variant = "badge",
  className = "",
  glow = true,
}: KatalystKBadgeProps) {
  const isOrb = variant === "orb";
  const isBadge = variant === "badge";

  return (
    <div
      className={`katalyst-k-badge-wrapper ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        position: "relative",
        flexShrink: 0,
      }}
    >
      {glow && (
        <div
          style={{
            position: "absolute",
            inset: -2,
            borderRadius: isOrb ? "50%" : "26%",
            background: "radial-gradient(circle, rgba(0, 145, 218, 0.45) 0%, rgba(0, 51, 141, 0) 70%)",
            filter: "blur(4px)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
      )}
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "relative",
          zIndex: 1,
          display: "block",
        }}
      >
        <defs>
          <linearGradient id="kpmg-sky-cobalt" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#72CDF4" />
            <stop offset="45%" stopColor="#0091DA" />
            <stop offset="100%" stopColor="#00338D" />
          </linearGradient>

          <linearGradient id="kpmg-cobalt-navy" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00338D" />
            <stop offset="60%" stopColor="#005EB8" />
            <stop offset="100%" stopColor="#0091DA" />
          </linearGradient>

          <linearGradient id="kpmg-pure-white-sky" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="50%" stopColor="#E0F2FE" />
            <stop offset="100%" stopColor="#72CDF4" />
          </linearGradient>

          <linearGradient id="kpmg-badge-bg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0F1F38" />
            <stop offset="100%" stopColor="#050B14" />
          </linearGradient>

          <linearGradient id="kpmg-rim-border" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0091DA" />
            <stop offset="50%" stopColor="#005EB8" />
            <stop offset="100%" stopColor="rgba(0, 51, 141, 0.4)" />
          </linearGradient>

          <filter id="k-specular" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#0091DA" floodOpacity="0.6" />
          </filter>
        </defs>

        {/* Outer Frame (Badge or Orb) */}
        {isOrb ? (
          <>
            <circle cx="16" cy="16" r="14.5" fill="url(#kpmg-badge-bg)" stroke="url(#kpmg-rim-border)" strokeWidth="1.5" />
            <circle cx="16" cy="16" r="13" stroke="rgba(255, 255, 255, 0.12)" strokeWidth="0.8" />
          </>
        ) : isBadge ? (
          <>
            <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="url(#kpmg-badge-bg)" stroke="url(#kpmg-rim-border)" strokeWidth="1.5" />
            <rect x="2.5" y="2.5" width="27" height="27" rx="7" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="0.8" />
          </>
        ) : null}

        {/* The 'K' Monogram - Vertical Stem */}
        <path
          d="M8.5 7.5C8.5 6.95 8.95 6.5 9.5 6.5H12C12.55 6.5 13 6.95 13 7.5V24.5C13 25.05 12.55 25.5 12 25.5H9.5C8.95 25.5 8.5 25.05 8.5 24.5V7.5Z"
          fill="url(#kpmg-sky-cobalt)"
          filter="url(#k-specular)"
        />

        {/* The 'K' Monogram - Upper Diagonal Chevron */}
        <path
          d="M13.5 16L21.2 7.4C21.6 6.9 22.3 6.6 23 6.6H23.8C24.6 6.6 25 7.6 24.4 8.2L17.8 15.6L13.5 16Z"
          fill="url(#kpmg-pure-white-sky)"
          filter="url(#k-specular)"
        />

        {/* The 'K' Monogram - Lower Diagonal Leg */}
        <path
          d="M15.8 14.2L23.8 24.3C24.3 24.9 23.9 25.5 23.1 25.5H21.8C21.2 25.5 20.6 25.1 20.2 24.6L13.6 16.3L15.8 14.2Z"
          fill="url(#kpmg-cobalt-navy)"
        />

        {/* Diamond Core Specular Accent */}
        <polygon points="15,15.5 16.5,14 15,12.5 13.5,14" fill="#FFFFFF" opacity="0.95" />
        <circle cx="15" cy="14" r="0.8" fill="#72CDF4" />
      </svg>
    </div>
  );
}
