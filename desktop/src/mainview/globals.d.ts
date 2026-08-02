interface OrbFX {
  setState: (state: string) => void;
  pulse: () => void;
  nudge: () => void;
}

interface Window {
  orbFX?: OrbFX;
}

declare module "*.css" {
  const content: string;
  export default content;
}
