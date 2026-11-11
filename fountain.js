import * as THREE from 'three';

const VERT = /* glsl */`
uniform float uTime;
uniform float uGravity;
uniform float uPxScale;
uniform vec2  uSize;
uniform float uPulsePeriod;
uniform float uPulsePhase;
uniform float uIsSplash;    // 1 for the splash layer, 0 for the jet
uniform float uDelay;       // splash lags the jet by roughly one flight time
attribute vec3 aVelocity;
attribute vec3 aMisc;       // x = max flight time, y = phase offset, z = random 0..1
varying float vK;
varying float vRand;

float heightFrac(float time) {
    float a = time / uPulsePeriod;
    float a2 = (time + uPulsePhase) / uPulsePeriod;
    return min(abs(sin(a) * 4.0) - 1.0, 1.0) * (0.8 + sin(uPulsePhase * 6.0 * a2)* 0.1);
}

void main() {
    float life = aMisc.x;
    float u = uTime + aMisc.y;
    float t = mod(u, life);
    float cycle = floor(u / life);

    // Jet height at the moment this droplet left the nozzle.
    float hf = heightFrac(uTime - t - uDelay);
    float s = sqrt(hf);

    // Lower pressure also means less flow: skip some launches so density stays constant.
    float r = fract(sin(dot(vec2(aMisc.z * 91.7, cycle), vec2(12.9898, 78.233))) * 43758.5453);

    vec3 vel = aVelocity * s;
    float tl = (vel.y + sqrt(vel.y * vel.y + 2.0 * uGravity * position.y)) / uGravity; // time to land

    if (r > s || t > tl) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside clip space: not drawn
        gl_PointSize = 0.0;
        vK = 0.0;
        vRand = 0.0;
        return;
    }
    float k = t / tl; // 0 = leaves nozzle, 1 = lands

    vec3 p = position;
    p.xz *= mix(1.0, hf, uIsSplash);
    p += vel * t;
    p.y -= 0.5 * uGravity * t * t;
    // tiny wobble so the stream edge is not perfectly smooth
    p.xz += vec2(sin(t * 9.0 + aMisc.z * 40.0), cos(t * 7.0 + aMisc.z * 31.0)) * uSize.x * 0.5 * k;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float size = mix(uSize.x, uSize.y, k) * (0.7 + 0.6 * aMisc.z);
    gl_PointSize = clamp(size * uPxScale / -mv.z, 1.0, 64.0);

    vK = k;
    vRand = aMisc.z;
}
`;

const FRAG = /* glsl */`
uniform vec3  uColorA;
uniform vec3  uColorB;
uniform float uAlpha;
varying float vK;
varying float vRand;

void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;

    vec3 col = mix(uColorA, uColorB, smoothstep(0.05, 0.6, vK));

    gl_FragColor = vec4(col, 0.05);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const _size = new THREE.Vector2();

export function createFountain({
    position = new THREE.Vector3(),
    maxHeight = (Math.random() * 0.2)+1,
    heightPeriod = 10,
    pulsePhase = Math.random() * 4,
    gravity = 9.81,
    spreadDeg = 3,
    nozzleHeight = 0,
    nozzleRadius = 0.03,
    dropSize = 0.017,
    count = 5000,
    colorClear = 0x4f90ab,
    colorFoam = 0xffffff,
} = {}) {
    const spread = THREE.MathUtils.degToRad(spreadDeg);
    const v0 = Math.sqrt(2 * gravity * maxHeight);
    const flightTime = (vy, drop) => (vy + Math.sqrt(vy * vy + 2 * gravity * drop)) / gravity;
    const landRadius = v0 * Math.sin(spread) * flightTime(v0, nozzleHeight);
    const splashDelay = flightTime(v0 * Math.sqrt(1 / 2), nozzleHeight);
    const TAU = Math.PI * 2;

    const shared = {
        uTime: { value: 0 },
        uGravity: { value: gravity },
        uPxScale: { value: 1 },
        uPulsePeriod: { value: Math.max(heightPeriod, 0.01) },
        uPulsePhase: { value: pulsePhase },
    };

    const makeMaterial = (size0, size1, alpha, isSplash) => new THREE.ShaderMaterial({
        uniforms: {
            ...shared,
            uSize: { value: new THREE.Vector2(size0, size1) },
            uAlpha: { value: alpha },
            uIsSplash: { value: isSplash ? 1 : 0 },
            uDelay: { value: isSplash ? splashDelay : 0 },
            uColorA: { value: new THREE.Color(colorClear) },
            uColorB: { value: new THREE.Color(colorFoam) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
    });

    function buildPoints(n, emit, material) {
        const pos = new Float32Array(n * 3);
        const vel = new Float32Array(n * 3);
        const misc = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const { o, v, life } = emit();
            pos.set(o, i * 3);
            vel.set(v, i * 3);
            misc[i * 3] = life;
            misc[i * 3 + 1] = Math.random() * life;
            misc[i * 3 + 2] = Math.random();
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('aVelocity', new THREE.BufferAttribute(vel, 3));
        geo.setAttribute('aMisc', new THREE.BufferAttribute(misc, 3));
        const pts = new THREE.Points(geo, material);
        pts.frustumCulled = false; // positions are computed on the GPU
        pts.renderOrder = 10;
        return pts;
    }

    // --- Main jet (velocities here are for the MAX height; the shader scales them)
    const jetEmit = () => {
        const speed = v0 * (1 + (Math.random() * 2 - 1) * 0.06);
        const tilt = spread * Math.pow(Math.random(), 1.6);
        const az = Math.random() * TAU;
        const r = nozzleRadius * Math.sqrt(Math.random());
        const az2 = Math.random() * TAU;
        const vy = Math.cos(tilt) * speed;
        return {
            o: [Math.cos(az2) * r, nozzleHeight, Math.sin(az2) * r],
            v: [Math.sin(tilt) * Math.cos(az) * speed, vy, Math.sin(tilt) * Math.sin(az) * speed],
            life: flightTime(vy, nozzleHeight),
        };
    };

    // --- Splash / mist where the water lands
    const splashEmit = () => {
        const az = Math.random() * TAU;
        const r = landRadius * Math.pow(Math.random(), 1.6);
        const out = az + (Math.random() - 0.5) * 0.6;
        const h = v0 * 0.05 * (0.3 + Math.random());
        const vy = v0 * (0.04 + 0.12 * Math.random());
        return {
            o: [Math.cos(az) * r, 0, Math.sin(az) * r],
            v: [Math.cos(out) * h, vy, Math.sin(out) * h],
            life: flightTime(vy, 0),
        };
    };

    const group = new THREE.Group();
    group.position.copy(position);
    group.add(buildPoints(count, jetEmit, makeMaterial(dropSize * 0.9, dropSize * 2.0, 0.1, false)));
    group.add(buildPoints(Math.round(count * 0.15), splashEmit, makeMaterial(dropSize * 3, dropSize * 0.1, 0.1, true)));

    return {
        object: group,
        update(dt, camera, renderer) {
            shared.uTime.value += dt;
            renderer.getDrawingBufferSize(_size);
            shared.uPxScale.value = _size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
        },
    };
}