import * as THREE from 'three';

const BVH_URL = 'https://unpkg.com/three-mesh-bvh@0.9.17/build/index.module.js';
const LMBIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" class="navIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Left click"><rect x="6" y="2" width="12" height="20" rx="6"/><path d="M11.25 2.05A6 6 0 0 0 6 8v1h5.25z" fill="currentColor"/></svg>';
const RMBIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" class="navIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Right click"><rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12.75 2.05A6 6 0 0 1 18 8v1h-5.25z" fill="currentColor"/></svg>';
const ScrollIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" class="navIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Scroll"><rect x="6" y="2" width="12" height="20" rx="6"/><rect x="10.75" y="6" width="2.5" height="7" rx="1.25" fill="currentColor" stroke="none"/></svg>';

const deathMessages = [
    ['Tam jest tylko wiatr. I bardzo długi spadek.', 0],
    ['Przykro nam, ale latanie jest dostępne tylko dla ptaków i graczy z odpowiednim abonamentem.', 0],
    ['Brawo za odwagę! Za brak rozsądku odejmujemy 10 punktów. Za styl dodajemy 12.', 0],
    ['Odważny ruch. Głupi, ale odważny. Pamiętaj, że ta wyspa lewituje, a ty nie.', 0],
    ['Ładny skok! Szkoda, że nie masz skrzydeł.', 0],
    ['Ziemia nie jest aż tak samotna, żebyś musiał ją odwiedzać.', 0],
    ['Nie testuj fizyki. Ona zawsze wygrywa.', 0],
    ['Winda jest zepsuta. Schody też. Zostań tutaj.', 0],
    ['Nie, nie masz skrzydeł. Sprawdziliśmy. Dwa razy.', 2],
    ['Słuchaj, zaczynam się martwić. Wszystko w porządku? Mogę zaproponować herbatę.', 3],
    ['Znowu? Wyspa ma dość. Nie jesteś jej pierwszym samobójcą, ale na pewno najbardziej upartym.', 5],
    ['Kiedy spadasz, masz dużo czasu na przemyślenia. Szkoda, że tylko na jedno: ‘Po co ja to zrobiłem?', 5],
    ['Niech ci będzie. Skacz. Ja tu sobie posiedzę i popatrzę na chmury.', 7],
    ['Gratulacje, Wygrałeś. Zadowolony?', 999]
];

export const WALK_SETTINGS = {
    eyeHeight: 1.55,
    radius: 0.4,
    stepHeight: 0.5,
    maxFallSpeed: 50,
    respawnDepth: -100,
    walkSpeed: 4,
    runSpeed: 8,
    gravity: 9.81,
    jumpSpeed: 4,
    jumpBufferTime: 0.2,
    coyoteTime: 0.12,
    lookSpeed: (matchMedia('(pointer: coarse)').matches) ? -0.009 : -0.005,
    turnSpeed: 2,
    near: 0.2,
    maxDeaths: 10,
    zoomMinFov: 15,
    zoomWheelSpeed: 0.001,
    zoomSmoothing: 10,
};

export class WalkPhysics {
    constructor(collider, cfg = WALK_SETTINGS) {
        this.collider = collider;
        this.cfg = cfg;
        this.feet = new THREE.Vector3();
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.grounded = false;
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
        this.safe = new THREE.Vector3(); // last place player stood, used for respawning
        this.killY = -Infinity;
        this._ray = new THREE.Raycaster();
        this._ray.firstHitOnly = true; // used by three-mesh-bvh, ignored otherwise
        this._o = new THREE.Vector3();
        this._d = new THREE.Vector3();
        this._hits = [];
        this.respawnEnabled = true;
        this.deaths = 0;
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
        this.jumpBufferTimer = 0;
        this.deaths = 0;
        this.respawnEnabled = true;
        this.collider.updateWorldMatrix(true, false);
        this._pushOut();
        this.grounded = true;
        this.coyoteTimer = this.cfg.coyoteTime;
        this.safe.copy(p);
        const bottom = new THREE.Box3().setFromObject(this.collider).min.y;
        this.killY = bottom - this.cfg.respawnDepth;
    }

    queueJump() {
        this.jumpBufferTimer = this.cfg.jumpBufferTime;
    }

    // forward / strafe are in [-1, 1]; yaw is the view heading in radians.
     update(dt, yaw, forward, strafe, speed) {
        dt = Math.min(dt, 0.1);
        const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
        const h = dt / steps;
        let fell = false;
        for (let i = 0; i < steps; i++) {
            if (this._step(h, yaw, forward, strafe, speed)) fell = true;
        }
        return fell;
    }

    _step(dt, yaw, forward, strafe, speed) {
        const p = this.feet;
        const s = Math.sin(yaw);
        const c = Math.cos(yaw);

        const k = 1 - Math.exp(-dt * 12);
        this.vx += ((-s * forward + c * strafe) * speed - this.vx) * k;
        this.vz += ((-c * forward - s * strafe) * speed - this.vz) * k;

        if (Math.abs(this.vx) + Math.abs(this.vz) > 0.01) {
            p.x += this.vx * dt;
            p.z += this.vz * dt;
            this._pushOut();
        }

        const { stepHeight, gravity, maxFallSpeed } = this.cfg;

        // Apply gravity first so the ground ray reaches as far as we're about to move.
        this.vy = Math.max(this.vy - gravity * dt, -maxFallSpeed);
        const reach = Math.max(stepHeight, -this.vy * dt) + 0.05;
        const ground = this._ground(p.x, p.y, p.z, reach);

        this.grounded = false;
        this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);

        let ny = p.y + this.vy * dt;
        // Never end a step below the surface found under us (that surface is at most
        // stepHeight above the feet, so this also handles stepping up).
        if (ground !== null && ny <= ground) {
            ny = ground;
            if (this.vy <= 0) {
                this.vy = 0;
                this.grounded = true;
                this.coyoteTimer = this.cfg.coyoteTime;
            }
        }
        p.y = ny;
        if (this.grounded) this.safe.copy(p);

        if (p.y < this.killY) {
            if (!this.respawnEnabled) return false;

            this.deaths++;
            if (this.deaths >= this.cfg.maxDeaths) {
                this.respawnEnabled = false;
                return true;
            }
            p.copy(this.safe);
            this.vx = this.vy = this.vz = 0;
            this.grounded = true;
            this.coyoteTimer = this.cfg.coyoteTime;
            return true;
        }

        if (this.jumpBufferTimer > 0) {
            if (this.grounded || this.coyoteTimer > 0) {
                this.grounded = false;
                this.coyoteTimer = 0;
                this.vy = this.cfg.jumpSpeed;
                this.jumpBufferTimer = 0;
            } else {
                this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
            }
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
    const cfg = { ...WALK_SETTINGS, ...options };
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
    let jumpRequested = false;
    const saved = {
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        target: new THREE.Vector3(),
        near: camera.near,
        fov: camera.fov,        // <-- new
    };

    let baseFov = camera.fov;
    let fovTarget = camera.fov;
    const touches = new Map();  // active pointers, for pinch
    let pinchDist = 0;

    function setZoom(fov) {
        fovTarget = THREE.MathUtils.clamp(fov, cfg.zoomMinFov, baseFov);
    }
    function pinchDistance() {
        const [a, b] = [...touches.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
    }
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true;
    const ndc = new THREE.Vector2();
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const v = new THREE.Vector3();


    const hint = document.querySelector('.UIHint');

    const TIPS = {
        orbit: {
            rows: isTouch
                ? [['Drag', 'Obróć'], ['Pinch', 'Przybliż / Oddal'], ['Dwa palce', 'Przesuń']]
                : [[LMBIcon, 'Obróć'], [ScrollIcon, 'Przybliż / Oddal'], [RMBIcon, 'Przesuń']],
        },
        walk: {
            rows: [[LMBIcon, 'Obróć'], ['W A S D', 'Ruch'], ['Strzałki', 'Ruch i Obrót'], ['Shift', 'Bieg'], ['Spacja', 'Skok']],
        },
    };

    const tips = document.querySelector(".navTips");

    function renderTips(mode) {
        const { rows } = TIPS[mode];
        tips.replaceChildren(...rows.flatMap(([keys, action]) => {
            const k = document.createElement('span');
            k.className = 'navKey';
            k.innerHTML = keys;
            const a = document.createElement('span');
            a.className = 'navAction';
            a.innerHTML = action;
            return [k, a];
        }));

        if (isTouch && mode=='walk') {
            tips.style.opacity = "0";
        } else {
            tips.style.opacity = "1";
        }
    }


    const joyEl = document.createElement('div');
    joyEl.className = 'walkJoystick';
    const knob = document.createElement('div');
    knob.className = 'walkJoystickKnob';
    joyEl.appendChild(knob);
    document.body.appendChild(joyEl);

    const jumpEl = document.createElement('button');
    jumpEl.className = 'walkJump';
    jumpEl.type = 'button';
    jumpEl.textContent = '⬆';
    jumpEl.setAttribute('aria-label', 'Skocz');
    document.body.appendChild(jumpEl);

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
        jumpEl.classList.toggle('visible', state.active && isTouch);
        renderTips(state.active ? 'walk' : 'orbit');
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
                collider.geometry.computeBoundsTree();
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
        saved.fov = camera.fov;
        baseFov = camera.fov;
        fovTarget = camera.fov;
        touches.clear();
        pinchDist = 0;

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
            camera.fov = saved.fov;
            camera.near = saved.near;
            camera.updateProjectionMatrix(); 
            camera.updateProjectionMatrix();
            controls.target.copy(saved.target);
            controls.enabled = true;
            controls.update();
        }
        state.active = false;
        state.picking = false;
        keys.clear();
        touches.clear();
        pinchDist = 0;
        jumpRequested = false;
        look.id = pick.id = null;
        resetJoy();
        hideHint();
        syncUI();
    }

    async function start() {
        //await prepare();
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
        if (!state.active || e.ctrlKey || e.metaKey || e.altKey) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        if (e.code === 'Space' && state.active && !e.repeat) {
            jumpRequested = true;
            e.preventDefault();
            return;
        }
        if (!MOVE_KEYS.has(e.code)) return;
        keys.add(e.code);
        e.preventDefault();
    });
    window.addEventListener('keyup', (e) => keys.delete(e.code));
    window.addEventListener('blur', () => {
        keys.clear();
        jumpRequested = false;
    });

    jumpEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (state.active) jumpRequested = true;
    });

    dom.addEventListener('wheel', (e) => {
        if (!state.active) return;
        e.preventDefault();
        setZoom(fovTarget * Math.exp(e.deltaY * cfg.zoomWheelSpeed));
    }, { passive: false });

    // Drag to look (mouse and touch). While picking a spot, a still click/tap drops you in.
    dom.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        if (state.active) {
            touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (touches.size >= 2) {      // second finger = pinch, stop looking
                pinchDist = pinchDistance();
                look.id = null;
                return;
            }
        }

        if (state.picking) {
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
        if (touches.has(e.pointerId)) {
            touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        }
        if (touches.size === 2) {
            const d = pinchDistance();
            if (pinchDist > 0 && d > 0) setZoom(fovTarget * pinchDist / d); // spread = zoom in
            pinchDist = d;
            return;
        }
        if (e.pointerId !== look.id) return;

        const sens = cfg.lookSpeed * (camera.fov / baseFov); // slower look when zoomed
        yaw += (e.clientX - look.x) * sens;
        pitch = THREE.MathUtils.clamp(pitch + (e.clientY - look.y) * sens, -1.4, 1.4);
        look.x = e.clientX;
        look.y = e.clientY;
    });

    function endPointer(e) {
        touches.delete(e.pointerId);
        pinchDist = 0;

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

        if (jumpRequested) {
            physics.queueJump();
            jumpRequested = false;
        }

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
            const deaths = physics.deaths;

            if (!physics.respawnEnabled) {
                showHint(deathMessages[deathMessages.length - 1][0], 5000);
            } else {
                while (true) {
                    const M = deathMessages[Math.floor(Math.random() * deathMessages.length)];
                    if (deaths >= M[1]) {
                        showHint(M[0], 3500);
                        break;
                    }
                }
            }
        }
        if (Math.abs(camera.fov - fovTarget) > 0.01) {
            camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-dt * cfg.zoomSmoothing));
            camera.updateProjectionMatrix();
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
        prepare
    };
}