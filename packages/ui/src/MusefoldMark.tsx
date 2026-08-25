import type { SVGProps } from "react";

export interface MusefoldMarkProps extends SVGProps<SVGSVGElement> {
  title?: string;
}

/** Static product mark shared by compact and animated brand surfaces. */
export function MusefoldMark({ title = "Musefold / 未像", ...props }: MusefoldMarkProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <path
        fill="currentColor"
        d="M 6 0 H 94 A 6 6 0 0 1 100 6 V 12.4 H 21 Q 17 12.4 17 16.4 V 100 H 6 A 6 6 0 0 1 0 94 V 6 A 6 6 0 0 1 6 0 Z"
      />
      <g fill="currentColor">
        <rect x="98.6" y="4" width="1.4" height="51.2" />
        <rect x="15" y="98.6" width="38" height="1.4" />
      </g>
      <path
        fill="currentColor"
        d="M 100 54 L 53.2 100 L 50.6 100 L 50.6 98.6 L 52.0 98.1 C 52.41 97.49 53.39 96.41 54.46 94.46 C 55.53 92.51 56.93 89.43 58.42 86.42 C 59.91 83.41 61.71 79.71 63.4 76.4 C 65.09 73.09 67.16 69.16 68.56 66.56 C 69.96 63.96 70.74 62.24 71.8 60.8 C 72.86 59.36 73.75 58.75 74.92 57.92 C 76.09 57.09 77.34 56.34 78.82 55.82 C 80.3 55.3 81.47 54.97 83.8 54.8 C 86.13 54.63 90.51 54.95 92.8 54.8 C 95.09 54.65 96.75 54.05 97.54 53.9 L 98.6 53.8 Z"
      />
      <circle cx="84.2" cy="27.2" r="6.8" fill="var(--accent)" />
    </svg>
  );
}
