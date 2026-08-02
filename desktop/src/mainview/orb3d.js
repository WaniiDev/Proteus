/* ============================================================
   PROTEUS — Liquid Orb (Three.js / WebGL)
   A simplex-noise displaced sphere driven by state "FX targets":
   amplitude, speed, frequency, scale and palette all ease toward
   the current orb state, so the orb feels liquid and adaptive
   rather than switching between canned animations.
   Falls back silently to the CSS orb when WebGL is unavailable.
   ============================================================ */
import * as THREE from 'three';

const floatEl = document.getElementById('orbFloat');
const canvas = document.getElementById('orbCanvas');

/* Per-state liquid behaviour. Colors mirror ORB_STATES in app.js. */
const STATE_FX = {
  idle:        { amp: 0.10, speed: 0.40, freq: 1.00, scale: 1.00, voice: 0.0, a: '#a7e5d3', b: '#c8b8e0' },
  listening:   { amp: 0.17, speed: 0.85, freq: 1.35, scale: 1.05, voice: 1.0, a: '#a8c8e8', b: '#a7e5d3' },
  thinking:    { amp: 0.21, speed: 1.05, freq: 1.65, scale: 1.00, voice: 0.0, a: '#c8b8e0', b: '#a8c8e8' },
  working:     { amp: 0.27, speed: 1.65, freq: 1.45, scale: 1.05, voice: 0.6, a: '#f4c5a8', b: '#c8b8e0' },
  waiting:     { amp: 0.06, speed: 0.22, freq: 1.00, scale: 0.97, voice: 0.0, a: '#e7e5e4', b: '#f0efed' },
  speaking:    { amp: 0.19, speed: 1.25, freq: 1.35, scale: 1.02, voice: 1.0, a: '#e8b8c4', b: '#f4c5a8' },
  done:        { amp: 0.12, speed: 0.50, freq: 1.20, scale: 1.12, voice: 0.0, a: '#a7e5d3', b: '#d8f3e8' },
  interrupted: { amp: 0.03, speed: 0.10, freq: 1.00, scale: 0.80, voice: 0.0, a: '#d6d3d1', b: '#e7e5e4' },
  recovery:    { amp: 0.16, speed: 0.60, freq: 1.20, scale: 0.92, voice: 0.0, a: '#c8b8e0', b: '#a7e5d3' },
};

const VERT = /* glsl */`
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
  float flow  = snoise(p * uFreq + vec3(t, t * 0.7, -t * 0.5));
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

const FRAG = /* glsl */`
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

function boot() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) return;
  } catch (_) { return; }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 10);
  camera.position.z = 3.15;

  const uniforms = {
    uTime:   { value: 0 },
    uAmp:    { value: 0.14 },
    uSpeed:  { value: 0.45 },
    uFreq:   { value: 1.15 },
    uVoice:  { value: 0 },
    uColorA: { value: new THREE.Color('#a7e5d3') },
    uColorB: { value: new THREE.Color('#c8b8e0') },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 96),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG })
  );
  scene.add(mesh);

  /* live values ease toward targets every frame — the "liquid" feel */
  const cur = { amp: 0.14, speed: 0.45, freq: 1.15, scale: 1, voice: 0, a: new THREE.Color('#a7e5d3'), b: new THREE.Color('#c8b8e0') };
  let target = STATE_FX[floatEl.dataset.state] || STATE_FX.idle;
  let pulseAmp = 0;   // transient spike (dock arrival, typing nudge)
  let voicePhase = 0;

  /* pointer parallax */
  const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    const r = floatEl.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    tilt.tx = THREE.MathUtils.clamp((e.clientY - cy) / window.innerHeight, -0.5, 0.5) * 0.55;
    tilt.ty = THREE.MathUtils.clamp((e.clientX - cx) / window.innerWidth, -0.5, 0.5) * 0.55;
  }, { passive: true });

  function resize() {
    const w = floatEl.clientWidth || 220, h = floatEl.clientHeight || 220;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(floatEl);
  resize();

  const clock = new THREE.Clock();
  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    uniforms.uTime.value += dt;
    const t = uniforms.uTime.value;

    /* ease toward state targets */
    const k = 1 - Math.pow(0.0015, dt); // frame-rate independent damping
    cur.amp   += (target.amp   - cur.amp)   * k;
    cur.speed += (target.speed - cur.speed) * k;
    cur.freq  += (target.freq  - cur.freq)  * k;
    cur.scale += (target.scale - cur.scale) * k;
    cur.a.lerp(new THREE.Color(target.a), k);
    cur.b.lerp(new THREE.Color(target.b), k);

    /* pseudo voice amplitude for listening/speaking */
    voicePhase += dt * 9;
    const voiceTarget = target.voice * THREE.MathUtils.clamp(
      0.45 + 0.35 * Math.sin(voicePhase) + 0.25 * Math.sin(voicePhase * 1.7 + 1.3), 0, 1);
    cur.voice += (voiceTarget - cur.voice) * (1 - Math.pow(0.0001, dt));

    /* decay any transient pulse */
    pulseAmp *= Math.pow(0.02, dt);

    uniforms.uAmp.value = cur.amp + pulseAmp;
    uniforms.uSpeed.value = cur.speed;
    uniforms.uFreq.value = cur.freq;
    uniforms.uVoice.value = cur.voice;
    uniforms.uColorA.value.copy(cur.a);
    uniforms.uColorB.value.copy(cur.b);

    /* breathing + dock/typing squash */
    const breathe = Math.sin(t * 1.15) * (0.012 + cur.amp * 0.05);
    const s = cur.scale * (1 + breathe) * (1 + pulseAmp * 0.9);
    mesh.scale.setScalar(s);

    tilt.x += (tilt.tx - tilt.x) * (1 - Math.pow(0.001, dt));
    tilt.y += (tilt.ty - tilt.y) * (1 - Math.pow(0.001, dt));
    mesh.rotation.x = tilt.x;
    mesh.rotation.y = tilt.y + t * 0.05;

    renderer.render(scene, camera);
  }
  frame();

  window.orbFX = {
    setState(state) { if (STATE_FX[state]) target = STATE_FX[state]; },
    pulse() { pulseAmp = Math.min(pulseAmp + 0.22, 0.4); },
    nudge() { pulseAmp = Math.min(pulseAmp + 0.05, 0.16); },
  };
  floatEl.classList.add('webgl-on');
}

boot();
