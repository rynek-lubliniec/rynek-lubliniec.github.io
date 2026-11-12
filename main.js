const startLoadTime = performance.now();

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { createWalkMode } from './walkMode.js';
import { createLoadingProgress } from './loadingProgress.js';
import { createFountain } from './fountain.js';

// --- Loaders ---
const textureLoader = new THREE.TextureLoader();
const meshLoader = new GLTFLoader();
meshLoader.setMeshoptDecoder(MeshoptDecoder);

const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('https://unpkg.com/three@0.187.0/examples/jsm/libs/basis/');

const blobLoader = new THREE.FileLoader();
blobLoader.setResponseType('blob');

const audioLoader = new THREE.AudioLoader();

function loadMeshAsync(url, onProgress) {
    return new Promise((resolve, reject) => meshLoader.load(url, resolve, onProgress, reject));
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

//const isDeviceFast = perfBench(10) < 25;
const isDeviceFast = true;

// --- Scene & Rendering ---
const scene = new THREE.Scene();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isDeviceFast ? 2 : 1.2));
document.body.appendChild( renderer.domElement );
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

ktx2Loader.detectSupport(renderer);

const camera = new THREE.PerspectiveCamera( 55, window.innerWidth / window.innerHeight, 1, 10000 );
camera.position.set(-40, 50, 180);

const listener = new THREE.AudioListener();
camera.add(listener);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(-10, -20 ,10);
const walk = createWalkMode({ camera, renderer, controls });

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Fountains ---
const fountainData = [
    {obj:null, pos:[-21.367, 2.8, 5.891]},
    {obj:null, pos:[-22.755, 2.8, 5.895]},
    {obj:null, pos:[-23.448, 2.8, 4.694]},
    {obj:null, pos:[-22.752, 2.8, 3.493]},
    {obj:null, pos:[-21.366, 2.8, 3.496]},
    {obj:null, pos:[-20.674, 2.8, 4.693]}
];
for (const data of fountainData) {
    data.obj = createFountain({position: new THREE.Vector3().fromArray(data.pos)});
    scene.add(data.obj.object);
}

// --- Audio ---
const ambientSound = new THREE.Audio(listener);
audioLoader.load('audio/wind.mp3', function(buffer) {
    ambientSound.setBuffer(buffer);
    ambientSound.setLoop(true);
    ambientSound.setVolume(1);
});

const fountainSound = new THREE.PositionalAudio(listener);
audioLoader.load('./audio/fountain.mp3', function(buffer) {
    fountainSound.setBuffer(buffer);
    fountainSound.setRefDistance(5);
    fountainSound.setMaxDistance(10);  
    fountainSound.setRolloffFactor(1); 
    fountainSound.setLoop(true);
    fountainSound.setVolume(3);
    fountainSound.position.set(-22, 2.8, 4.5);
});

document.body.onclick = ()=>{
    if (!fountainSound.isPlaying) fountainSound.play(); 
    if (!ambientSound.isPlaying) ambientSound.play(); 
}


// --- Materials ---
const rynekMat1 = new THREE.MeshBasicMaterial({
    lightMapIntensity: 3,
    side: 2
});

const rynekMat2 = new THREE.MeshBasicMaterial();

const skyboxData = [
    { envMapURL: 'assets/qwantani_late_afternoon_puresky.ktx2', envMap: null, skyRot: 2,   lightMapURL: `assets/lightmap_morning_${isDeviceFast?8:4}K.ktx2`, lightMap: null },
    { envMapURL: 'assets/qwantani_mid_morning_puresky.ktx2',    envMap: null, skyRot: -70,  lightMapURL: `assets/lightmap_noon_${isDeviceFast?8:4}K.ktx2`,    lightMap: null },
    { envMapURL: 'assets/qwantani_sunset_puresky.ktx2',         envMap: null, skyRot: -160,  lightMapURL: `assets/lightmap_sunset_${isDeviceFast?8:4}K.ktx2`,  lightMap: null }
];

// --- Download all assets ---
const progress = createLoadingProgress();
const t = (load) => progress.track(load);

Promise.all([
    t(p => loadKTX2Async(skyboxData[0].envMapURL, p)),
    t(p => loadKTX2Async(skyboxData[0].lightMapURL, p)),
    t(p => loadKTX2Async(skyboxData[1].envMapURL, p)),
    t(p => loadKTX2Async(skyboxData[1].lightMapURL, p)),
    t(p => loadKTX2Async(skyboxData[2].envMapURL, p)),
    t(p => loadKTX2Async(skyboxData[2].lightMapURL, p)),
    t(p => loadMeshAsync('assets/rynek.glb', p)),
    t(p => loadTextureAsync('Rynek/rynek_color.png', p)),
    t(p => loadTextureAsync('Rynek/rynek_mapa.png', p)),
])
.then((list) => {
    // Hide loading screen
    setTimeout(() => {
        document.getElementById('loadingScreen').style.opacity = '0';
        document.getElementById('loadingScreen').style.pointerEvents = 'none';

        setTimeout(() => {
            document.getElementById('loadingScreen').style.display = 'none';
        }, 1000);
    }, 500);

    progress.finish();
    
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


    const rynekMesh = list[6].scene.getObjectByName('rynek_main');
    scene.add(rynekMesh);

    walk.setCollider(rynekMesh.children[0]);

    // Base material
    rynekMat1.map = list[7];
    rynekMat1.map.flipY = false;
    rynekMat1.map.colorSpace = THREE.SRGBColorSpace;
    rynekMat1.lightMap = skyboxData[0].lightMap;

    rynekMat1.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 };
        shader.uniforms.uWindDir = { value: new THREE.Vector2(1, 0.3).normalize() };
        shader.uniforms.uWindStrength = { value: 0.3 };
        rynekMat1.userData.shader = shader;

        shader.vertexShader = `
            attribute float _leaves;
            uniform float uTime;
            uniform vec2 uWindDir;
            uniform float uWindStrength;
        ` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>

            float phase   = dot(position.xz, uWindDir) * 1.5;
            float sway    = sin(uTime * 2.0 + phase);
            float gust    = sin(uTime * 0.7 + phase * 0.3) * 0.5 + 0.5;
            float flutter = sin(uTime * 9.0 + position.x * 7.0 + position.z * 5.0);

            float strength = uWindStrength * (0.4 + 0.6 * gust);
            vec2 perp = vec2(-uWindDir.y, uWindDir.x);

            vec2 offset = uWindDir * (0.6 + 0.4 * sway) * strength + perp * flutter * 0.15 * strength;

            transformed.xz += offset * _leaves;
            `
        );
    };
    rynekMat1.needsUpdate = true;
    rynekMesh.children[0].material = rynekMat1;

    // Map material
    rynekMat2.map = list[8];
    rynekMat2.map.flipY = false;
    rynekMat2.map.colorSpace = THREE.SRGBColorSpace;
    rynekMat2.lightMap = skyboxData[0].lightMap;
    rynekMesh.children[1].material = rynekMat2;

    // Sky texture
    scene.background = skyboxData[0].envMap;
    scene.backgroundRotation.y = Math.PI / 180 * skyboxData[0].skyRot;
    
    // Sounds
    rynekMesh.add(fountainSound);

    console.log('Total loading time:', performance.now() - startLoadTime, 'ms');

    renderFrame();
});

// --- Rendering ---
let lastFrame = performance.now();

const fpsEl = document.querySelector(".fps");
const fpsArray = [];

function renderFrame() {
    requestAnimationFrame(renderFrame);
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    for (const data of fountainData) data.obj.update(dt, camera, renderer);

    if (rynekMat1.userData.shader) {
        rynekMat1.userData.shader.uniforms.uTime.value += dt;
    }

    // FPS counter
    fpsArray.push(now);
    while (now - fpsArray[0] > 1000) fpsArray.shift();
    fpsEl.textContent = 'FPS: ' + fpsArray.length;

    if (walk.active) walk.update(dt); else controls.update();

    renderer.render(scene, camera);
}

// --- UI ---

// Mode switch
let walkModeON = false;

document.querySelector('.viewModeButton').addEventListener('mousedown', () => {
    walkModeON = !walkModeON;
    
    if (walkModeON) {
        walk.prepare();
        walk.start();
    } else {
        walk.exit();
    }

    document.querySelector('.viewModeButton span').classList.toggle('active');
});

// TOD switch
document.querySelectorAll('.TOD').forEach(el => {
    el.addEventListener('mousedown', () => {
        const i = el.dataset.value;

        scene.background = skyboxData[i].envMap;
        scene.backgroundRotation.y = Math.PI / 180 * skyboxData[i].skyRot;

        rynekMat1.lightMap = rynekMat2.lightMap = skyboxData[i].lightMap;
        rynekMat1.needsUpdate = rynekMat2.needsUpdate = true;

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
