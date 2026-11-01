import * as THREE from 'three';

// three-mesh-bvh makes ray casts against the town mesh cheap enough to run every
// frame. It is loaded on demand the first time walk mode is used. If the import
// fails, walk mode still works with plain raycasting, just slower on dense meshes.
const BVH_URL = 'https://unpkg.com/three-mesh-bvh@0.9.17/build/index.module.js';

export const WALK_DEFAULTS = {
    eyeHeight: 1.55,
    radius: 0.6,
    stepHeight: 0.6,
    maxFallSpeed: 50,
    respawnDepth: -150,
    walkSpeed: 4,
    runSpeed: 10,
    gravity: 10,
    lookSpeed: -0.005,
    turnSpeed: 2,
    near: 0.2,
};

export class WalkPhysics {
    constructor(collider, cfg = WALK_DEFAULTS) {
        this.collider = collider;
        this.cfg = cfg;
        this.feet = new THREE.Vector3();
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.grounded = false;
        this.safe = new THREE.Vector3(); // last place you stood, used for respawning
        this.killY = -Infinity;
        this._ray = new THREE.Raycaster();
        this._ray.firstHitOnly = true; // used by three-mesh-bvh, ignored otherwise
        this._o = new THREE.Vector3();
        this._d = new THREE.Vector3();
        this._hits = [];
    }

    _cast(ox, oy, oz, dx, dy, dz, far) {
        this._o.set(ox, oy, oz);
        this._d.set(dx, dy, dz);
        this._ray.set(this._o, this._d);
        this._ray.near = 0;
        this._ray.far = far;
        this._hits.length = 0;
        this._ray.intersectObject(this.collider, false, this._hits);
        return this._hits[0] || null;
    }

    // Height of the surface under (x, z), looking from step height above the feet down to
    // `reach` below them. Null if there is none (the next stop is a fall).
    _ground(x, y, z, reach) {
        const { stepHeight } = this.cfg;
        const hit = this._cast(x, y + stepHeight, z, 0, -1, 0, stepHeight + reach);
        return hit ? hit.point.y : null;
    }

    // Cast rays outward from the body at two heights and push back out of walls.
    // Two passes so corners settle.
    _pushOut() {
        const { radius, stepHeight, eyeHeight } = this.cfg;
        const p = this.feet;
        const heights = [stepHeight + 0.1, eyeHeight - 0.3];
        for (let pass = 0; pass < 2; pass++) {
            for (const h of heights) {
                for (let k = 0; k < 8; k++) {
                    const a = (k * Math.PI) / 4;
                    const dx = Math.cos(a);
                    const dz = Math.sin(a);
                    const hit = this._cast(p.x, p.y + h, p.z, dx, 0, dz, radius);
                    if (hit) {
                        const push = radius - hit.distance;
                        p.x -= dx * push;
                        p.z -= dz * push;
                    }
                }
            }
        }
    }

    place(point) {
        const p = this.feet;
        p.copy(point);
        this.vx = this.vy = this.vz = 0;
        this.collider.updateWorldMatrix(true, false);
        this._pushOut();
        const g = this._ground(p.x, p.y, p.z, this.cfg.stepHeight);
        if (g !== null) p.y = g;
        this.grounded = true;
        this.safe.copy(p);
        const bottom = new THREE.Box3().setFromObject(this.collider).min.y;
        this.killY = bottom - this.cfg.respawnDepth;
    }

    // forward / strafe are in [-1, 1]; yaw is the view heading in radians.
    update(dt, yaw, forward, strafe, speed) {
        const p = this.feet;
        const s = Math.sin(yaw);
        const c = Math.cos(yaw);

        // Ease towards the target velocity so starting and stopping feel smooth.
        const k = 1 - Math.exp(-dt * 12);
        this.vx += ((-s * forward + c * strafe) * speed - this.vx) * k;
        this.vz += ((-c * forward - s * strafe) * speed - this.vz) * k;

        if (Math.abs(this.vx) + Math.abs(this.vz) > 0.01) {
            p.x += this.vx * dt;
            p.z += this.vz * dt;
            this._pushOut();
        }

        // Vertical: stay glued to the ground over curbs and slopes, otherwise fall.
        const { stepHeight, gravity, maxFallSpeed } = this.cfg;
        const reach = Math.max(stepHeight, -this.vy * dt);
        const ground = this._ground(p.x, p.y, p.z, reach);
        const dist = ground === null ? Infinity : p.y - ground; // > 0: ground is below the feet

        if (ground !== null && (dist <= 1e-3 || (this.grounded && dist <= stepHeight))) {
            this.grounded = true;
            this.vy = 0;
            p.y += (ground - p.y) * (1 - Math.exp(-dt * 18));
            if (Math.abs(ground - p.y) < 1e-3) p.y = ground;
            this.safe.copy(p);
        } else {
            this.grounded = false;
            this.vy = Math.max(this.vy - gravity * dt, -maxFallSpeed);
            let ny = p.y + this.vy * dt;
            if (ground !== null && ny <= ground) {
                ny = ground;
                this.vy = 0;
            }
            p.y = ny;
        }

        // Fell out of the world (past the edge of the model): go back to the last standing spot.
        if (p.y < this.killY) {
            p.copy(this.safe);
            this.vx = this.vy = this.vz = 0;
            this.grounded = true;
            return true;
        }
        return false;
    }
}

const MOVE_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'ShiftLeft', 'ShiftRight',
]);

export function createWalkMode({ camera, renderer, controls, options = {} }) {
    const cfg = { ...WALK_DEFAULTS, ...options };
    const dom = renderer.domElement;
    const isTouch = matchMedia('(pointer: coarse)').matches;
    const state = { active: false, picking: false };

    let collider = null;
    let physics = null;
    let yaw = 0;
    let pitch = 0;

    const keys = new Set();
    const look = { id: null, x: 0, y: 0 };
    const joy = { id: null, x: 0, y: 0 };
    const pick = { id: null, x: 0, y: 0, t: 0 };
    const saved = {
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        target: new THREE.Vector3(),
        near: camera.near,
    };
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    const ndc = new THREE.Vector2();
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const v = new THREE.Vector3();


    const hint = document.querySelector('.walkHint');

    const TIPS = {
        orbit: {
            rows: isTouch
                ? [['Drag', 'Rotate'], ['Pinch', 'Zoom'], ['Two fingers', 'Pan']]
                : [['Drag', 'Rotate'], ['Scroll', 'Zoom'], ['Right-drag', 'Pan']],
        },
        pick: {
            rows: isTouch
                ? [['Tap', 'Drop in at that spot'], ['Drag', 'Rotate the view'], ['Exit walk', 'Cancel']]
                : [['Click', 'Drop in at that spot'], ['Drag', 'Rotate the view'], ['Esc', 'Cancel']],
        },
        walk: {
            rows: isTouch
                ? []
                : [['W A S D', 'Move'], ['Arrow keys', 'Move and turn'], ['Shift', 'Run'], ['Drag', 'Look around'], ['Esc', 'Exit walk mode']],
        },
    };

    const tips = document.createElement('div');
    tips.className = 'walk-tips';
    const tipsList = document.createElement('div');
    tipsList.className = 'walk-tips-list';
    tips.append(tipsList);
    document.body.appendChild(tips);

    function renderTips(mode) {
        const { rows } = TIPS[mode];
        tipsList.replaceChildren(...rows.flatMap(([keys, action]) => {
            const k = document.createElement('span');
            k.className = 'walk-tips-key';
            k.textContent = keys;
            const a = document.createElement('span');
            a.className = 'walk-tips-action';
            a.textContent = action;
            return [k, a];
        }));

        if (isTouch && mode=='walk') {
            tips.style.opacity = "0";
        } else {
            tips.style.opacity = "1";
        }
    }


    const joyEl = document.createElement('div');
    joyEl.className = 'walk-joy';
    const knob = document.createElement('div');
    knob.className = 'walk-joy-knob';
    joyEl.appendChild(knob);
    document.body.appendChild(joyEl);

    let hintTimer = 0;
    function showHint(text, ms = 0) {
        clearTimeout(hintTimer);
        hint.textContent = text;
        hint.classList.add('visible');
        if (ms) hintTimer = setTimeout(hideHint, ms);
    }
    function hideHint() {
        clearTimeout(hintTimer);
        hint.classList.remove('visible');
    }

    const pickPrompt = () => ('Wybierz miejsce, w którym chcesz zacząć');

    function syncUI() {
        joyEl.classList.toggle('visible', state.active && isTouch);
        tips.classList.toggle('raised', state.active);
        renderTips(state.active ? 'walk' : state.picking ? 'pick' : 'orbit');
    }

    // --- Mode switching ---

    function applyCamera() {
        const f = physics.feet;
        camera.position.set(f.x, f.y + cfg.eyeHeight, f.z);
        camera.quaternion.setFromEuler(euler.set(pitch, yaw, 0, 'YXZ'));
    }

    // Build the ray-cast acceleration structure the first time it is needed.
    async function prepare() {
        if (physics) return;
        await new Promise((r) => setTimeout(r, 50)); // let the "Preparing" hint paint first
        try {
            const bvh = await import(BVH_URL);
            THREE.Mesh.prototype.raycast = bvh.acceleratedRaycast;
            THREE.BufferGeometry.prototype.computeBoundsTree = bvh.computeBoundsTree;
            if (!collider.geometry.boundsTree) {
                const t0 = performance.now();
                collider.geometry.computeBoundsTree();
                console.log(`[walk] BVH built in ${Math.round(performance.now() - t0)} ms`);
            }
        } catch (err) {
            console.warn('[walk] three-mesh-bvh could not be loaded; using plain raycasting (may be slow).', err);
        }
        collider.updateWorldMatrix(true, false);
        physics = new WalkPhysics(collider, cfg);
    }

    function enter(point) {
        state.picking = false;
        state.active = true;

        dom.style.cursor = '';

        saved.pos.copy(camera.position);
        saved.quat.copy(camera.quaternion);
        saved.target.copy(controls.target);
        saved.near = camera.near;

        // Start out facing the way the orbit camera was facing.
        camera.getWorldDirection(v);
        yaw = Math.atan2(-v.x, -v.z);
        pitch = 0;

        controls.enabled = false;
        camera.near = cfg.near;
        camera.updateProjectionMatrix();

        physics.place(point);
        applyCamera();
        syncUI();
        hideHint();
    }

    function exit() {
        if (state.active) {
            camera.position.copy(saved.pos);
            camera.quaternion.copy(saved.quat);
            camera.near = saved.near;
            camera.updateProjectionMatrix();
            controls.target.copy(saved.target);
            controls.enabled = true;
            controls.update();
        }
        state.active = false;
        state.picking = false;
        keys.clear();
        look.id = pick.id = null;
        resetJoy();
        hideHint();
        syncUI();
    }

    async function start() {
        await prepare();
        dom.style.cursor = 'crosshair';
        state.picking = true;
        syncUI();
        showHint(pickPrompt());
    }

    function pickSpot(e) {
        const r = dom.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObject(collider, false)[0];
        if (hit) {
            v.copy(hit.face.normal).transformDirection(collider.matrixWorld);
            if (v.dot(raycaster.ray.direction) > 0) v.negate();
        }
        if (!hit || v.y < 0.5) {
            showHint('Wybierz płaską powierzchnię');
            hintTimer = setTimeout(() => showHint(pickPrompt()), 2500);
            return;
        }
        enter(hit.point);
    }

    // --- Input ---

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Escape' && (state.active || state.picking)) return exit();
        if (!state.active || e.ctrlKey || e.metaKey || e.altKey || !MOVE_KEYS.has(e.code)) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        keys.add(e.code);
        e.preventDefault();
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));
    window.addEventListener('blur', () => keys.clear());

    // Drag to look (mouse and touch). While picking a spot, a still click/tap drops you in.
    dom.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (state.picking) {pickSpot
            pick.id = e.pointerId;
            pick.x = e.clientX;
            pick.y = e.clientY;
            pick.t = performance.now();
        } else if (state.active && look.id === null) {
            look.id = e.pointerId;
            look.x = e.clientX;
            look.y = e.clientY;
            dom.setPointerCapture(e.pointerId);
        }
    });
    dom.addEventListener('pointermove', (e) => {
        if (e.pointerId !== look.id) return;
        yaw += (e.clientX - look.x) * cfg.lookSpeed;
        pitch = THREE.MathUtils.clamp(pitch + (e.clientY - look.y) * cfg.lookSpeed, -1.4, 1.4);
        look.x = e.clientX;
        look.y = e.clientY;
    });
    function endPointer(e) {
        if (e.pointerId === look.id) {
            look.id = null;
        }
        if (e.pointerId === pick.id) {
            pick.id = null;
            const quick = performance.now() - pick.t < 600;
            const still = Math.hypot(e.clientX - pick.x, e.clientY - pick.y) < 6;
            if (e.type === 'pointerup' && state.picking && quick && still) pickSpot(e);
        }
    }
    dom.addEventListener('pointerup', endPointer);
    dom.addEventListener('pointercancel', endPointer);

    // On-screen joystick for touch devices.
    const STICK_RADIUS = 44;
    function moveStick(e) {
        const r = joyEl.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2);
        let dy = e.clientY - (r.top + r.height / 2);
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) {
            dx *= STICK_RADIUS / len;
            dy *= STICK_RADIUS / len;
        }
        joy.x = dx / STICK_RADIUS;
        joy.y = dy / STICK_RADIUS;
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    function resetJoy() {
        joy.id = null;
        joy.x = joy.y = 0;
        knob.style.transform = '';
    }
    joyEl.addEventListener('pointerdown', (e) => {
        if (joy.id !== null) return;
        joy.id = e.pointerId;
        joyEl.setPointerCapture(e.pointerId);
        moveStick(e);
    });
    joyEl.addEventListener('pointermove', (e) => {
        if (e.pointerId === joy.id) moveStick(e);
    });
    const endStick = (e) => { if (e.pointerId === joy.id) resetJoy(); };
    joyEl.addEventListener('pointerup', endStick);
    joyEl.addEventListener('pointercancel', endStick);

    // --- Per-frame update (call this instead of controls.update() while active) ---

    function update(dt) {
        if (!state.active) return;

        yaw += ((keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0)) * cfg.turnSpeed * dt;

        let forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
        let strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
        const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
        const keyboardSpeed = forward || strafe ? (running ? cfg.runSpeed : cfg.walkSpeed) : 0;

        const stick = Math.min(1, Math.hypot(joy.x, joy.y));
        const stickSpeed = stick * (cfg.walkSpeed + cfg.runSpeed) * 0.5;
        forward -= joy.y;
        strafe += joy.x;

        const len = Math.hypot(forward, strafe);
        if (len > 0) {
            forward /= len;
            strafe /= len;
        }
        if (physics.update(dt, yaw, forward, strafe, Math.max(keyboardSpeed, stickSpeed))) {
            showHint('You fell out of the world. Back to where you last stood.', 2500);
        }
        applyCamera();
    }

    syncUI();

    return {
        get active() { return state.active; },
        config: cfg,
        setCollider(mesh) {
            collider = mesh;
            physics = null;
            tips.hidden = false;
        },
        start,
        exit,
        update,
    };
}