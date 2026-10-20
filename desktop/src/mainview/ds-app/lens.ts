/** Port of Proteus.installLens / lensRipple (design system bundle.js). The lens is the SVG filter `.lens` glass refracts through. */

export const LENS_ID = "proteus-lens";
export const LENS_WAVE_ID = "proteus-lens-wave";

/** Same markup as Proteus.lensSVG; <Lens/> renders the JSX equivalent. */
export const LENS_SVG =
  '<svg class="proteus-lens" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0">' +
  `<filter id="${LENS_ID}" x="-10%" y="-10%" width="120%" height="120%">` +
  '<feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="noise"></feTurbulence>' +
  '<feDisplacementMap in="SourceGraphic" in2="noise" scale="10" xChannelSelector="R" yChannelSelector="G">' +
  `<animate id="${LENS_WAVE_ID}" attributeName="scale" values="10;34;10" keyTimes="0;0.35;1" calcMode="spline" keySplines="0.16 1 0.3 1;0.65 0 0.35 1" dur="0.7s" begin="indefinite" fill="remove"></animate>` +
  "</feDisplacementMap></filter></svg>";

export function reducedMotion(win: Pick<Window, "matchMedia"> | undefined = globalThis.window): boolean {
  try {
    return !!win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** For plain pages: add the lens filter once. The app renders <Lens/> instead. */
export function installLens(root?: Element): void {
  const doc = root?.ownerDocument ?? document;
  if (doc.getElementById(LENS_ID)) return;
  const host = doc.createElement("div");
  host.innerHTML = LENS_SVG;
  (root ?? doc.body).appendChild(host.firstChild as Node);
}

/** The glass ripples while a surface transforms: the displacement swells to lens-ripple and settles (700ms). Never on a timer. */
export function lensRipple(): void {
  if (reducedMotion()) return;
  const wave = document.getElementById(LENS_WAVE_ID) as (Element & { beginElement?: () => void }) | null;
  try {
    wave?.beginElement?.();
  } catch {
    /* SMIL unavailable: the glass simply stays still */
  }
}
