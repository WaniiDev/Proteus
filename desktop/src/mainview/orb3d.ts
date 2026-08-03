import * as THREE from "three";
import type { OrbState } from "../shared/contracts";
import { ORB_STATES } from "./orb-spec";

export interface OrbFX {
  setState(state: string): void;
  pulse(): void;
  nudge(): void;
  dispose(): void;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uSpeed;
uniform float uFreq;
uniform float uVoice;
varying vec3 vN;
varying vec3 vPos;
varying float vDisp;

/* Ashima 3D simplex noise */
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

void main(){
  float t = uTime * uSpeed;
  vec3 p = position;
  float flow = snoise(p * uFreq + vec3(t, t * 0.7, -t * 0.5));
  float detail = snoise(p * uFreq * 2.4 - vec3(t * 0.6, t * 0.4, t * 0.8)) * 0.35;
  float voiceWave = uVoice * snoise(p * 3.1 + vec3(0.0, uTime * 3.2, 0.0)) * 0.22;
  float d = (flow + detail) * uAmp + voiceWave * (0.4 + uAmp);
  vDisp = d;
  vec3 np = p + normal * d;
  vN = normalize(normalMatrix * normal);
  vPos = np;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(np, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
varying vec3 vN;
varying vec3 vPos;
varying float vDisp;
void main(){
  vec3 N = normalize(vN);
  float mixv = smoothstep(-0.95, 0.95, vPos.y + vDisp * 1.7);
  vec3 col = mix(uColorB, uColorA, mixv);
  vec3 L = normalize(vec3(-0.55, 0.8, 0.55));
  float diff = clamp(dot(N, L), 0.0, 1.0);
  col *= 0.85 + 0.26 * diff;
  col = mix(col, vec3(1.0), 0.07);
  float fres = pow(1.0 - clamp(dot(N, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.6);
  col += fres * 0.34;
  col += smoothstep(0.12, 0.42, vDisp) * 0.08;
  gl_FragColor = vec4(col, 1.0);
}
`;

type OrbUniforms = {
  uTime: { value: number };
  uAmp: { value: number };
  uSpeed: { value: number };
  uFreq: { value: number };
  uVoice: { value: number };
  uColorA: { value: THREE.Color };
  uColorB: { value: THREE.Color };
};

type CurrentFx = {
  amp: number;
  speed: number;
  freq: number;
  scale: number;
  voice: number;
  a: THREE.Color;
  b: THREE.Color;
};

function stateFromElement(floatEl: HTMLElement): OrbState {
  const state = floatEl.dataset.state as OrbState | undefined;
  return state && state in ORB_STATES ? state : "idle";
}

function paletteBackground(state: OrbState): string {
  const spec = ORB_STATES[state];
  return `radial-gradient(circle at 34% 28%, ${spec.a}, ${spec.b} 78%)`;
}

export function mountOrb(floatEl: HTMLElement, canvas: HTMLCanvasElement): OrbFX {
  const layers = [
    floatEl.querySelector<HTMLElement>(".orb-layer.l0"),
    floatEl.querySelector<HTMLElement>(".orb-layer.l1"),
  ];
  let front = 0;
  let currentState = stateFromElement(floatEl);
  let disposed = false;
  let renderer: THREE.WebGLRenderer | null = null;
  let observer: ResizeObserver | null = null;
  let animationFrame: number | null = null;
  let removePointerListener: (() => void) | null = null;
  let removeMotionListener: (() => void) | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  let uniforms: OrbUniforms | null = null;
  let target = ORB_STATES[currentState];
  let pulseAmp = 0;
  let voicePhase = 0;
  let reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const clock = new THREE.Clock();
  const cur: CurrentFx = {
    amp: target.amp,
    speed: target.speed,
    freq: target.freq,
    scale: target.scale,
    voice: target.voice,
    a: new THREE.Color(target.a),
    b: new THREE.Color(target.b),
  };
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };

  const paintFallback = (state: OrbState) => {
    const back = 1 - front;
    const background = paletteBackground(state);
    if (layers[back]) {
      layers[back].style.background = background;
      layers[back].style.opacity = "1";
    }
    const frontLayer = layers[front];
    if (frontLayer) frontLayer.style.opacity = "0";
    front = back;
  };

  const syncImmediate = () => {
    cur.amp = target.amp;
    cur.speed = target.speed;
    cur.freq = target.freq;
    cur.scale = target.scale;
    cur.voice = target.voice;
    cur.a.set(target.a);
    cur.b.set(target.b);
    if (uniforms) {
      uniforms.uAmp.value = cur.amp + pulseAmp;
      uniforms.uSpeed.value = cur.speed;
      uniforms.uFreq.value = cur.freq;
      uniforms.uVoice.value = cur.voice;
      uniforms.uColorA.value.copy(cur.a);
      uniforms.uColorB.value.copy(cur.b);
    }
  };

  const resize = () => {
    if (!renderer || !camera || disposed) return;
    const width = floatEl.clientWidth || 220;
    const height = floatEl.clientHeight || 220;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (reducedMotion && scene) renderer.render(scene, camera);
  };

  const renderFrame = (dt: number) => {
    if (!renderer || !scene || !camera || !mesh || !uniforms) return;
    if (reducedMotion) {
      syncImmediate();
      renderer.render(scene, camera);
      return;
    }
    uniforms.uTime.value += dt;
    const time = uniforms.uTime.value;
    const k = 1 - Math.pow(0.0015, dt);
    cur.amp += (target.amp - cur.amp) * k;
    cur.speed += (target.speed - cur.speed) * k;
    cur.freq += (target.freq - cur.freq) * k;
    cur.scale += (target.scale - cur.scale) * k;
    cur.a.lerp(new THREE.Color(target.a), k);
    cur.b.lerp(new THREE.Color(target.b), k);

    voicePhase += dt * 9;
    const voiceTarget = target.voice * THREE.MathUtils.clamp(
      0.45 + 0.35 * Math.sin(voicePhase) + 0.25 * Math.sin(voicePhase * 1.7 + 1.3),
      0,
      1,
    );
    cur.voice += (voiceTarget - cur.voice) * (1 - Math.pow(0.0001, dt));
    pulseAmp *= Math.pow(0.02, dt);

    uniforms.uAmp.value = cur.amp + pulseAmp;
    uniforms.uSpeed.value = cur.speed;
    uniforms.uFreq.value = cur.freq;
    uniforms.uVoice.value = cur.voice;
    uniforms.uColorA.value.copy(cur.a);
    uniforms.uColorB.value.copy(cur.b);

    const breathe = Math.sin(time * 1.15) * (0.012 + cur.amp * 0.05);
    const scale = cur.scale * (1 + breathe) * (1 + pulseAmp * 0.9);
    mesh.scale.setScalar(scale);
    tilt.x += (tilt.tx - tilt.x) * (1 - Math.pow(0.001, dt));
    tilt.y += (tilt.ty - tilt.y) * (1 - Math.pow(0.001, dt));
    mesh.rotation.x = tilt.x;
    mesh.rotation.y = tilt.y + time * 0.05;
    renderer.render(scene, camera);
  };

  const frame = () => {
    if (disposed || reducedMotion) return;
    animationFrame = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    renderFrame(dt);
  };

  paintFallback(currentState);

  const controller: OrbFX = {
    setState(state) {
      if (disposed || !(state in ORB_STATES)) return;
      const nextState = state as OrbState;
      currentState = nextState;
      target = ORB_STATES[nextState];
      floatEl.dataset.state = nextState;
      paintFallback(nextState);
      if (reducedMotion) {
        syncImmediate();
        if (renderer && scene && camera) renderer.render(scene, camera);
      }
    },
    pulse() {
      if (!disposed && !reducedMotion) pulseAmp = Math.min(pulseAmp + 0.22, 0.4);
    },
    nudge() {
      if (!disposed && !reducedMotion) pulseAmp = Math.min(pulseAmp + 0.05, 0.16);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
      observer?.disconnect();
      removePointerListener?.();
      removeMotionListener?.();
      mesh?.geometry.dispose();
      mesh?.material.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss?.();
      }
      floatEl.classList.remove("webgl-on");
      if (window.orbFX === controller) window.orbFX = undefined;
    },
  };

  window.orbFX = controller;

  const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (motionQuery) {
    const onMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      if (reducedMotion) {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        animationFrame = null;
        syncImmediate();
        if (renderer && scene && camera) renderer.render(scene, camera);
      } else if (!disposed) {
        clock.start();
        frame();
      }
    };
    motionQuery.addEventListener?.("change", onMotionChange);
    removeMotionListener = () => motionQuery.removeEventListener?.("change", onMotionChange);
  }

  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    if (!renderer.getContext()) throw new Error("WebGL context unavailable");
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 10);
    camera.position.z = 3.15;
    uniforms = {
      uTime: { value: 0 },
      uAmp: { value: cur.amp },
      uSpeed: { value: cur.speed },
      uFreq: { value: cur.freq },
      uVoice: { value: cur.voice },
      uColorA: { value: cur.a.clone() },
      uColorB: { value: cur.b.clone() },
    };
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 96),
      new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }),
    );
    scene.add(mesh);
    observer = new ResizeObserver(resize);
    observer.observe(floatEl);
    resize();

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion) return;
      const rect = floatEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      tilt.tx = THREE.MathUtils.clamp((event.clientY - cy) / window.innerHeight, -0.5, 0.5) * 0.55;
      tilt.ty = THREE.MathUtils.clamp((event.clientX - cx) / window.innerWidth, -0.5, 0.5) * 0.55;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    removePointerListener = () => window.removeEventListener("pointermove", onPointerMove);
    floatEl.classList.add("webgl-on");
    if (reducedMotion) renderFrame(0);
    else frame();
  } catch {
    renderer?.dispose();
    renderer = null;
    scene = null;
    camera = null;
    mesh = null;
    uniforms = null;
  }

  return controller;
}
