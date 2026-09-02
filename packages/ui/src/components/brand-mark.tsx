import type { SVGProps } from 'react';

export interface MusefoldMarkProps extends SVGProps<SVGSVGElement> {
  title?: string;
}

/**
 * Musefold 品牌标记(承 v2.1 同名组件,几何不变)。
 * 主体走 currentColor,朱点走 --primary(旧 --accent 的 v2.5 语义对应)。
 */
export function MusefoldMark({ title = 'Musefold / 未像', ...props }: MusefoldMarkProps) {
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
      <circle cx="84.2" cy="27.2" r="6.8" fill="var(--primary)" />
    </svg>
  );
}

/**
 * 豆包品牌标记(单色 currentColor 渲染,不引入品牌彩色;
 * 路径取自 @lobehub/icons-static-svg,MIT License,承旧 brand-icons doubao 字形)。
 */
export function DoubaoMark({ title = '豆包', ...props }: MusefoldMarkProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <path
        fill="currentColor"
        opacity={0.5}
        d="M5.31 15.756c.172-3.75 1.883-5.999 2.549-6.739-3.26 2.058-5.425 5.658-6.358 8.308v1.12C1.501 21.513 4.226 24 7.59 24a6.59 6.59 0 002.2-.375c.353-.12.7-.248 1.039-.378.913-.899 1.65-1.91 2.243-2.992-4.877 2.431-7.974.072-7.763-4.5l.002.001z"
      />
      <path
        fill="currentColor"
        d="M22.57 10.283c-1.212-.901-4.109-2.404-7.397-2.8.295 3.792.093 8.766-2.1 12.773a12.782 12.782 0 01-2.244 2.992c3.764-1.448 6.746-3.457 8.596-5.219 2.82-2.683 3.353-5.178 3.361-6.66a2.737 2.737 0 00-.216-1.084v-.002zM14.303 1.867C12.955.7 11.248 0 9.39 0 7.532 0 5.883.677 4.545 1.807 2.791 3.29 1.627 5.557 1.5 8.125v9.201c.932-2.65 3.097-6.25 6.357-8.307.5-.318 1.025-.595 1.569-.829 1.883-.801 3.878-.932 5.746-.706-.222-2.83-.718-5.002-.87-5.617h.001z"
      />
      <path
        fill="currentColor"
        opacity={0.5}
        d="M17.305 4.961a199.47 199.47 0 01-1.08-1.094c-.202-.213-.398-.419-.586-.622l-1.333-1.378c.151.615.648 2.786.869 5.617 3.288.395 6.185 1.898 7.396 2.8-1.306-1.275-3.475-3.487-5.266-5.323z"
      />
    </svg>
  );
}
