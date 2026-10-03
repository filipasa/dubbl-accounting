import type { SVGProps } from "react";

/**
 * Official Telegram Circular Logo Icon.
 * Supports colored=true for official Telegram brand blue (#229ED9) and white plane,
 * or default colored=false for currentColor adaptive fills.
 */
export function TelegramLogo({
  className = "h-5 w-5",
  colored = false,
  ...props
}: SVGProps<SVGSVGElement> & { colored?: boolean }) {
  if (colored) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={className}
        xmlns="http://www.w3.org/2000/svg"
        {...props}
      >
        <circle cx="12" cy="12" r="12" fill="#229ED9" />
        <path
          d="m5.414 11.954 11.458-4.718c.531-.223 1.01.12.836.877l-1.952 9.202c-.144.664-.539.825-1.085.513l-2.983-2.2-1.44 1.386c-.16.16-.294.294-.602.294l.213-3.033 5.52-4.988c.24-.214-.053-.333-.373-.12l-6.822 4.296-2.943-.92c-.64-.2-.653-.64.132-.947Z"
          fill="#FFFFFF"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm5.71 7.11-1.95 9.2c-.15.67-.54.83-1.09.52l-2.98-2.2-1.44 1.38c-.16.16-.3.3-.6.3l.21-3.04 5.52-4.99c.24-.21-.05-.33-.37-.12l-6.82 4.3-2.95-.92c-.64-.2-.65-.64.14-.95l11.45-4.72c.53-.22 1.01.12.83.88Z" />
    </svg>
  );
}

/**
 * Official Telegram Paper Airplane Icon (Standalone paper airplane geometry).
 * Perfect for buttons, link actions, and embedded inline icons.
 */
export function TelegramPlaneIcon({
  className = "h-4 w-4",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="m20.665 3.717-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l-.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z" />
    </svg>
  );
}
