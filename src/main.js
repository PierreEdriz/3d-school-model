import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

import * as Factory from './components/factory.js';

// Global State
let scene, camera, renderer;
let editCamera, walkCamera;
let orbitControls, transformControls, pointerLockControls;
let currentMode = 'EDIT'; // 'EDIT' or 'WALK'

// Walk mode variables
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let isSprinting = false;
let isSitting = false;
let preSitPosition = new THREE.Vector3();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let prevTime = performance.now();

// Classroom objects
const objects = []; // Editable objects
const obstacles = []; // Objects that block walking
let raycaster, mouse;
let selectedObject = null;

// Classroom Dimensions
const CLASS_WIDTH = 10;
const CLASS_LENGTH = 18;
const CLASS_HEIGHT = 3.5;

let doorMeshes = [];

init();
animate();

function init() {
    const container = document.getElementById('canvas-container');

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue outside

    // Cameras
    const aspect = container.clientWidth / container.clientHeight;

    // Edit Camera
    editCamera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    editCamera.position.set(0, 8, 12);

    // Walk Camera
    walkCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000);

    camera = editCamera;

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(-10, 10, -10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Classroom Base
    buildClassroom();

    // Controls
    orbitControls = new OrbitControls(editCamera, renderer.domElement);
    orbitControls.target.set(0, 0, 0);
    orbitControls.update();

    transformControls = new TransformControls(editCamera, renderer.domElement);
    transformControls.addEventListener('dragging-changed', function (event) {
        orbitControls.enabled = !event.value;
    });
    scene.add(transformControls.getHelper());

    pointerLockControls = new PointerLockControls(walkCamera, document.body);

    // Raycaster for selection
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    // Events
    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // UI Listeners
    setupUI();

    // Set initial layout
    setupInitialClassroom();
}

function buildClassroom() {
    // Floor (Inside Classroom)
    const floorGeo = new THREE.PlaneGeometry(CLASS_WIDTH, CLASS_LENGTH);
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0x8a8d8f, // Grayish concrete plain cement
        roughness: 0.95, // Non-skid finish (very rough, matte)
        metalness: 0.0
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // The dark gray apron has been removed so the gravel yard goes straight up to the walls.

    // Rock / Gravel Yard (Surrounding the room)
    const pathWidth = CLASS_WIDTH + 20; // 10 meters on left and right
    const pathLength = CLASS_LENGTH + 20; // 10 meters in front and back
    const pathGeo = new THREE.PlaneGeometry(pathWidth, pathLength);

    function createGravelTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#6e706f'; // Base gray
        ctx.fillRect(0, 0, 128, 128);

        // Add random dots (gravel stones)
        for (let i = 0; i < 3000; i++) {
            const x = Math.random() * 128;
            const y = Math.random() * 128;
            const size = Math.random() * 2 + 0.5;
            // Mix of light gray, dark gray, and brownish gray stones
            const colors = ['#8c8e8d', '#4a4d4c', '#7d7a71', '#9ca09e'];
            ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.fill();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(30, 30); // Tile it across the large yard
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    const gravelTex = createGravelTexture();

    const pathMat = new THREE.MeshStandardMaterial({
        map: gravelTex,
        roughness: 1.0,
        metalness: 0.0
    });
    const path = new THREE.Mesh(pathGeo, pathMat);
    path.rotation.x = -Math.PI / 2;
    path.position.y = -0.005; // Slightly below floor to avoid z-fighting
    path.receiveShadow = true;
    scene.add(path);

    // Sidewalk Outside Fence
    const streetGeo = new THREE.PlaneGeometry(34, 42); // 2m border around the 30x38 fence
    const streetMat = new THREE.MeshStandardMaterial({
        map: gravelTex,
        roughness: 1.0,
        metalness: 0.0
    }); // Gravel ground outside the fence as well
    const street = new THREE.Mesh(streetGeo, streetMat);
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, -0.01, 0); // Centered under the school
    street.receiveShadow = true;
    scene.add(street);

    // Custom Shader to make the lower 1-meter brown
    function applyBrownBottomShader(material) {
        material.onBeforeCompile = (shader) => {
            shader.vertexShader = `varying vec3 vWorldPos;\n` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `#include <worldpos_vertex>\n vWorldPos = worldPosition.xyz;`
            );
            shader.fragmentShader = `varying vec3 vWorldPos;\n` + shader.fragmentShader;
            // 0x5C3A21 is a dark brown color
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                `#include <color_fragment>\n if (vWorldPos.y < 0.25) { diffuseColor.rgb = vec3(0.36, 0.227, 0.13); }`
            );
        };
    }

    // Perimeter Fence (Bakod)
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xfdf8e2 }); // Very Light Beige (Bakod Mismo)
    applyBrownBottomShader(fenceMat);
    // Left Fence
    const fenceLeft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, pathLength), fenceMat);
    fenceLeft.position.set(-pathWidth / 2, 1.25, 0);
    scene.add(fenceLeft);
    obstacles.push(fenceLeft);

    // Right Fence
    const fenceRight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.5, pathLength), fenceMat);
    fenceRight.position.set(pathWidth / 2, 1.25, 0);
    scene.add(fenceRight);
    obstacles.push(fenceRight);

    // Front Fence (Split for gates)
    const fenceFrontLeft = new THREE.Mesh(new THREE.BoxGeometry(11, 2.5, 0.2), fenceMat);
    fenceFrontLeft.position.set(-9.5, 1.25, -pathLength / 2); // Covers x = -15 to -4
    scene.add(fenceFrontLeft);
    obstacles.push(fenceFrontLeft);

    const fenceFrontRight = new THREE.Mesh(new THREE.BoxGeometry(10.5, 2.5, 0.2), fenceMat);
    fenceFrontRight.position.set(9.75, 1.25, -pathLength / 2); // Covers x = 4.5 to 15
    scene.add(fenceFrontRight);
    obstacles.push(fenceFrontRight);

    // Dividing Wall (Between Big and Small Gates)
    const dividingWall = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.4), fenceMat);
    dividingWall.position.set(1.75, 1.25, -pathLength / 2); // Covers x = 1 to 2.5
    scene.add(dividingWall);
    obstacles.push(dividingWall);

    // Realistic Concrete Pillars
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xe5d3a5, roughness: 0.9 }); // Light Beige / Cream (Column ng Bakod)
    applyBrownBottomShader(pillarMat);
    function createPillar(px, pz, ph) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, ph, 0.5), pillarMat);
        p.position.set(px, ph / 2, pz);
        scene.add(p);
        obstacles.push(p);
    }

    // Gate Pillars (2.7m tall, slightly taller than the 2.5m fence)
    createPillar(-4, -19, 2.7);  // Left of Big Gate
    createPillar(1, -19, 2.7);   // Right of Big Gate (Left of dividing wall)
    createPillar(2.5, -19, 2.7); // Left of Small Gate (Right of dividing wall)
    createPillar(4.5, -19, 2.7); // Right of Small Gate

    // Additional pillars along the front fence (2.6m tall)
    createPillar(-7, -19, 2.6);
    createPillar(-11, -19, 2.6);

    createPillar(8, -19, 2.6);
    createPillar(11.5, -19, 2.6);

    // Left and Right Fence Pillars (38m length, 10 sections)
    for (let i = 0; i <= 10; i++) {
        let z = -19 + i * 3.8;
        createPillar(-15, z, 2.6); // Left wall
        createPillar(15, z, 2.6);  // Right wall
    }

    // Back Fence Pillars (30m length, 8 sections)
    for (let i = 1; i <= 7; i++) {
        let x = -15 + i * (30 / 8);
        createPillar(x, 19, 2.6);
    }



    // Gates (Interactive) - Railing / Grills
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x4e8771, metalness: 0.6, roughness: 0.3 }); // Green Tone

    function createSteelGate(gWidth, gHeight, archType = 'center') {
        const group = new THREE.Group();
        const frameMat = gateMat;

        // Horizontal bars
        const bottomBar = new THREE.Mesh(new THREE.BoxGeometry(gWidth, 0.05, 0.05), frameMat);
        bottomBar.position.set(0, 0.2, 0);
        group.add(bottomBar);
        const midBar = new THREE.Mesh(new THREE.BoxGeometry(gWidth, 0.05, 0.05), frameMat);
        midBar.position.set(0, 1.0, 0);
        group.add(midBar);

        const sideHeight = gHeight - 0.4; // Base height at edges
        const archRise = 0.4; // Extra height for arch peak

        // Vertical bars
        const innerWidth = gWidth - 0.08; // Space between side frames
        const numBars = Math.floor(innerWidth / 0.15); // Number of gaps (numBars + 1 total bars)
        const totalSpan = numBars * 0.15;
        const padding = (innerWidth - totalSpan) / 2;
        const startX = (-gWidth / 2 + 0.04) + padding;

        for (let i = 0; i <= numBars; i++) {
            const x = startX + i * 0.15;

            // Normalize x to 0..1 from left to right
            let t = (x + gWidth / 2) / gWidth;
            let h = sideHeight;
            if (archType === 'left') {
                h += archRise * Math.sin(t * Math.PI / 2); // Rises from left to right
            } else if (archType === 'right') {
                h += archRise * Math.sin((1 - t) * Math.PI / 2); // Rises from right to left
            } else {
                h += archRise * Math.sin(t * Math.PI); // Peaks in center
            }

            const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, 0.03), frameMat);
            vBar.position.set(x, h / 2, 0);

            // Spike on top
            const spike = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.1, 4), frameMat);
            spike.position.set(x, h + 0.05, 0);

            group.add(vBar);
            group.add(spike);
        }

        // Side frames
        let hLeft = sideHeight;
        if (archType === 'right') hLeft += archRise;

        let hRight = sideHeight;
        if (archType === 'left') hRight += archRise;

        const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(0.08, hLeft, 0.05), frameMat);
        leftFrame.position.set(-gWidth / 2, hLeft / 2, 0);
        group.add(leftFrame);
        const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(0.08, hRight, 0.05), frameMat);
        rightFrame.position.set(gWidth / 2, hRight / 2, 0);
        group.add(rightFrame);

        return group;
    }

    // Big Gate Left - 2.5m wide, Hinge on the left
    const bigGateLeftGroup = new THREE.Group();
    bigGateLeftGroup.position.set(-4, 0, -pathLength / 2); // Hinge at x=-4
    bigGateLeftGroup.userData = {
        isOpen: false,
        openType: 'rotate',
        openRot: -Math.PI / 2, // Swings outwards to street (-Z)
        closeRot: 0
    };
    const bigGateLeftMesh = createSteelGate(2.5, 2.5, 'left');
    bigGateLeftMesh.position.set(1.25, 0, 0); // Offset to cover x=-4 to x=-1.5
    bigGateLeftGroup.add(bigGateLeftMesh);
    scene.add(bigGateLeftGroup);
    doorMeshes.push(bigGateLeftGroup);

    // Big Gate Right - 2.5m wide, Hinge on the right
    const bigGateRightGroup = new THREE.Group();
    bigGateRightGroup.position.set(1, 0, -pathLength / 2); // Hinge at x=1
    bigGateRightGroup.userData = {
        isOpen: false,
        openType: 'rotate',
        openRot: Math.PI / 2, // Swings outwards to street (-Z)
        closeRot: 0
    };
    const bigGateRightMesh = createSteelGate(2.5, 2.5, 'right');
    bigGateRightMesh.position.set(-1.25, 0, 0); // Offset to cover x=-1.5 to x=1
    bigGateRightGroup.add(bigGateRightMesh);
    scene.add(bigGateRightGroup);
    doorMeshes.push(bigGateRightGroup);

    // Small Gate (Pedestrians) - 2.0m wide, Hinge on the right
    const smallGateGroup = new THREE.Group();
    smallGateGroup.position.set(4.5, 0, -pathLength / 2); // Hinge at x=4.5
    smallGateGroup.userData = {
        isOpen: false,
        openType: 'rotate',
        openRot: Math.PI / 2, // Swings outwards to street (-Z)
        closeRot: 0
    };
    const smallGateMesh = createSteelGate(2.0, 2.5, 'center');
    smallGateMesh.position.set(-1.0, 0, 0); // Offset to cover x=2.5 to x=4.5
    smallGateGroup.add(smallGateMesh);
    scene.add(smallGateGroup);
    doorMeshes.push(smallGateGroup);

    // ==========================================
    // SECURITY FEATURES: Guard House & Metal Detector
    // ==========================================
    
    // 1. Guard House (Security Outpost)
    const guardHouseGrp = new THREE.Group();
    // Body (Concrete)
    const ghBody = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 2.5), wallMat);
    ghBody.position.y = 1.25;
    guardHouseGrp.add(ghBody);
    // Roof (Blue painted metal)
    const ghRoofMat = new THREE.MeshStandardMaterial({color: 0x2c3e50, roughness: 0.8});
    const ghRoof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.2, 2.9), ghRoofMat);
    ghRoof.position.y = 2.6;
    guardHouseGrp.add(ghRoof);
    // Windows (Glass)
    const ghWinMat = new THREE.MeshStandardMaterial({color: 0x88ccff, transparent: true, opacity: 0.5, metalness: 0.8, roughness: 0.1});
    const ghWin1 = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.1), ghWinMat); // Front window (facing street)
    ghWin1.position.set(0, 1.5, -1.26);
    guardHouseGrp.add(ghWin1);
    const ghWin2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 2), ghWinMat); // Left window (facing gate)
    ghWin2.position.set(-1.26, 1.5, 0);
    guardHouseGrp.add(ghWin2);
    // Guard House Door (Steel)
    const ghDoorMat = new THREE.MeshStandardMaterial({color: 0x7f8c8d});
    const ghDoor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2, 0.1), ghDoorMat);
    ghDoor.position.set(0, 1, 1.26); // Back door
    guardHouseGrp.add(ghDoor);
    
    // Position the Guard House near the pedestrian gate (x=4.5 is hinge, so x=6 is next to it)
    guardHouseGrp.position.set(6.5, 0, -18.5);
    scene.add(guardHouseGrp);
    obstacles.push(ghBody); // Solid obstacle

    // 2. Walk-through Metal Detector
    const mdGrp = new THREE.Group();
    const mdMat = new THREE.MeshStandardMaterial({color: 0xbdc3c7, metalness: 0.7, roughness: 0.3});
    // Left pillar
    const mdLeft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.6), mdMat);
    mdLeft.position.set(-0.5, 1.1, 0);
    mdGrp.add(mdLeft);
    // Right pillar
    const mdRight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.6), mdMat);
    mdRight.position.set(0.5, 1.1, 0);
    mdGrp.add(mdRight);
    // Top bar
    const mdTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.6), mdMat);
    mdTop.position.set(0, 2.3, 0);
    mdGrp.add(mdTop);
    // LED Indicators (Red/Green)
    const mdLightMat = new THREE.MeshStandardMaterial({color: 0x00ff00, emissive: 0x00ff00});
    const mdLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.61), mdLightMat);
    mdLight.position.set(-0.5, 2.0, 0);
    mdGrp.add(mdLight);
    
    // Place metal detector just inside the small pedestrian gate (center x=3.5)
    mdGrp.position.set(3.5, 0, -17.5);
    scene.add(mdGrp);
    // Note: No obstacle added so the player can actually walk THROUGH the detector!

    // Back Fence
    const fenceBack = new THREE.Mesh(new THREE.BoxGeometry(pathWidth, 2.5, 0.2), fenceMat);
    fenceBack.position.set(0, 1.25, pathLength / 2);
    scene.add(fenceBack);
    obstacles.push(fenceBack);

    // Roof & Ceiling Group
    const roofGroup = new THREE.Group();
    scene.add(roofGroup);
    window.roofGroup = roofGroup; // Expose for toggling

    // Ceiling
    const ceilGeo = new THREE.PlaneGeometry(CLASS_WIDTH, CLASS_LENGTH);
    const ceilMat = new THREE.MeshStandardMaterial({
        color: 0x85d1c4, // Aqua Paradise (Same as Gutter)
        roughness: 0.9,
        side: THREE.DoubleSide
    });
    const ceiling = new THREE.Mesh(ceilGeo, ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = CLASS_HEIGHT;
    roofGroup.add(ceiling);

    // Corrugated Gable Roof (Physical 3D shape)
    const roofMat = new THREE.MeshStandardMaterial({
        color: 0x78c74a, // Vibrant Yellow-Green (matches reference image)
        roughness: 0.7,
        metalness: 0.2,
        side: THREE.DoubleSide
    });

    const roofAngle = 18 * Math.PI / 180;
    const overhang = 1.0;
    const roofHalfSpan = CLASS_WIDTH / 2 + overhang;
    const roofPanelWidth = roofHalfSpan / Math.cos(roofAngle);

    const outerPillarX = CLASS_WIDTH / 2 + 0.2;
    const ridgeHeightFromWall = outerPillarX * Math.tan(roofAngle);
    const overhangDrop = (overhang - 0.2) * Math.tan(roofAngle);
    const waveAmplitude = 0.025;
    // Lift the roof by waveAmplitude + 0.01 so the lowest point of the waves clears the walls
    const roofCenterY = CLASS_HEIGHT + (ridgeHeightFromWall - overhangDrop) / 2 + waveAmplitude + 0.01;

    // Create physical corrugated geometry
    const roofLength = CLASS_LENGTH + overhang * 2;
    // 600 segments along the length to give smooth physical waves
    const corrugatedGeo = new THREE.PlaneGeometry(roofPanelWidth, roofLength, 1, 600);
    corrugatedGeo.rotateX(-Math.PI / 2); // Lay flat on X-Z plane

    const pos = corrugatedGeo.attributes.position;
    const ridges = 120; // 120 waves across the 20m length
    for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        const wave = Math.sin((z / roofLength) * Math.PI * 2 * ridges);
        pos.setY(i, wave * waveAmplitude);
    }
    corrugatedGeo.computeVertexNormals(); // Recalculate lighting for the waves

    // Left Roof Panel
    const leftRoof = new THREE.Mesh(corrugatedGeo, roofMat);
    leftRoof.position.set(-roofHalfSpan / 2, roofCenterY, 0);
    leftRoof.rotation.z = roofAngle;
    roofGroup.add(leftRoof);

    // Right Roof Panel
    const rightRoof = new THREE.Mesh(corrugatedGeo, roofMat);
    rightRoof.position.set(roofHalfSpan / 2, roofCenterY, 0);
    rightRoof.rotation.z = -roofAngle;
    roofGroup.add(rightRoof);

    // Aqua Paradise / Foam Green Gutter & Fascia Board Material
    const fasciaMat = new THREE.MeshStandardMaterial({ color: 0x85d1c4, roughness: 0.9 });

    // Ridge Roll (Metal cap to cover the gap at the peak of the roof)
    const ridgePeakY = roofCenterY + (roofPanelWidth / 2) * Math.sin(roofAngle) + waveAmplitude;
    // Make it slightly shorter than roofLength so it stays hidden behind the fascia boards
    const ridgeRollGeo = new THREE.CylinderGeometry(0.11, 0.11, roofLength - 0.15, 8);
    ridgeRollGeo.rotateX(Math.PI / 2); // Lay flat along the Z axis
    const ridgeRoll = new THREE.Mesh(ridgeRollGeo, fasciaMat);
    ridgeRoll.position.set(0, ridgePeakY - 0.02, 0);
    roofGroup.add(ridgeRoll);

    // Side Gutters (Left and Right eaves)
    // Positioned at the exact lowest edge of the tilted roof panels
    const eaveY = roofCenterY - (roofPanelWidth / 2) * Math.sin(roofAngle);
    const gutterGeo = new THREE.BoxGeometry(0.15, 0.25, roofLength + 0.15); // +0.15 exactly matches the front/back fascia depths

    // Positioned so the outer face is exactly at +/- (roofHalfSpan + 0.15)
    const leftGutterX = -roofHalfSpan - 0.075;
    const leftGutter = new THREE.Mesh(gutterGeo, fasciaMat);
    leftGutter.position.set(leftGutterX, eaveY, 0);
    roofGroup.add(leftGutter);

    const rightGutterX = roofHalfSpan + 0.075;
    const rightGutter = new THREE.Mesh(gutterGeo, fasciaMat);
    rightGutter.position.set(rightGutterX, eaveY, 0);
    roofGroup.add(rightGutter);

    // Front and Back Sloped Fascia Boards (Custom Shape to prevent overlapping at the peak)
    const peakY = roofCenterY + (roofPanelWidth / 2) * Math.sin(roofAngle);

    const fwShape = new THREE.Shape();
    // Trace the inverted V shape of the roof
    fwShape.moveTo(0, peakY + 0.12); // Top peak (Taller to cover the ridge roll)
    fwShape.lineTo(roofHalfSpan + 0.15, eaveY + 0.125); // Top right eave
    fwShape.lineTo(roofHalfSpan + 0.15, eaveY - 0.125); // Bottom right eave
    fwShape.lineTo(0, peakY - 0.18); // Bottom peak
    fwShape.lineTo(-roofHalfSpan - 0.15, eaveY - 0.125); // Bottom left eave
    fwShape.lineTo(-roofHalfSpan - 0.15, eaveY + 0.125); // Top left eave
    fwShape.lineTo(0, peakY + 0.12); // Close shape

    const fwExtrudeSettings = { depth: 0.15, bevelEnabled: false };
    const fwGeo = new THREE.ExtrudeGeometry(fwShape, fwExtrudeSettings);

    const frontFascia = new THREE.Mesh(fwGeo, fasciaMat);
    // Position front face at roof edge. Extrude goes +Z.
    frontFascia.position.set(0, 0, roofLength / 2 - 0.075);
    roofGroup.add(frontFascia);

    const backFascia = new THREE.Mesh(fwGeo, fasciaMat);
    backFascia.position.set(0, 0, -roofLength / 2 - 0.075);
    roofGroup.add(backFascia);

    // Front and Back Pediments (Triangles closing the roof ends)
    const pedimentShape = new THREE.Shape();
    pedimentShape.moveTo(-outerPillarX, 0);
    // Keep the pediment slightly lower than the lowest trough of the corrugated roof
    // so it NEVER pokes through the waves. The roof overhang hides any small gap.
    pedimentShape.lineTo(0, ridgeHeightFromWall);
    pedimentShape.lineTo(outerPillarX, 0);
    pedimentShape.lineTo(-outerPillarX, 0);

    // We haven't defined wallMat yet, so we define it here, and remove it from below
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xeedcb0, roughness: 0.8 }); // Distinct DepEd Cream/Beige
    const pedimentMat = new THREE.MeshStandardMaterial({ color: 0xeedcb0, roughness: 0.8, side: THREE.DoubleSide });

    const extrudeSettings = { depth: 0.2, bevelEnabled: false };
    const pedimentGeo = new THREE.ExtrudeGeometry(pedimentShape, extrudeSettings);

    const frontPediment = new THREE.Mesh(pedimentGeo, pedimentMat);
    // Extrude goes +Z. Front wall occupies [CLASS_LENGTH/2 - 0.1, CLASS_LENGTH/2 + 0.1]. Place at -0.1 to match.
    frontPediment.position.set(0, CLASS_HEIGHT, CLASS_LENGTH / 2 - 0.1);
    scene.add(frontPediment); // Add to scene, not roofGroup, so it stays when roof is hidden
    obstacles.push(frontPediment);

    const backPediment = new THREE.Mesh(pedimentGeo, pedimentMat);
    // Back wall occupies [-CLASS_LENGTH/2 - 0.1, -CLASS_LENGTH/2 + 0.1]. Place at -0.1 to match.
    backPediment.position.set(0, CLASS_HEIGHT, -CLASS_LENGTH / 2 - 0.1);
    scene.add(backPediment);
    obstacles.push(backPediment);

    // Walls (wallMat is now defined above)

    // Classroom Structural Pillars
    const columnMat = new THREE.MeshStandardMaterial({ color: 0xf5df9d, roughness: 0.8 }); // S/G QDE DepEd YELLOW RAIN

    // Back Wall (Teacher side)
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(CLASS_WIDTH + 0.4, CLASS_HEIGHT, 0.2), wallMat);
    backWall.position.set(0, CLASS_HEIGHT / 2, -CLASS_LENGTH / 2);
    scene.add(backWall);
    obstacles.push(backWall);

    function createClassPillar(px, pz) {
        // Pillars are 0.4x0.4 and height matches the wall exactly
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, CLASS_HEIGHT, 0.4), columnMat);
        p.position.set(px, CLASS_HEIGHT / 2, pz);
        scene.add(p);
        obstacles.push(p);
    }

    // Horizontal Tie Beams (Top of the walls before the roof)
    const hBeamHeight = 0.4;
    const hBeamY = CLASS_HEIGHT - hBeamHeight / 2; // Centers the 0.4m beam at the very top of the 3.5m wall

    // Front and Back Horizontal Beams
    const hBeamFBGeo = new THREE.BoxGeometry(CLASS_WIDTH + 0.4, hBeamHeight, 0.4);
    const hBeamFront = new THREE.Mesh(hBeamFBGeo, columnMat);
    hBeamFront.position.set(0, hBeamY, CLASS_LENGTH / 2);
    scene.add(hBeamFront);
    obstacles.push(hBeamFront);

    const hBeamBack = new THREE.Mesh(hBeamFBGeo, columnMat);
    hBeamBack.position.set(0, hBeamY, -CLASS_LENGTH / 2);
    scene.add(hBeamBack);
    obstacles.push(hBeamBack);

    // Left and Right Horizontal Beams
    // Length is CLASS_LENGTH - 0.4 so they don't overlap with the front/back beams at the corners (prevents z-fighting)
    const hBeamLRGeo = new THREE.BoxGeometry(0.4, hBeamHeight, CLASS_LENGTH - 0.4);
    const hBeamLeft = new THREE.Mesh(hBeamLRGeo, columnMat);
    hBeamLeft.position.set(-CLASS_WIDTH / 2, hBeamY, 0);
    scene.add(hBeamLeft);
    obstacles.push(hBeamLeft);

    const hBeamRight = new THREE.Mesh(hBeamLRGeo, columnMat);
    hBeamRight.position.set(CLASS_WIDTH / 2, hBeamY, 0);
    scene.add(hBeamRight);
    obstacles.push(hBeamRight);

    // Four Corners
    createClassPillar(-5, -9);
    createClassPillar(5, -9);
    createClassPillar(-5, 9);
    createClassPillar(5, 9);

    // Left Wall Pillars (x = -5)
    createClassPillar(-5, -1.5); // Between the two large windows

    // Right Wall Pillars (x = 5)
    createClassPillar(5, -4.9); // Perfectly symmetric with center pillar and door
    createClassPillar(5, 0);
    createClassPillar(5, 4.9);

    // CR Pillars
    createClassPillar(-2, 6.5); // Outer corner of the CR
    createClassPillar(-5, 6.5); // Where CR front wall meets the Left Wall
    createClassPillar(-2, 9);   // Where CR side wall meets the Front Wall

    // Front Wall (Solid again)
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(CLASS_WIDTH + 0.4, CLASS_HEIGHT, 0.2), wallMat);
    frontWall.position.set(0, CLASS_HEIGHT / 2, CLASS_LENGTH / 2);
    scene.add(frontWall);
    obstacles.push(frontWall);

    // CR Front Wall (with door hole)
    const crWallLeft = new THREE.Mesh(new THREE.BoxGeometry(0.9, CLASS_HEIGHT, 0.2), wallMat);
    crWallLeft.position.set(-4.55, CLASS_HEIGHT / 2, CLASS_LENGTH / 2 - 2.5);
    crWallLeft.userData = { isWalkObstacle: true };
    scene.add(crWallLeft);
    obstacles.push(crWallLeft);

    const crWallRight = new THREE.Mesh(new THREE.BoxGeometry(0.9, CLASS_HEIGHT, 0.2), wallMat);
    crWallRight.position.set(-2.45, CLASS_HEIGHT / 2, CLASS_LENGTH / 2 - 2.5);
    crWallRight.userData = { isWalkObstacle: true };
    scene.add(crWallRight);
    obstacles.push(crWallRight);

    const crWallTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.2), wallMat);
    crWallTop.position.set(-3.5, 3.0, CLASS_LENGTH / 2 - 2.5);
    crWallTop.userData = { isWalkObstacle: true };
    scene.add(crWallTop);
    obstacles.push(crWallTop);

    const crWallSide = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 2.5), wallMat);
    crWallSide.position.set(-2, CLASS_HEIGHT / 2, CLASS_LENGTH / 2 - 1.25);
    crWallSide.userData = { isWalkObstacle: true };
    scene.add(crWallSide);
    obstacles.push(crWallSide);

    const crDoorMat = new THREE.MeshStandardMaterial({ color: 0x9dc359 }); // QDE DepEd TEMPTATION

    function createPanelDoor(width, height, thickness, material, handleSide = 'left') {
        const group = new THREE.Group();

        // Base door (recessed background for the panels)
        const baseGeo = new THREE.BoxGeometry(thickness * 0.4, height, width);
        const baseMesh = new THREE.Mesh(baseGeo, material);
        group.add(baseMesh);

        // Stiles (Left and right vertical borders)
        const stileWidth = 0.15;
        const stileGeo = new THREE.BoxGeometry(thickness, height, stileWidth);

        const leftStile = new THREE.Mesh(stileGeo, material);
        leftStile.position.set(0, 0, -width / 2 + stileWidth / 2);
        group.add(leftStile);

        const rightStile = new THREE.Mesh(stileGeo, material);
        rightStile.position.set(0, 0, width / 2 - stileWidth / 2);
        group.add(rightStile);

        // Heights for sections
        const bottomRailHeight = 0.25;
        const hBottomPanels = height * 0.35; // about 35% of door
        const lockRailHeight = 0.15;
        const hMidPanels = height * 0.2; // about 20%
        const midRailHeight = 0.15;
        const topRailHeight = 0.15;

        const railWidth = width - 2 * stileWidth;
        const railGeo = new THREE.BoxGeometry(thickness, 1, railWidth); // scale Y later

        // 1. Bottom Rail
        const bottomRailY = -height / 2 + bottomRailHeight / 2;
        const bottomRail = new THREE.Mesh(railGeo, material);
        bottomRail.scale.y = bottomRailHeight;
        bottomRail.position.set(0, bottomRailY, 0);
        group.add(bottomRail);

        // 2. Lock Rail (where knob is)
        const lockRailY = -height / 2 + bottomRailHeight + hBottomPanels + lockRailHeight / 2;
        const lockRail = new THREE.Mesh(railGeo, material);
        lockRail.scale.y = lockRailHeight;
        lockRail.position.set(0, lockRailY, 0);
        group.add(lockRail);

        // 3. Mid Rail
        const midRailY = lockRailY + lockRailHeight / 2 + hMidPanels + midRailHeight / 2;
        const midRail = new THREE.Mesh(railGeo, material);
        midRail.scale.y = midRailHeight;
        midRail.position.set(0, midRailY, 0);
        group.add(midRail);

        // 4. Top Rail
        const topRailY = height / 2 - topRailHeight / 2;
        const topRail = new THREE.Mesh(railGeo, material);
        topRail.scale.y = topRailHeight;
        topRail.position.set(0, topRailY, 0);
        group.add(topRail);

        // Mullions (Vertical dividers)
        const mullionWidth = 0.15;

        // Bottom section: 2 panels -> 1 mullion in center
        const bottomMullionGeo = new THREE.BoxGeometry(thickness, hBottomPanels, mullionWidth);
        const bottomMullion = new THREE.Mesh(bottomMullionGeo, material);
        bottomMullion.position.set(0, lockRailY - lockRailHeight / 2 - hBottomPanels / 2, 0);
        group.add(bottomMullion);

        // Mid section: 3 panels -> 2 mullions
        const midMullionGeo = new THREE.BoxGeometry(thickness, hMidPanels, mullionWidth);
        const midPanelSpace = (railWidth - 2 * mullionWidth) / 3;

        const midMullion1 = new THREE.Mesh(midMullionGeo, material);
        midMullion1.position.set(0, lockRailY + lockRailHeight / 2 + hMidPanels / 2, -railWidth / 2 + midPanelSpace + mullionWidth / 2);
        group.add(midMullion1);

        const midMullion2 = new THREE.Mesh(midMullionGeo, material);
        midMullion2.position.set(0, lockRailY + lockRailHeight / 2 + hMidPanels / 2, railWidth / 2 - midPanelSpace - mullionWidth / 2);
        group.add(midMullion2);

        // Top section has 1 large panel, so no mullions needed.

        // Classic Round Door Knob
        const handleMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.2 });
        const hZ = handleSide === 'left' ? -width / 2 + stileWidth / 2 : width / 2 - stileWidth / 2;

        const plateGeo = new THREE.CylinderGeometry(0.04, 0.04, thickness + 0.02, 16);
        const plate = new THREE.Mesh(plateGeo, handleMat);
        plate.rotation.z = Math.PI / 2;
        plate.position.set(0, lockRailY, hZ);
        group.add(plate);

        const knobGeo = new THREE.SphereGeometry(0.035, 16, 16);

        const knobLeft = new THREE.Mesh(knobGeo, handleMat);
        knobLeft.position.set(-thickness / 2 - 0.04, lockRailY, hZ);
        group.add(knobLeft);

        const knobRight = new THREE.Mesh(knobGeo, handleMat);
        knobRight.position.set(thickness / 2 + 0.04, lockRailY, hZ);
        group.add(knobRight);

        // Darker lines to simulate panel depth
        const edgeGeo = new THREE.EdgesGeometry(baseGeo);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x5a7530, linewidth: 2 });
        const edges = new THREE.LineSegments(edgeGeo, edgeMat);
        group.add(edges);

        return group;
    }

    function createPlasticDoor(width, height, thickness, colorHex, handleSide = 'left') {
        const group = new THREE.Group();

        // Smooth PVC Material
        const pvcMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.3, metalness: 0.1 });

        // Main door body (Flat)
        const doorGeo = new THREE.BoxGeometry(thickness, height, width);
        const doorMesh = new THREE.Mesh(doorGeo, pvcMat);
        group.add(doorMesh);

        // Louvers/Vents at the bottom (Typical for CR doors)
        const ventWidth = width * 0.7;
        for (let i = 0; i < 6; i++) {
            const slatGeo = new THREE.BoxGeometry(thickness + 0.02, 0.02, ventWidth);
            const slat = new THREE.Mesh(slatGeo, pvcMat);
            slat.position.set(0, -height / 2 + 0.2 + (i * 0.06), 0);
            slat.rotation.z = 0.3; // Angled slats
            group.add(slat);
        }

        // Round Door Knob
        const handleMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8, roughness: 0.2 });
        const midRailY = -0.1; // Slightly below center
        const hZ = handleSide === 'left' ? -width / 2 + 0.15 : width / 2 - 0.15;

        // Rosette
        const plateGeo = new THREE.CylinderGeometry(0.04, 0.04, thickness + 0.02, 16);
        const plate = new THREE.Mesh(plateGeo, handleMat);
        plate.rotation.z = Math.PI / 2;
        plate.position.set(0, midRailY, hZ);
        group.add(plate);

        // Knob
        const knobGeo = new THREE.SphereGeometry(0.035, 16, 16);
        const knobLeft = new THREE.Mesh(knobGeo, handleMat);
        knobLeft.position.set(-thickness / 2 - 0.04, midRailY, hZ);
        group.add(knobLeft);

        const knobRight = new THREE.Mesh(knobGeo, handleMat);
        knobRight.position.set(thickness / 2 + 0.04, midRailY, hZ);
        group.add(knobRight);

        return group;
    }

    const crDoorGroup = new THREE.Group();
    crDoorGroup.position.set(-4.1, 0, CLASS_LENGTH / 2 - 2.5); // Hinge at left edge
    crDoorGroup.userData = {
        isOpen: false,
        openType: 'rotate',
        openRot: -Math.PI / 2, // Swings inward to the CR
        closeRot: 0
    };

    // CR Door is 1.2 wide, rotated to face correctly
    const crDoorMesh = createPlasticDoor(1.2, 2.5, 0.05, 0x9dc359, 'right'); // QDE DepEd TEMPTATION
    crDoorMesh.rotation.y = Math.PI / 2;
    crDoorMesh.position.set(0.6, 1.25, 0); // Offset from hinge
    crDoorMesh.userData = { isWalkObstacle: true };
    crDoorGroup.add(crDoorMesh);
    scene.add(crDoorGroup);
    obstacles.push(crDoorMesh);
    doorMeshes.push(crDoorGroup);

    // Left Wall (Windows)
    // Bottom Wall
    const leftWallBottom = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, CLASS_LENGTH), wallMat);
    leftWallBottom.position.set(-CLASS_WIDTH / 2, 0.5, 0);
    scene.add(leftWallBottom);
    obstacles.push(leftWallBottom);

    // Top Wall (Split for CR high window)
    // Back part: z = -9 to z = 7.15 (length 16.15)
    const leftWallTopBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 16.15), wallMat);
    leftWallTopBack.position.set(-CLASS_WIDTH / 2, 3.0, -0.925);
    scene.add(leftWallTopBack);
    obstacles.push(leftWallTopBack);

    // Front part: z = 8.35 to z = 9.0 (length 0.65)
    const leftWallTopFront = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.65), wallMat);
    leftWallTopFront.position.set(-CLASS_WIDTH / 2, 3.0, 8.675);
    scene.add(leftWallTopFront);
    obstacles.push(leftWallTopFront);

    // Above CR Window
    const leftWallTopAboveCR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.2), wallMat);
    leftWallTopAboveCR.position.set(-CLASS_WIDTH / 2, 3.4, 7.75);
    scene.add(leftWallTopAboveCR);
    obstacles.push(leftWallTopAboveCR);

    // Below CR Window
    const leftWallTopBelowCR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.2), wallMat);
    leftWallTopBelowCR.position.set(-CLASS_WIDTH / 2, 2.6, 7.75);
    scene.add(leftWallTopBelowCR);
    obstacles.push(leftWallTopBelowCR);

    // Solid Wall Segments (Front, Middle, Back)
    // Wall near Blackboard (-Z)
    const leftWallBoardSide = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1.5), wallMat);
    leftWallBoardSide.position.set(-CLASS_WIDTH / 2, 1.75, -8.25); // spans -9 to -7.5
    scene.add(leftWallBoardSide);
    obstacles.push(leftWallBoardSide);

    // Middle Wall
    const leftWallMid = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 4.0), wallMat);
    leftWallMid.position.set(-CLASS_WIDTH / 2, 1.75, -1.5); // spans -3.5 to 0.5
    scene.add(leftWallMid);
    obstacles.push(leftWallMid);

    // Wall near CR (+Z)
    const leftWallCRSide = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 4.5), wallMat);
    leftWallCRSide.position.set(-CLASS_WIDTH / 2, 1.75, 6.75); // spans 4.5 to 9
    scene.add(leftWallCRSide);
    obstacles.push(leftWallCRSide);

    const glassMat = new THREE.MeshStandardMaterial({
        color: 0xa8d9b8, transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.8 // Green tinted glass
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4e8771 }); // Palmyra Green Frame

    function createJalousieWindow(zCenter, width = 4, wallX = -CLASS_WIDTH / 2) {
        const group = new THREE.Group();
        group.position.set(wallX, 1.0, zCenter);

        // Vertical Aluminum Frames (Mullions)
        const numFrames = Math.ceil(width) + 1;
        const spacing = width / (numFrames - 1);
        for (let i = 0; i < numFrames; i++) {
            const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.05), frameMat);
            frame.position.set(0, 0.75, -width / 2 + (i * spacing));
            group.add(frame);
        }

        // Glass Slats
        const slatGeo = new THREE.BoxGeometry(0.02, 0.12, width);
        for (let y = 0.05; y < 1.5; y += 0.1) {
            const slat = new THREE.Mesh(slatGeo, glassMat);
            slat.position.set(0, y, 0);
            slat.rotation.z = 0.4; // Tilt the jalousie slats
            group.add(slat);
        }
        return group;
    }

    function createSmallJalousieWindow(zCenter, width = 1.2, wallX = -CLASS_WIDTH / 2) {
        const group = new THREE.Group();
        group.position.set(wallX, 2.7, zCenter); // Base at y=2.7

        const numFrames = 3;
        const spacing = width / (numFrames - 1);
        for (let i = 0; i < numFrames; i++) {
            const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.6, 0.05), frameMat);
            frame.position.set(0, 0.3, -width / 2 + (i * spacing));
            group.add(frame);
        }

        const slatGeo = new THREE.BoxGeometry(0.02, 0.12, width);
        for (let y = 0.05; y < 0.6; y += 0.1) {
            const slat = new THREE.Mesh(slatGeo, glassMat);
            slat.position.set(0, y, 0);
            slat.rotation.z = 0.4;
            group.add(slat);
        }
        return group;
    }

    // High Ventilation Window for CR
    const jalousieCRHigh = createSmallJalousieWindow(7.75, 1.2, -CLASS_WIDTH / 2);
    scene.add(jalousieCRHigh);
    obstacles.push(jalousieCRHigh);

    // Window near Blackboard
    const jalousieBoard = createJalousieWindow(-5.5, 4, -CLASS_WIDTH / 2);
    scene.add(jalousieBoard);
    obstacles.push(jalousieBoard);

    // Window near CR
    const jalousieCR = createJalousieWindow(2.5, 4, -CLASS_WIDTH / 2);
    scene.add(jalousieCR);
    obstacles.push(jalousieCR);

    // Right Wall (Long side) - Two doors
    const doorWidth = 1.6;
    const doorHeight = 2.5; // Matches window top (1.0 + 1.5)
    const topWallHeight = CLASS_HEIGHT - doorHeight;

    // Centers of the doors
    const door1Z = 6.7;
    const door2Z = -6.7;

    // Wall pieces
    const rightWallBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 1.5), wallMat);
    rightWallBack.position.set(CLASS_WIDTH / 2, CLASS_HEIGHT / 2, -8.25);
    scene.add(rightWallBack);
    obstacles.push(rightWallBack);

    // Right Wall Mid (with two square windows)
    const rightMidBottom = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 11.8), wallMat);
    rightMidBottom.position.set(CLASS_WIDTH / 2, 0.5, 0);
    scene.add(rightMidBottom);
    obstacles.push(rightMidBottom);

    const rightMidTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 11.8), wallMat);
    rightMidTop.position.set(CLASS_WIDTH / 2, 3.0, 0);
    scene.add(rightMidTop);
    obstacles.push(rightMidTop);

    const rightMidFront = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1.95), wallMat);
    rightMidFront.position.set(CLASS_WIDTH / 2, 1.75, 4.925);
    scene.add(rightMidFront);
    obstacles.push(rightMidFront);

    const rightMidCenter = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1.9), wallMat);
    rightMidCenter.position.set(CLASS_WIDTH / 2, 1.75, 0);
    scene.add(rightMidCenter);
    obstacles.push(rightMidCenter);

    const rightMidBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1.95), wallMat);
    rightMidBack.position.set(CLASS_WIDTH / 2, 1.75, -4.925);
    scene.add(rightMidBack);
    obstacles.push(rightMidBack);

    // Large Jalousie Windows (Slightly shifted to perfectly center between pillars)
    const largeWindow1 = createJalousieWindow(2.45, 3.0, CLASS_WIDTH / 2);
    scene.add(largeWindow1);
    obstacles.push(largeWindow1);

    const largeWindow2 = createJalousieWindow(-2.45, 3.0, CLASS_WIDTH / 2);
    scene.add(largeWindow2);
    obstacles.push(largeWindow2);

    const rightWallFront = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 1.5), wallMat);
    rightWallFront.position.set(CLASS_WIDTH / 2, CLASS_HEIGHT / 2, 8.25);
    scene.add(rightWallFront);
    obstacles.push(rightWallFront);

    // Top pieces above doors
    const rightWallTop1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, topWallHeight, doorWidth), wallMat);
    rightWallTop1.position.set(CLASS_WIDTH / 2, CLASS_HEIGHT - topWallHeight / 2, door1Z);
    scene.add(rightWallTop1);
    obstacles.push(rightWallTop1);

    const rightWallTop2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, topWallHeight, doorWidth), wallMat);
    rightWallTop2.position.set(CLASS_WIDTH / 2, CLASS_HEIGHT - topWallHeight / 2, door2Z);
    scene.add(rightWallTop2);
    obstacles.push(rightWallTop2);

    // Interactive Doors
    const doorMeshMat = new THREE.MeshStandardMaterial({ color: 0x9dc359 }); // QDE DepEd TEMPTATION
    const doorGeo = new THREE.BoxGeometry(0.1, doorHeight, doorWidth);

    // Door 1 (Front)
    const doorGroup1 = new THREE.Group();
    doorGroup1.position.set(CLASS_WIDTH / 2, 0, door1Z + doorWidth / 2); // Hinge towards front wall
    doorGroup1.userData = {
        isOpen: false,
        openType: 'rotate',
        openRot: Math.PI / 2, // Swings outwards to corridor
        closeRot: 0
    };
    const dMesh1 = createPanelDoor(doorWidth, doorHeight, 0.05, doorMeshMat, 'left');
    dMesh1.position.set(0, doorHeight / 2, -doorWidth / 2); // Offset from hinge
    doorGroup1.add(dMesh1);
    scene.add(doorGroup1);
    doorMeshes.push(doorGroup1);
    obstacles.push(dMesh1);

    // Door 2 (Back)
    const doorGroup2 = new THREE.Group();
    doorGroup2.position.set(CLASS_WIDTH / 2, 0, door2Z - doorWidth / 2); // Hinge towards back wall
    doorGroup2.userData = {
        isOpen: false,
        openType: 'rotate',
        openRot: -Math.PI / 2, // Swings outwards to corridor
        closeRot: 0
    };
    const dMesh2 = createPanelDoor(doorWidth, doorHeight, 0.05, doorMeshMat, 'right');
    dMesh2.position.set(0, doorHeight / 2, doorWidth / 2); // Offset from hinge
    doorGroup2.add(dMesh2);
    scene.add(doorGroup2);
    doorMeshes.push(doorGroup2);
    obstacles.push(dMesh2);
}

function setupInitialClassroom() {
    // Left Board
    const board1 = Factory.createBoard();
    board1.position.set(-2.2, 0, -CLASS_LENGTH / 2 + 0.15);
    addObj(board1);

    // Right Board
    const board2 = Factory.createBoard();
    board2.position.set(2.2, 0, -CLASS_LENGTH / 2 + 0.15);
    addObj(board2);

    // Teacher Desk (Centered)
    const tDesk = Factory.createTeacherTable();
    tDesk.position.set(0, 0, -CLASS_LENGTH / 2 + 1.5);
    addObj(tDesk);

    const tChair = Factory.createTeacherChair();
    tChair.position.set(0, 0, -CLASS_LENGTH / 2 + 0.8);
    addObj(tChair);


    // Default Seating
    generateSeating(8, 6);
}

function generateSeating(rows, cols) {
    const spacingX = 1.2;
    const spacingZ = 1.4; // More legroom
    const totalWidth = (cols - 1) * spacingX + 0.8; // +0.8 for the middle aisle
    const startX = -totalWidth / 2;
    const startZ = -CLASS_LENGTH / 2 + 3.5; // Slightly backward from board

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            // Aisle in middle
            const xOff = c >= cols / 2 ? 0.8 : 0;
            const chair = Factory.createStudentChair();
            chair.position.set(startX + c * spacingX + xOff, 0, startZ + r * spacingZ);
            addObj(chair);
        }
    }
}

function addObj(obj) {
    scene.add(obj);
    objects.push(obj);
    if (obj.userData.isWalkObstacle) {
        obstacles.push(obj);
    }
}

function removeObj(obj) {
    scene.remove(obj);
    const idx = objects.indexOf(obj);
    if (idx > -1) objects.splice(idx, 1);

    const obsIdx = obstacles.indexOf(obj);
    if (obsIdx > -1) obstacles.splice(obsIdx, 1);
}

function selectObject(obj) {
    if (currentMode !== 'EDIT') return;

    if (obj) {
        selectedObject = obj;
        // Traverse up to find the group component
        while (selectedObject.parent && selectedObject.parent.type !== 'Scene' && !selectedObject.userData.isComponent) {
            selectedObject = selectedObject.parent;
        }

        if (selectedObject && selectedObject.userData.isComponent) {
            transformControls.attach(selectedObject);
            updatePropertiesPanel();
        } else {
            deselect();
        }
    } else {
        deselect();
    }
}

function deselect() {
    transformControls.detach();
    selectedObject = null;
    document.getElementById('properties-panel').style.display = 'none';
    document.getElementById('no-selection').style.display = 'block';
}

function updatePropertiesPanel() {
    if (!selectedObject) return;

    document.getElementById('properties-panel').style.display = 'block';
    document.getElementById('no-selection').style.display = 'none';

    document.getElementById('prop-name').innerText = selectedObject.userData.type || 'Object';

    document.getElementById('prop-pos-x').value = selectedObject.position.x.toFixed(2);
    document.getElementById('prop-pos-y').value = selectedObject.position.y.toFixed(2);
    document.getElementById('prop-pos-z').value = selectedObject.position.z.toFixed(2);

    document.getElementById('prop-rot-x').value = THREE.MathUtils.radToDeg(selectedObject.rotation.x).toFixed(0);
    document.getElementById('prop-rot-y').value = THREE.MathUtils.radToDeg(selectedObject.rotation.y).toFixed(0);
    document.getElementById('prop-rot-z').value = THREE.MathUtils.radToDeg(selectedObject.rotation.z).toFixed(0);
}

function setupUI() {
    // Mode Buttons
    document.getElementById('btn-edit-mode').addEventListener('click', () => setMode('EDIT'));
    document.getElementById('btn-view-mode').addEventListener('click', () => setMode('VIEW'));
    document.getElementById('btn-walk-mode').addEventListener('click', () => setMode('WALK'));
    const exitBtn = document.getElementById('btn-exit-walk');
    if (exitBtn) exitBtn.addEventListener('click', () => setMode('EDIT'));

    // Roof Toggle Checkbox
    const chkToggleRoof = document.getElementById('chk-toggle-roof');
    if (chkToggleRoof) {
        chkToggleRoof.addEventListener('change', (e) => {
            if (window.roofGroup) {
                window.roofGroup.visible = e.target.checked;
            }
        });
    }

    // Delete
    document.getElementById('btn-delete').addEventListener('click', () => {
        if (selectedObject) {
            removeObj(selectedObject);
            deselect();
        }
    });

    // Property inputs listener
    const inputs = ['pos-x', 'pos-y', 'pos-z', 'rot-x', 'rot-y', 'rot-z'];
    inputs.forEach(id => {
        document.getElementById('prop-' + id).addEventListener('change', (e) => {
            if (!selectedObject) return;
            const val = parseFloat(e.target.value);
            if (id === 'pos-x') selectedObject.position.x = val;
            if (id === 'pos-y') selectedObject.position.y = val;
            if (id === 'pos-z') selectedObject.position.z = val;
            if (id === 'rot-x') selectedObject.rotation.x = THREE.MathUtils.degToRad(val);
            if (id === 'rot-y') selectedObject.rotation.y = THREE.MathUtils.degToRad(val);
            if (id === 'rot-z') selectedObject.rotation.z = THREE.MathUtils.degToRad(val);
        });
    });
}

function setMode(mode) {
    currentMode = mode;
    const btnEdit = document.getElementById('btn-edit-mode');
    const btnView = document.getElementById('btn-view-mode');
    const btnWalk = document.getElementById('btn-walk-mode');
    const walkHud = document.getElementById('walk-hud');

    btnEdit.classList.remove('active');
    btnView.classList.remove('active');
    btnWalk.classList.remove('active');

    if (mode === 'EDIT') {
        btnEdit.classList.add('active');
        walkHud.style.display = 'none';

        pointerLockControls.unlock();

        camera = editCamera;
        orbitControls.enabled = true;

        // Re-enable editing tools
        document.getElementById('left-sidebar').style.display = 'block';
        document.getElementById('right-sidebar').style.display = 'block';

    } else if (mode === 'VIEW') {
        btnView.classList.add('active');
        walkHud.style.display = 'none';

        pointerLockControls.unlock();

        camera = editCamera;
        orbitControls.enabled = true;

        deselect();

        // Disable UI
        document.getElementById('left-sidebar').style.display = 'none';
        document.getElementById('right-sidebar').style.display = 'none';

    } else if (mode === 'WALK') {
        btnWalk.classList.add('active');
        walkHud.style.display = 'block';

        deselect();

        // Disable UI
        document.getElementById('left-sidebar').style.display = 'none';
        document.getElementById('right-sidebar').style.display = 'none';

        orbitControls.enabled = false;
        camera = walkCamera;

        // Position player outside the front gate on the new small sidewalk
        walkCamera.position.set(0, 1.6, -20.5); // On the 2m sidewalk just outside the gate
        walkCamera.rotation.set(0, Math.PI, 0); // Face towards the school (+Z)

        pointerLockControls.lock();
    }

    onWindowResize();
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
}

function onPointerDown(event) {
    if (currentMode === 'EDIT') {
        const container = document.getElementById('canvas-container');
        const rect = container.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, editCamera);
        const intersects = raycaster.intersectObjects(objects, true);

        if (intersects.length > 0) {
            selectObject(intersects[0].object);
        } else {
            // Only deselect if not clicking on transform controls
            const transformIntersects = raycaster.intersectObjects(transformControls.getHelper().children, true);
            if (transformIntersects.length === 0) {
                deselect();
            }
        }
    }
}

function onKeyDown(event) {
    if (currentMode === 'EDIT') {
        switch (event.code) {
            case 'KeyW': transformControls.setMode('translate'); break;
            case 'KeyE': transformControls.setMode('rotate'); break;
            case 'KeyR': transformControls.setMode('scale'); break;
            case 'Delete':
                if (selectedObject) {
                    removeObj(selectedObject);
                    deselect();
                }
                break;
        }
    } else if (currentMode === 'WALK') {
        switch (event.code) {
            case 'KeyW': moveForward = true; break;
            case 'KeyA': moveLeft = true; break;
            case 'KeyS': moveBackward = true; break;
            case 'KeyD': moveRight = true; break;
            case 'ShiftLeft': isSprinting = true; break;
            case 'KeyE': interact(); break;
        }
    }
}

function onKeyUp(event) {
    if (currentMode === 'WALK') {
        switch (event.code) {
            case 'KeyW': moveForward = false; break;
            case 'KeyA': moveLeft = false; break;
            case 'KeyS': moveBackward = false; break;
            case 'KeyD': moveRight = false; break;
            case 'ShiftLeft': isSprinting = false; break;
        }
    }
}

function interact() {
    if (isSitting) {
        // Stand up
        isSitting = false;
        walkCamera.position.copy(preSitPosition);
        return;
    }

    // Check doors
    let doorInteracted = false;
    doorMeshes.forEach((door) => {
        const dist = walkCamera.position.distanceTo(door.position);
        if (dist < 4.0) { // Increased interaction distance for large gates
            door.userData.isOpen = !door.userData.isOpen;
            doorInteracted = true;
        }
    });
    if (doorInteracted) return;

    // Check chairs
    objects.forEach((obj) => {
        if (obj.userData && (obj.userData.type === 'studentChair' || obj.userData.type === 'teacherChair')) {
            const dist = Math.hypot(walkCamera.position.x - obj.position.x, walkCamera.position.z - obj.position.z);
            if (dist < 1.5 && !isSitting) {
                isSitting = true;
                preSitPosition.copy(walkCamera.position);
                walkCamera.position.set(obj.position.x, 1.1, obj.position.z);
            }
        }
    });
}

function updateWalkHUD() {
    if (currentMode !== 'WALK') return;
    const prompt = document.getElementById('interaction-prompt');

    if (isSitting) {
        prompt.innerText = 'Press E to Stand Up';
        return;
    }

    let canInteractDoor = false;
    let anyOpen = false;

    doorMeshes.forEach((door) => {
        const dist = walkCamera.position.distanceTo(door.position);
        if (dist < 3.0) {
            canInteractDoor = true;
            if (door.userData.isOpen) anyOpen = true;
        }
    });

    let canInteractChair = false;
    objects.forEach((obj) => {
        if (obj.userData && (obj.userData.type === 'studentChair' || obj.userData.type === 'teacherChair')) {
            const dist = Math.hypot(walkCamera.position.x - obj.position.x, walkCamera.position.z - obj.position.z);
            if (dist < 1.5) {
                canInteractChair = true;
            }
        }
    });

    if (canInteractDoor) {
        prompt.innerText = anyOpen ? 'Press E to Close Door' : 'Press E to Open Door';
    } else if (canInteractChair) {
        prompt.innerText = 'Press E to Sit Down';
    } else {
        prompt.innerText = '';
    }
}

function checkCollision(position) {
    const radius = 0.3; // Player radius

    // World bounds
    if (position.z < -25) position.z = -25;
    if (position.z > 25) position.z = 25;
    if (position.x < -25) position.x = -25;
    if (position.x > 25) position.x = 25;

    // Perimeter Fence (x: -15 to 15, z: -19 to 19)
    const fenceX = 15;
    const fenceZ = 19;

    // Left/Right Fence
    if (position.x > fenceX - radius && position.x < fenceX + radius) {
        if (position.x < fenceX) position.x = fenceX - radius; else position.x = fenceX + radius;
    }
    if (position.x > -fenceX - radius && position.x < -fenceX + radius) {
        if (position.x < -fenceX) position.x = -fenceX - radius; else position.x = -fenceX + radius;
    }
    // Back Fence
    if (position.z > fenceZ - radius && position.z < fenceZ + radius) {
        if (position.z < fenceZ) position.z = fenceZ - radius; else position.z = fenceZ + radius;
    }
    // Front Fence (Gates at z = -19)
    if (position.z > -19 - radius && position.z < -19 + radius) {
        // Gates are doorMeshes[0] (Big Left), [1] (Big Right), and [2] (Small)
        const bigGateLeftOpen = doorMeshes[0]?.userData.isOpen;
        const bigGateRightOpen = doorMeshes[1]?.userData.isOpen;
        const smallGateOpen = doorMeshes[2]?.userData.isOpen;

        const inBigGateLeft = position.x > -4 && position.x < -1.5;
        const inBigGateRight = position.x > -1.5 && position.x < 1;
        const inSmallGate = position.x > 2.5 && position.x < 4.5;

        if ((inBigGateLeft && bigGateLeftOpen) ||
            (inBigGateRight && bigGateRightOpen) ||
            (inSmallGate && smallGateOpen)) {
            // Can pass
        } else {
            if (position.z < -19) position.z = -19 - radius; else position.z = -19 + radius;
        }
    }

    // Classroom Bounds
    const classX = CLASS_WIDTH / 2; // 5
    const classZ = CLASS_LENGTH / 2; // 9

    // Front and Back classroom walls
    if (position.x > -classX + radius && position.x < classX - radius) {
        if (position.z > -classZ - radius && position.z < -classZ + radius) {
            if (position.z < -classZ) position.z = -classZ - radius; else position.z = -classZ + radius;
        }
        if (position.z > classZ - radius && position.z < classZ + radius) {
            if (position.z < classZ) position.z = classZ - radius; else position.z = classZ + radius;
        }
    }

    // Left Wall
    if (position.z > -classZ + radius && position.z < classZ - radius) {
        if (position.x > -classX - radius && position.x < -classX + radius) {
            if (position.x < -classX) position.x = -classX - radius; else position.x = -classX + radius;
        }
    }

    // Right wall (Doorway)
    if (position.z > -classZ + radius && position.z < classZ - radius) {
        if (position.x > classX - radius && position.x < classX + radius) {
            const inDoor1 = Math.abs(position.z - 6.7) < 1.6 / 2 - radius;
            const inDoor2 = Math.abs(position.z - -6.7) < 1.6 / 2 - radius;

            // Classroom doors are doorMeshes[4] and [5]
            const door1Open = doorMeshes[4]?.userData.isOpen;
            const door2Open = doorMeshes[5]?.userData.isOpen;

            if ((inDoor1 && door1Open) || (inDoor2 && door2Open)) {
                // Pass
            } else {
                if (position.x < classX) position.x = classX - radius; else position.x = classX + radius;
            }
        }
    }

    // Obstacle Check (Furniture)
    for (let obs of obstacles) {
        if (!obs.userData || !obs.userData.isWalkObstacle) continue;

        // Simple AABB approximation
        const box = new THREE.Box3().setFromObject(obs);

        // Check intersection with player cylinder
        if (position.x + radius > box.min.x && position.x - radius < box.max.x &&
            position.z + radius > box.min.z && position.z - radius < box.max.z) {

            // Push out of collision
            const dx1 = (box.min.x - radius) - position.x;
            const dx2 = (box.max.x + radius) - position.x;
            const dz1 = (box.min.z - radius) - position.z;
            const dz2 = (box.max.z + radius) - position.z;

            const minDx = Math.abs(dx1) < Math.abs(dx2) ? dx1 : dx2;
            const minDz = Math.abs(dz1) < Math.abs(dz2) ? dz1 : dz2;

            if (Math.abs(minDx) < Math.abs(minDz)) {
                position.x += minDx;
            } else {
                position.z += minDz;
            }
        }
    }

    return position;
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    if (currentMode === 'EDIT') {
        if (selectedObject) updatePropertiesPanel(); // Refresh UI if dragging
    }

    if (currentMode === 'WALK' && pointerLockControls.isLocked) {
        // Smooth Door Animation
        doorMeshes.forEach((door) => {
            const data = door.userData;
            if (data.openType === 'rotate') {
                const targetRot = data.isOpen ? data.openRot : data.closeRot;
                door.rotation.y += (targetRot - door.rotation.y) * 8.0 * delta;
            } else if (data.openType === 'slide') {
                const targetPos = data.isOpen ? data.openPos : data.closePos;
                door.position.lerp(targetPos, 8.0 * delta);
            }
        });

        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize(); // Ensure consistent movement in all directions

        if (!isSitting) {
            const speed = isSprinting ? 50.0 : 25.0;

            if (moveForward || moveBackward) velocity.z -= direction.z * speed * delta;
            if (moveLeft || moveRight) velocity.x -= direction.x * speed * delta;

            pointerLockControls.moveRight(-velocity.x * delta);
            pointerLockControls.moveForward(-velocity.z * delta);

            // Apply Collision
            const position = walkCamera.position;
            const newPos = checkCollision(position.clone());
            position.copy(newPos);
            position.y = 1.6; // Keep at eye level
        } else {
            velocity.set(0, 0, 0);
            walkCamera.position.y = 1.1; // Sitting eye level
        }

        updateWalkHUD();
    }

    prevTime = time;

    renderer.render(scene, camera);
}
