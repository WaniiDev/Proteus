import { LENS_ID, LENS_WAVE_ID } from "../ds-app/lens";

/** The Tide lens filter, mounted once at the shell root. `.lens` glass refracts through url(#proteus-lens); lensRipple() animates it. */
export function Lens() {
  return (
    <svg className="proteus-lens" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id={LENS_ID} x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves={2} seed={7} result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale={10} xChannelSelector="R" yChannelSelector="G">
          <animate id={LENS_WAVE_ID} attributeName="scale" values="10;34;10" keyTimes="0;0.35;1" calcMode="spline" keySplines="0.16 1 0.3 1;0.65 0 0.35 1" dur="0.7s" begin="indefinite" fill="remove" />
        </feDisplacementMap>
      </filter>
    </svg>
  );
}
