// RTL Layout Boundary & Canvas Coordinates Isolator
export interface LayoutBoundaryRules {
  containerSelector: string;
  direction: 'ltr' | 'rtl';
  isolateCanvas: boolean;
}

export function computeLayoutDirection(locale: string): LayoutBoundaryRules {
  const isRtl = locale === 'ar';
  return {
    containerSelector: isRtl ? '.n8n-shell-rtl' : '.n8n-shell-ltr',
    direction: isRtl ? 'rtl' : 'ltr',
    // KANVAS HARUS SELALU LTR UNTUK MENCEGAH RUSAKNYA KOORDINAT BEZIER SVG
    isolateCanvas: true,
  };
}
