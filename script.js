import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { createWalkMode } from './walkMode.js';
import { createLoadingProgress } from './loadingProgress.js';

// --- Loaders ---
const startLoadTime = performance.now();

const textureLoader = new THREE.TextureLoader();
const exrLoader = new EXRLoader();
const meshLoader = new GLTFLoader();
meshLoader.setMeshoptDecoder(MeshoptDecoder);
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('https://unpkg.com/three/examples/jsm/libs/basis/');
const blobLoader = new THREE.FileLoader();
blobLoader.setResponseType('blob');

function loadMeshAsync(url, onProgress) {
    return new Promise((resolve, reject) => meshLoader.load(url, resolve, onProgress, reject));
};
function loadExrAsync(url, onProgress) {
    return new Promise((resolve, reject) => exrLoader.load(url, resolve, onProgress, reject));
};
function loadKTX2Async(url, onProgress) {
    return new Promise((resolve, reject) => ktx2Loader.load(url, resolve, onProgress, reject));
};
function loadTextureAsync(url, onProgress) {
    return new Promise((resolve, reject) => {
        blobLoader.load(url, (blob) => {
            const objectURL = URL.createObjectURL(blob);
            const done = (fn) => (arg) => { URL.revokeObjectURL(objectURL); fn(arg); };
            textureLoader.load(objectURL, done(resolve), undefined, done(reject));
        }, onProgress, reject);
    });
};

// --- Check device performance ---

function perfBench(n) {
    let sum = 0;
    for (let i=0; i<n; i++) {
        const startTime = performance.now();
        let result = 0;
        for (let i = 0; i < 1000000; i++) {
            result += Math.sqrt(i) * Math.sin(i);
        }
        sum += performance.now() - startTime;
    }
    sum /= n;
    console.log('Avg Benchmark time:', sum, 'ms');
    return sum;
}

const isDeviceFast = perfBench(10) < 27;

// --- Scene & Rendering ---

const scene = new THREE.Scene();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isDeviceFast ? 3 : 1.2));
document.body.appendChild( renderer.domElement );
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
ktx2Loader.detectSupport(renderer);

const camera = new THREE.PerspectiveCamera( 55, window.innerWidth / window.innerHeight, 1, 10000 );
camera.position.set(-40, 50, 180);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(-10, -20 ,10);
const walk = createWalkMode({ camera, renderer, controls });
walk.config.lookSpeed = (window.innerWidth>600) ? -0.005 : -0.009;

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

let lastFrame = performance.now();

function renderFrame() {
    requestAnimationFrame(renderFrame);
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    if (walk.active) walk.update(dt); else controls.update();
    renderer.render(scene, camera);
}

// --- Materials ---

const rynekMaterialBase = new THREE.MeshBasicMaterial({
    lightMapIntensity: 3,
    side: 2
});

const rynekMaterial2 = new THREE.MeshBasicMaterial();

const skyboxData = [
    { envMapURL: 'assets/qwantani_late_afternoon_puresky.exr', envMap: null, skyRot: -20,   lightMapURL: `assets/lightmap_morning_${isDeviceFast?8:4}K.ktx2`, lightMap: null },
    { envMapURL: 'assets/qwantani_mid_morning_puresky.exr',    envMap: null, skyRot: -70,  lightMapURL: `assets/lightmap_noon_${isDeviceFast?8:4}K.ktx2`,    lightMap: null },
    { envMapURL: 'assets/qwantani_sunset_puresky.exr',         envMap: null, skyRot: -160,  lightMapURL: `assets/lightmap_sunset_${isDeviceFast?8:4}K.ktx2`,  lightMap: null }
];

// --- Download all assets ---

const progress = createLoadingProgress();
const t = (load) => progress.track(load);

Promise.all([
    t(p => loadExrAsync(skyboxData[0].envMapURL, p)),
    t(p => loadKTX2Async(skyboxData[0].lightMapURL, p)),
    t(p => loadExrAsync(skyboxData[1].envMapURL, p)),
    t(p => loadKTX2Async(skyboxData[1].lightMapURL, p)),
    t(p => loadExrAsync(skyboxData[2].envMapURL, p)),
    t(p => loadKTX2Async(skyboxData[2].lightMapURL, p)),
    t(p => loadMeshAsync('assets/rynek.glb', p)),
    t(p => loadTextureAsync('Rynek/rynek_color.png', p)),
    t(p => loadTextureAsync('Rynek/rynek_mapa.png', p)),
])
.then((list) => {

    for (let i=0; i<3; i++) {
        // Skybox texture
        list[i*2].mapping = THREE.EquirectangularReflectionMapping;
        skyboxData[i].envMap = list[i*2];

        // Lightmap texture
        list[i*2+1].colorSpace = THREE.LinearSRGBColorSpace;
        list[i*2+1].flipY = false;
        list[i*2+1].channel = 1;
        skyboxData[i].lightMap = list[i*2+1];
    }

    const gltf = list[6].scene;
    scene.add(gltf);

    const rynekMainMesh = gltf.getObjectByName('rynek_main');
    const rynekMapMesh = gltf.getObjectByName('rynek_map');

    walk.setCollider(rynekMainMesh);

    // Base material
    rynekMaterialBase.map = list[7];
    rynekMaterialBase.map.flipY = false;
    rynekMaterialBase.map.colorSpace = THREE.SRGBColorSpace;
    rynekMaterialBase.lightMap = skyboxData[0].lightMap;
    rynekMaterialBase.needsUpdate = true;

    rynekMainMesh.material = rynekMaterialBase;

    // Map material
    rynekMaterial2.map = list[8];
    rynekMaterial2.map.flipY = false;
    rynekMaterial2.map.colorSpace = THREE.SRGBColorSpace;
    rynekMaterial2.lightMap = skyboxData[0].lightMap;
    rynekMapMesh.material = rynekMaterial2;

    // Background texture
    scene.background = skyboxData[0].envMap;
    scene.backgroundRotation.y = Math.PI / 180 * skyboxData[0].skyRot;
    progress.finish();

    // Hide loading screen
    setTimeout(() => {
        document.getElementById('loadingScreen').style.opacity = '0';
        document.getElementById('loadingScreen').style.pointerEvents = 'none';

        setTimeout(() => {
            document.getElementById('loadingScreen').style.display = 'none';
        }, 1000);
    }, 500);

    renderFrame();

    console.log('Total loading time:', performance.now() - startLoadTime, 'ms');
});


// Mode switch
let walkModeON = false;

document.querySelector('.viewModeButton').addEventListener('mousedown', () => {
    walkModeON = !walkModeON;
    
    walkModeON ? walk.start() : walk.exit();

    document.querySelector('.viewModeButton span').classList.toggle('active');
});

// TOD switch
document.querySelectorAll('.TOD').forEach(el => {
    el.addEventListener('mousedown', () => {
        const i = el.dataset.value;

        scene.background = skyboxData[i].envMap;
        scene.backgroundRotation.y = Math.PI / 180 * skyboxData[i].skyRot;

        rynekMaterialBase.lightMap = rynekMaterial2.lightMap = skyboxData[i].lightMap;
        rynekMaterialBase.needsUpdate = rynekMaterial2.needsUpdate = true;

        setTimeout(() => {
            document.querySelector(".TODhandle").style.transform = `translateX(${i*50}px)`;
            document.querySelectorAll(".TODhandle img").forEach(el=>{el.style.opacity = 0;})
            document.querySelectorAll(".TODhandle img").forEach(el=>{el.style.transform = 'scale(0.6)';})
            document.querySelector(`.TODicon${i}`).style.opacity = 1;
            document.querySelector(`.TODicon${i}`).style.transform = 'scale(1)';  
        }, 50); 
    });
});

// Menu button
document.querySelector(".menuButton").addEventListener("mousedown", (e)=>{
    document.querySelector(".menuButton").classList.toggle("active");
    document.querySelector(".sideMenu").classList.toggle("active");
});
