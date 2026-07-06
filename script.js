import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

// --- Loaders ---

const textureLoader = new THREE.TextureLoader();
const exrLoader = new EXRLoader();
const meshLoader = new GLTFLoader();
meshLoader.setMeshoptDecoder(MeshoptDecoder);
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('https://unpkg.com/three/examples/jsm/libs/basis/');


function loadMeshAsync(url) {
    return new Promise((resolve, reject) => meshLoader.load(url, resolve, undefined, reject));
};

function loadExrAsync(url) {
    return new Promise((resolve, reject) => exrLoader.load(url, resolve, undefined, reject));
};

function loadTextureAsync(url) {
    return new Promise((resolve, reject) => textureLoader.load(url, resolve, undefined, reject));
};

function loadKTX2Async(url) {
    return new Promise((resolve, reject) => ktx2Loader.load(url, resolve, undefined, reject));
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
    console.log(`Avg Benchmark time: ${sum}ms`);
    return sum;
}

const isDeviceFast = perfBench(10) < 27;

// --- Scene & Rendering ---

const scene = new THREE.Scene();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.2));
document.body.appendChild( renderer.domElement );
renderer.toneMapping = THREE.AgXToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
ktx2Loader.detectSupport(renderer);

const camera = new THREE.PerspectiveCamera( 55, window.innerWidth / window.innerHeight, 1, 10000 );
camera.position.set(-40, 50, 180);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(-10, -20 ,10);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function renderFrame() {
    requestAnimationFrame(renderFrame);
    controls.update();
    renderer.render(scene, camera);
}

// --- Materials ---

const rynekMaterialBase = new THREE.MeshBasicMaterial({
    lightMapIntensity: 3,
    side: 2
});

const rynekMaterialSpecular = new THREE.MeshStandardMaterial({
    color: 0x000000,
    metalness: 1,
    envMapIntensity: 4,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});

const rynekMaterial2 = new THREE.MeshBasicMaterial();

let specularEffectMesh;
let specularColor;

window.mat = rynekMaterialSpecular;

const skyboxData = [
    { envMapURL: 'assets/qwantani_late_afternoon_puresky_4k.exr', envMap: null, skyRot: -20,   lightMapURL: `assets/lightmap_morning_${isDeviceFast?8:4}K.ktx2`, lightMap: null, specularColor: 0xfff5e6 },
    { envMapURL: 'assets/qwantani_mid_morning_puresky_4k.exr',    envMap: null, skyRot: -70,  lightMapURL: `assets/lightmap_noon_${isDeviceFast?8:4}K.ktx2`,    lightMap: null, specularColor: 0xfffff9 },
    { envMapURL: 'assets/qwantani_sunset_puresky_4k.exr',         envMap: null, skyRot: -160,  lightMapURL: `assets/lightmap_sunset_${isDeviceFast?8:4}K.ktx2`,  lightMap: null, specularColor: 0xffd5bb }
];

// --- Download all assets ---

Promise.all([
    loadExrAsync(skyboxData[0].envMapURL),
    loadKTX2Async(skyboxData[0].lightMapURL),
    loadExrAsync(skyboxData[1].envMapURL),
    loadKTX2Async(skyboxData[1].lightMapURL),
    loadExrAsync(skyboxData[2].envMapURL),
    loadKTX2Async(skyboxData[2].lightMapURL),
    loadMeshAsync('assets/rynek.glb'),
    loadTextureAsync('Rynek/rynek_color.png'),
    loadTextureAsync('Rynek/rynek_roughness.png'),
    loadTextureAsync('Rynek/rynek_mapa.png'),
    loadTextureAsync('Rynek/rynek_specular.png'),
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

    // Base material
    rynekMaterialBase.map = list[7];
    rynekMaterialBase.map.flipY = false;
    rynekMaterialBase.map.colorSpace = THREE.SRGBColorSpace;
    rynekMaterialBase.lightMap = skyboxData[0].lightMap;
    rynekMaterialBase.needsUpdate = true;

    rynekMainMesh.material = rynekMaterialBase;

    // Specular reflections material
    rynekMaterialSpecular.roughnessMap = list[8];
    rynekMaterialSpecular.roughnessMap.flipY = false;
    rynekMaterialSpecular.envMap = skyboxData[0].envMap;
    rynekMaterialSpecular.alphaMap = list[10];
    rynekMaterialSpecular.alphaMap.flipY = false;
    rynekMaterialSpecular.needsUpdate = true;

    rynekMaterialSpecular.onBeforeCompile = (shader) => {
        shader.uniforms.envMapTint = { value: new THREE.Color(0,0,0) };

        specularColor = shader.uniforms.envMapTint;
        specularColor.value.set(skyboxData[0].specularColor);

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <envmap_physical_pars_fragment>',
            `
            #include <envmap_physical_pars_fragment>
            uniform vec3 envMapTint;
            `
        );

        // Multiply the indirect irradiance / radiance by the tint color
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_fragment_end>',
            `
            #include <lights_fragment_end>
            reflectedLight.indirectDiffuse *= envMapTint;
            reflectedLight.indirectSpecular *= envMapTint;
            `
        );
    };

    specularEffectMesh = new THREE.Mesh(rynekMainMesh.geometry, rynekMaterialSpecular)
    if (isDeviceFast) rynekMainMesh.add(specularEffectMesh);
    
    // Map material
    rynekMaterial2.map = list[9];
    rynekMaterial2.map.flipY = false;
    rynekMaterial2.map.colorSpace = THREE.SRGBColorSpace;
    rynekMaterial2.lightMap = skyboxData[0].lightMap;
    rynekMapMesh.material = rynekMaterial2;

    // Background texture
    scene.background = skyboxData[0].envMap;
    scene.backgroundRotation.y = Math.PI / 180 * skyboxData[0].skyRot;

    // Hide loading screen
    setTimeout(() => {
        document.getElementById('loadingScreen').style.opacity = '0';

        setTimeout(() => {
            document.getElementById('loadingScreen').style.display = 'none';
        }, 1000);
    });

    renderFrame();

    // specularColor fix
    specularEffectMesh.visible = false;
    window.spec = specularColor;
});


// Quality switch
document.querySelectorAll('.quality').forEach(el => {
    el.addEventListener('mousedown', () => {
        const i = el.dataset.value;

        specularEffectMesh.visible = (i==1) ? true : false;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, (i==1) ? 3 : 1.2));

        setTimeout(() => {
            document.querySelector(".qualityHandle").style.transform = `translateX(${i*50}px)`;
            document.querySelector(".qualityHandle").textContent = (i==1) ? 'HD' : 'SD';
        }, 50); 
    });
});

// TOD switch
document.querySelectorAll('.TOD').forEach(el => {
    el.addEventListener('mousedown', () => {
        const i = el.dataset.value;

        scene.background = skyboxData[i].envMap;
        scene.backgroundRotation.y = Math.PI / 180 * skyboxData[i].skyRot;

        specularColor.value.set(skyboxData[i].specularColor);

        rynekMaterialBase.lightMap = skyboxData[i].lightMap;
        rynekMaterialBase.needsUpdate = true;
        rynekMaterial2.lightMap = skyboxData[i].lightMap;
        rynekMaterial2.needsUpdate = true;
        rynekMaterialSpecular.envMapRotation.y = Math.PI / 180 * skyboxData[i].skyRot;

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
