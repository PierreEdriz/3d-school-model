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
const CLASS_WIDTH = 12;
const SINGLE_ROOM_LENGTH = 18;
const CLASS_LENGTH = SINGLE_ROOM_LENGTH * 6;
const CLASS_HEIGHT = 3.5;
const WINDOW_WIDTH = 3.4;
const WINDOW_OFFSET = 3.1;

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
    dirLight.castShadow = false;
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

    // Straight corridor running continuously along the classroom door side.
    const corridorCenterX = CLASS_WIDTH / 2 + 1.1;
    const corridorMat = new THREE.MeshStandardMaterial({
        color: 0xb8b2a0,
        roughness: 0.9,
        metalness: 0.0
    });
    const corridor = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.06, CLASS_LENGTH),
        corridorMat
    );
    corridor.position.set(corridorCenterX, 0.03, 0);
    corridor.receiveShadow = true;
    scene.add(corridor);

    // Covered-school-corridor details: canopy, posts, and front railing.
    const corridorStructureMat = new THREE.MeshStandardMaterial({
        color: 0xe5d3a5,
        roughness: 0.85,
        metalness: 0.0
    });
    const corridorRailMat = new THREE.MeshStandardMaterial({
        color: 0xf2ead2,
        roughness: 0.8,
        metalness: 0.0
    });

    const corridorCanopy = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 0.18, CLASS_LENGTH),
        corridorStructureMat
    );
    corridorCanopy.position.set(corridorCenterX, CLASS_HEIGHT + 0.05, 0);
    corridorCanopy.castShadow = true;
    corridorCanopy.receiveShadow = true;
    scene.add(corridorCanopy);

    const corridorOuterX = CLASS_WIDTH / 2 + 2.2;
    const corridorPostPositions = [];
    const corridorPosts = [];
    for (let i = 0; i <= 6; i++) {
        corridorPostPositions.push(-CLASS_LENGTH / 2 + i * SINGLE_ROOM_LENGTH);
    }
    for (let i = 0; i < 6; i++) {
        const roomCenter = -CLASS_LENGTH / 2 + SINGLE_ROOM_LENGTH / 2 + i * SINGLE_ROOM_LENGTH;
        corridorPostPositions.push(roomCenter - WINDOW_OFFSET, roomCenter + WINDOW_OFFSET);
    }
    corridorPostPositions.forEach((z) => {
        const post = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, CLASS_HEIGHT, 0.4),
            corridorStructureMat
        );
        post.position.set(corridorOuterX, CLASS_HEIGHT / 2, z);
        post.castShadow = true;
        scene.add(post);
        corridorPosts.push(post);
    });

    const corridorBalustrade = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.95, CLASS_LENGTH),
        corridorRailMat
    );
    corridorBalustrade.position.set(corridorOuterX, 0.48, 0);
    corridorBalustrade.castShadow = true;
    scene.add(corridorBalustrade);

    const corridorTopRail = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.12, CLASS_LENGTH),
        corridorStructureMat
    );
    corridorTopRail.position.set(corridorOuterX, 1.02, 0);
    corridorTopRail.castShadow = true;
    scene.add(corridorTopRail);

    const greenTubeMat = new THREE.MeshStandardMaterial({ color: 0x9dc359, roughness: 0.65, metalness: 0.15 });
    const terraceGreenTube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, CLASS_LENGTH, 16),
        greenTubeMat
    );
    terraceGreenTube.rotation.x = Math.PI / 2;
    terraceGreenTube.position.set(corridorOuterX, 1.32, 0);
    terraceGreenTube.castShadow = true;
    scene.add(terraceGreenTube);

    const corridorUpperHorizontalPost = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.4, CLASS_LENGTH),
        corridorStructureMat
    );
    corridorUpperHorizontalPost.position.set(corridorOuterX, CLASS_HEIGHT - 0.2, 0);
    corridorUpperHorizontalPost.castShadow = true;
    scene.add(corridorUpperHorizontalPost);

    corridorPostPositions.forEach((z) => {
        const terraceGreenTubeSupport = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 1.32, 16),
            greenTubeMat
        );
        terraceGreenTubeSupport.position.set(corridorOuterX + 0.12, 0.66, z);
        terraceGreenTubeSupport.castShadow = true;
        scene.add(terraceGreenTubeSupport);
    });

    const centerGreenTubeSupport = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 1.32, 16),
        greenTubeMat
    );
    centerGreenTubeSupport.position.set(corridorOuterX + 0.12, 0.66, 0);
    centerGreenTubeSupport.castShadow = true;
    scene.add(centerGreenTubeSupport);

    // Three green uprights in the middle of every bay between the main posts.
    const sortedRailingPosts = [...new Set(corridorPostPositions)].sort((a, b) => a - b);
    for (let i = 0; i < sortedRailingPosts.length - 1; i++) {
        const startZ = sortedRailingPosts[i];
        const endZ = sortedRailingPosts[i + 1];
        [0.25, 0.5, 0.75].forEach((ratio) => {
            const visibleGreenUpright = new THREE.Mesh(
                new THREE.CylinderGeometry(0.07, 0.07, 0.42, 16),
                greenTubeMat
            );
            visibleGreenUpright.position.set(corridorOuterX, 1.14, startZ + (endZ - startZ) * ratio);
            visibleGreenUpright.castShadow = true;
            scene.add(visibleGreenUpright);
        });
    }

    // The dark gray apron has been removed so the gravel yard goes straight up to the walls.

    // Rock / Gravel Yard (Surrounding the room)
    const pathWidth = CLASS_WIDTH + 40; // 10 meters on left and right
    const pathLength = CLASS_LENGTH + 40; // 10 meters in front and back
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
    const streetGeo = new THREE.PlaneGeometry(54, CLASS_LENGTH + 44); // 2m border around the 30x38 fence
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

    

    // Roof & Ceiling Group
    const roofGroup = new THREE.Group();
    scene.add(roofGroup);
    const roofCenterOffsetX = 0;
    roofGroup.position.x = roofCenterOffsetX;
    roofGroup.visible = false;
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
    const roofCenterY = CLASS_HEIGHT + (ridgeHeightFromWall - overhangDrop) / 2 + waveAmplitude + 0.44;

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
    leftRoof.position.set(-roofHalfSpan / 2, roofCenterY + 0.12, 0);
    leftRoof.rotation.z = roofAngle;
    roofGroup.add(leftRoof);

    // Right Roof Panel
    const mainRightRoofSpan = CLASS_WIDTH / 2 + 2.5;
    const mainRightRoofWidth = mainRightRoofSpan / Math.cos(roofAngle);
    const mainRightRoofGeo = new THREE.PlaneGeometry(mainRightRoofWidth, roofLength, 1, 600);
    mainRightRoofGeo.rotateX(-Math.PI / 2);
    const mainRightRoofPos = mainRightRoofGeo.attributes.position;
    for (let i = 0; i < mainRightRoofPos.count; i++) {
        const z = mainRightRoofPos.getZ(i);
        const wave = Math.sin((z / roofLength) * Math.PI * 2 * ridges);
        mainRightRoofPos.setY(i, wave * waveAmplitude);
    }
    mainRightRoofGeo.computeVertexNormals();
    const rightRoof = new THREE.Mesh(mainRightRoofGeo, roofMat);
    const mainRightRoofCenterY = roofCenterY + 0.35 - (mainRightRoofSpan - roofHalfSpan) * Math.sin(roofAngle);
    rightRoof.position.set(mainRightRoofSpan / 2, mainRightRoofCenterY, 0);
    rightRoof.rotation.z = -roofAngle;
    roofGroup.add(rightRoof);

    // Aqua Paradise / Foam Green Gutter & Fascia Board Material
    const fasciaMat = new THREE.MeshStandardMaterial({ color: 0x85d1c4, roughness: 0.9 });

    // Ridge Roll (Metal cap to cover the gap at the peak of the roof)
    const ridgePeakY = roofCenterY + (roofPanelWidth / 2) * Math.sin(roofAngle) + waveAmplitude;
    // Side Gutters (Left and Right eaves)
    // Positioned at the exact lowest edge of the tilted roof panels
    const eaveY = roofCenterY - (roofPanelWidth / 2) * Math.sin(roofAngle);
    // Attach the corridor canopy directly below the main roof eave.
    const corridorCanopyGeo = new THREE.PlaneGeometry(3.8, roofLength, 1, 600);
    corridorCanopyGeo.rotateX(-Math.PI / 2);
    const corridorCanopyPos = corridorCanopyGeo.attributes.position;
    for (let i = 0; i < corridorCanopyPos.count; i++) {
        const z = corridorCanopyPos.getZ(i);
        const wave = Math.sin((z / roofLength) * Math.PI * 2 * ridges);
        corridorCanopyPos.setY(i, wave * waveAmplitude);
    }
    corridorCanopyGeo.computeVertexNormals();
    corridorCanopy.geometry.dispose();
    corridorCanopy.geometry = corridorCanopyGeo;
    corridorCanopy.material = roofMat;
    corridorCanopy.position.y = eaveY - 0.12;
    corridorCanopy.visible = false;

    // With the roof removed, corridor posts align exactly with the classroom wall height.
    const corridorPostHeight = CLASS_HEIGHT;
    corridorPosts.forEach((post) => {
        post.scale.y = corridorPostHeight / CLASS_HEIGHT;
        post.position.y = corridorPostHeight / 2;
    });

    // Front and Back Sloped Fascia Boards (Custom Shape to prevent overlapping at the peak)
    const peakY = roofCenterY + (roofPanelWidth / 2) * Math.sin(roofAngle);

    const fwShape = new THREE.Shape();
    // Trace the inverted V shape of the roof
    fwShape.moveTo(0, peakY + 0.12); // Top peak (Taller to cover the ridge roll)
    fwShape.lineTo(roofHalfSpan + 0.03, eaveY + 0.125); // Top right eave
    fwShape.lineTo(roofHalfSpan + 0.03, eaveY - 0.125); // Bottom right eave
    fwShape.lineTo(0, peakY - 0.18); // Bottom peak
    fwShape.lineTo(-roofHalfSpan - 0.03, eaveY - 0.125); // Bottom left eave
    fwShape.lineTo(-roofHalfSpan - 0.03, eaveY + 0.125); // Top left eave
    fwShape.lineTo(0, peakY + 0.12); // Close shape

    const fwExtrudeSettings = { depth: 0.15, bevelEnabled: false };
    const fwGeo = new THREE.ExtrudeGeometry(fwShape, fwExtrudeSettings);

    // Front and Back Pediments (Triangles closing the roof ends)
    const pedimentShape = new THREE.Shape();
    const gableHalfSpan = roofHalfSpan - 0.05;
    pedimentShape.moveTo(-gableHalfSpan, 0);
    // Keep the pediment slightly lower than the lowest trough of the corrugated roof
    // so it NEVER pokes through the waves. The roof overhang hides any small gap.
    // Extend the wall gable upward to meet the fixed roof underside and close the gap.
    const wallGablePeak = roofCenterY + (roofPanelWidth / 2) * Math.sin(roofAngle) - CLASS_HEIGHT - 0.03;
    pedimentShape.lineTo(0, wallGablePeak);
    pedimentShape.lineTo(gableHalfSpan, 0);
    pedimentShape.lineTo(-gableHalfSpan, 0);

    // We haven't defined wallMat yet, so we define it here, and remove it from below
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xeedcb0, roughness: 0.8 });

    // Small attached rooms at both ends, each one-third of a classroom length.
    const endRoomLength = SINGLE_ROOM_LENGTH / 3;
    const endRoomCenters = [-CLASS_LENGTH / 2 - endRoomLength / 2, CLASS_LENGTH / 2 + endRoomLength / 2];
    const addedRoomPosts = [];
    const addedRoomBeams = [];
    endRoomCenters.forEach((z) => {
        const endWall = new THREE.Mesh(new THREE.BoxGeometry(CLASS_WIDTH, CLASS_HEIGHT, 0.18), wallMat);
        endWall.position.set(0, CLASS_HEIGHT / 2, z + (z < 0 ? -endRoomLength / 2 : endRoomLength / 2));
        scene.add(endWall);

        const endGableHalfSpan = z < 0 ? corridorOuterX - 0.4 : corridorOuterX + 0.2;
        const endGableShape = new THREE.Shape();
        endGableShape.moveTo(-CLASS_WIDTH / 2 - 0.15, 0);
        endGableShape.lineTo(0, ridgeHeightFromWall - 0.05);
        endGableShape.lineTo(endGableHalfSpan, 0);
        endGableShape.lineTo(-CLASS_WIDTH / 2 - 0.15, 0);
        const endGable = new THREE.Mesh(
            new THREE.ExtrudeGeometry(endGableShape, { depth: 0.2, bevelEnabled: false }),
            wallMat
        );
        endGable.position.set(0, CLASS_HEIGHT, z + (z < 0 ? -endRoomLength / 2 : endRoomLength / 2));
        scene.add(endGable);

        const packageRoomFloor = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, endRoomLength), corridorMat);
        packageRoomFloor.position.set(corridorCenterX, 0.04, z);
        packageRoomFloor.receiveShadow = true;
        scene.add(packageRoomFloor);

        [-1, 1].forEach((side) => {
            if (side === 1) return; // Keep the door-side corridor open.
            const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, CLASS_HEIGHT, endRoomLength), wallMat);
            sideWall.position.set(side * (CLASS_WIDTH / 2 - 0.09), CLASS_HEIGHT / 2, z);
            scene.add(sideWall);
        });

        [-1, 1].forEach((xSide) => {
            [-1, 1].forEach((zSide) => {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, CLASS_HEIGHT, 0.4), corridorStructureMat);
                post.position.set(xSide * (CLASS_WIDTH / 2), CLASS_HEIGHT / 2, z + zSide * (endRoomLength / 2));
                scene.add(post);
                addedRoomPosts.push(post);
            });
        });

        [-1, 1].forEach((zSide) => {
            const beam = new THREE.Mesh(new THREE.BoxGeometry(CLASS_WIDTH, 0.4, 0.4), corridorStructureMat);
            beam.position.set(0, CLASS_HEIGHT - 0.2, z + zSide * (endRoomLength / 2));
            scene.add(beam);
            addedRoomBeams.push(beam);

            const fullFrontBeam = new THREE.Mesh(
                new THREE.BoxGeometry(corridorOuterX + CLASS_WIDTH / 2, 0.4, 0.4),
                corridorStructureMat
            );
            fullFrontBeam.position.set((corridorOuterX - CLASS_WIDTH / 2) / 2, CLASS_HEIGHT - 0.2, z + zSide * (endRoomLength / 2));
            scene.add(fullFrontBeam);
            addedRoomBeams.push(fullFrontBeam);

        });

        [-1, 1].forEach((xSide) => {
            const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, endRoomLength), corridorStructureMat);
            beam.position.set(xSide * (CLASS_WIDTH / 2), CLASS_HEIGHT - 0.2, z);
            scene.add(beam);
            addedRoomBeams.push(beam);
        });

        // Matching frame on the package/corridor-side extension.
        [-1, 1].forEach((xSide) => {
            [-1, 1].forEach((zSide) => {
                const packagePost = new THREE.Mesh(new THREE.BoxGeometry(0.4, CLASS_HEIGHT, 0.4), corridorStructureMat);
                packagePost.position.set(corridorCenterX + xSide * 1.1, CLASS_HEIGHT / 2, z + zSide * (endRoomLength / 2));
                scene.add(packagePost);
                addedRoomPosts.push(packagePost);
            });
        });

        [-1, 1].forEach((zSide) => {
            const packageBeam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.4, 0.4), corridorStructureMat);
            packageBeam.position.set(corridorCenterX, CLASS_HEIGHT - 0.2, z + zSide * (endRoomLength / 2));
            scene.add(packageBeam);
            addedRoomBeams.push(packageBeam);
        });

        const endRoomRailing = new THREE.Mesh(
            new THREE.BoxGeometry(0.14, 0.95, endRoomLength),
            corridorRailMat
        );
        endRoomRailing.position.set(corridorOuterX, 0.48, z);
        scene.add(endRoomRailing);

        const endRoomTopRail = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.12, endRoomLength),
            corridorStructureMat
        );
        endRoomTopRail.position.set(corridorOuterX, 1.02, z);
        scene.add(endRoomTopRail);

        const endGreenTube = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.06, endRoomLength, 16),
            greenTubeMat
        );
        endGreenTube.rotation.x = Math.PI / 2;
        endGreenTube.position.set(corridorOuterX, 1.32, z);
        endGreenTube.castShadow = true;
        scene.add(endGreenTube);

        const endRoomUpperPost = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.4, endRoomLength),
            corridorStructureMat
        );
        endRoomUpperPost.position.set(corridorOuterX, CLASS_HEIGHT - 0.2, z);
        endRoomUpperPost.castShadow = true;
        scene.add(endRoomUpperPost);
        addedRoomBeams.push(endRoomUpperPost);

        [0.25, 0.5, 0.75].forEach((ratio) => {
            const endGreenUpright = new THREE.Mesh(
                new THREE.CylinderGeometry(0.07, 0.07, 0.42, 16),
                greenTubeMat
            );
            endGreenUpright.position.set(corridorOuterX, 1.14, z - endRoomLength / 2 + endRoomLength * ratio);
            endGreenUpright.castShadow = true;
            scene.add(endGreenUpright);
        });

        const endZ = z + (z < 0 ? -endRoomLength / 2 : endRoomLength / 2);
        const endSideRailing = new THREE.Mesh(
            new THREE.BoxGeometry(2.2, 0.95, 0.14),
            corridorRailMat
        );
        endSideRailing.position.set(corridorCenterX, 0.48, endZ);
        scene.add(endSideRailing);

        const endSideTopRail = new THREE.Mesh(
            new THREE.BoxGeometry(2.2, 0.12, 0.18),
            corridorStructureMat
        );
        endSideTopRail.position.set(corridorCenterX, 1.02, endZ);
        scene.add(endSideTopRail);

        const endSideGreenTube = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.06, 2.2, 16),
            greenTubeMat
        );
        endSideGreenTube.rotation.z = Math.PI / 2;
        endSideGreenTube.position.set(corridorCenterX, 1.32, endZ);
        endSideGreenTube.castShadow = true;
        scene.add(endSideGreenTube);

        const endSideGreenUpright = new THREE.Mesh(
            new THREE.CylinderGeometry(0.07, 0.07, 0.42, 16),
            greenTubeMat
        );
        endSideGreenUpright.position.set(corridorCenterX, 1.14, endZ);
        endSideGreenUpright.castShadow = true;
        scene.add(endSideGreenUpright);
    });

    const glassMat = new THREE.MeshStandardMaterial({ color: 0xa8d9b8, transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.8 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4e8771 });
    const doorMeshMat = new THREE.MeshStandardMaterial({ color: 0x9dc359 });

    const pedimentMat = new THREE.MeshStandardMaterial({ color: 0xeedcb0, roughness: 0.8, side: THREE.DoubleSide });

    const extrudeSettings = { depth: 0.2, bevelEnabled: false };
    const pedimentGeo = new THREE.ExtrudeGeometry(pedimentShape, extrudeSettings);

    const frontPediment = new THREE.Mesh(pedimentGeo, pedimentMat);
    // Extrude goes +Z. Front wall occupies [CLASS_LENGTH/2 - 0.1, CLASS_LENGTH/2 + 0.1]. Place at -0.1 to match.
    frontPediment.position.set(roofCenterOffsetX, CLASS_HEIGHT, CLASS_LENGTH / 2 - 0.1);
    scene.add(frontPediment); // Add to scene, not roofGroup, so it stays when roof is hidden
    obstacles.push(frontPediment);
    frontPediment.visible = false;

    const backPediment = new THREE.Mesh(pedimentGeo, pedimentMat);
    // Back wall occupies [-CLASS_LENGTH/2 - 0.1, -CLASS_LENGTH/2 + 0.1]. Place at -0.1 to match.
    backPediment.position.set(roofCenterOffsetX, CLASS_HEIGHT, -CLASS_LENGTH / 2 - 0.1);
    scene.add(backPediment);
    obstacles.push(backPediment);
    backPediment.visible = false;

    // Roof removed from the scene as requested; keep the editable code definitions intact.
    roofGroup.visible = false;
    scene.remove(roofGroup);
    corridorCanopy.visible = false;

    // New roof based on the current room + additional-room footprint.
    const newRoofGroup = new THREE.Group();
    const roofTextureCanvas = document.createElement('canvas');
    roofTextureCanvas.width = 128;
    roofTextureCanvas.height = 128;
    const roofTextureCtx = roofTextureCanvas.getContext('2d');
    roofTextureCtx.fillStyle = '#2f6f2f';
    roofTextureCtx.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 8) {
        roofTextureCtx.fillStyle = '#1f5425';
        roofTextureCtx.fillRect(x, 0, 3, 128);
        roofTextureCtx.fillStyle = '#4b9144';
        roofTextureCtx.fillRect(x + 3, 0, 2, 128);
    }
    const newRoofTexture = new THREE.CanvasTexture(roofTextureCanvas);
    newRoofTexture.wrapS = THREE.RepeatWrapping;
    newRoofTexture.wrapT = THREE.RepeatWrapping;
    newRoofTexture.repeat.set(18, 1);
    const newRoofMat = new THREE.MeshStandardMaterial({ color: 0x9dc359, roughness: 0.82, metalness: 0.05, side: THREE.DoubleSide });
    const gutterMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.38, metalness: 0.75, side: THREE.DoubleSide });
    const newRoofAngle = 18 * Math.PI / 180;
    const newRoofCenterX = 0;
    const newRoofLeftSpan = CLASS_WIDTH / 2 + 0.35;
    const newRoofRightSpan = corridorOuterX + 0.35;
    const newRoofLength = CLASS_LENGTH + (SINGLE_ROOM_LENGTH * 2 / 3) + 0.8;
    const newRoofEaveY = CLASS_HEIGHT - 0.04;
    const newRoofRidgeY = newRoofEaveY + newRoofLeftSpan * Math.tan(newRoofAngle);
    const newRoofLeftWidth = newRoofLeftSpan / Math.cos(newRoofAngle);
    const newRoofRightAngle = Math.atan((newRoofRidgeY - newRoofEaveY) / newRoofRightSpan);
    const newRoofRightWidth = newRoofRightSpan / Math.cos(newRoofRightAngle);

    const createCorrugatedRoofPanel = (width, length) => {
        const geometry = new THREE.PlaneGeometry(width, length, 1, 3240);
        geometry.rotateX(-Math.PI / 2);
        const positions = geometry.attributes.position;
        const ridges = 540;
        const amplitude = 0.008;
        for (let i = 0; i < positions.count; i++) {
            const z = positions.getZ(i);
            const t = z / length + 0.5;
            const edgeFade = Math.sin(Math.PI * t);
            positions.setY(i, Math.sin((z / length) * Math.PI * 2 * ridges) * amplitude * edgeFade);
        }
        geometry.computeVertexNormals();
        return geometry;
    };

    const newLeftRoof = new THREE.Mesh(createCorrugatedRoofPanel(newRoofLeftWidth, newRoofLength), newRoofMat);
    newLeftRoof.rotation.z = newRoofAngle;
    newLeftRoof.position.set(newRoofCenterX - newRoofLeftSpan / 2, newRoofEaveY + (newRoofLeftSpan * Math.tan(newRoofAngle)) / 2, 0);
    newRoofGroup.add(newLeftRoof);

    const newRightRoof = new THREE.Mesh(createCorrugatedRoofPanel(newRoofRightWidth, newRoofLength), newRoofMat);
    newRightRoof.rotation.z = -newRoofRightAngle;
    newRightRoof.position.set(newRoofCenterX + newRoofRightSpan / 2, newRoofEaveY + (newRoofRightSpan * Math.tan(newRoofRightAngle)) / 2, 0);
    newRoofGroup.add(newRightRoof);

    // Silver ridge sheet with small bevels so the top edge is softer.
    const ridgeShape = new THREE.Shape();
    ridgeShape.moveTo(-0.18, 0.00);
    ridgeShape.lineTo(-0.14, 0.07);
    ridgeShape.lineTo(0.14, 0.07);
    ridgeShape.lineTo(0.18, 0.00);
    ridgeShape.lineTo(-0.18, 0.00);
    const ridgeLength = newRoofLength + 0.12;
    const ridgeGeometry = new THREE.ExtrudeGeometry(ridgeShape, {
        depth: ridgeLength,
        bevelEnabled: true,
        bevelSegments: 2,
        bevelSize: 0.018,
        bevelThickness: 0.018,
        curveSegments: 2
    });
    ridgeGeometry.translate(0, 0, -ridgeLength / 2);
    const ridgeSheet = new THREE.Mesh(ridgeGeometry, gutterMat);
    ridgeSheet.position.set(newRoofCenterX, newRoofRidgeY + 0.01, 0);
    newRoofGroup.add(ridgeSheet);

    const createLongGutter = (x) => {
        const gutter = new THREE.Group();
        // Let the gutter extend slightly past each roof end for a small eave overhang.
        const gutterLength = newRoofLength + 0.12;
        const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, gutterLength), gutterMat);
        bottom.position.set(x, newRoofEaveY - 0.16, 0);
        gutter.add(bottom);
        [-1, 1].forEach((side) => {
            const lip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.26, gutterLength), gutterMat);
            lip.position.set(x + side * 0.13, newRoofEaveY - 0.04, 0);
            gutter.add(lip);
        });
        [-1, 1].forEach((end) => {
            const cap = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.16, 0.04), gutterMat);
            cap.position.set(x, newRoofEaveY - 0.04, end * (gutterLength / 2));
            gutter.add(cap);
        });
        return gutter;
    };
    newRoofGroup.add(createLongGutter(newRoofCenterX - newRoofLeftSpan));
    newRoofGroup.add(createLongGutter(newRoofCenterX + newRoofRightSpan));

    [-1, 1].forEach((endZ) => {
        const leftEndBarrier = new THREE.Mesh(new THREE.BoxGeometry(newRoofLeftWidth + 0.16, 0.14, 0.12), gutterMat);
        leftEndBarrier.rotation.z = newRoofAngle;
        leftEndBarrier.position.set(newRoofCenterX - newRoofLeftSpan / 2, newRoofEaveY + (newRoofLeftSpan * Math.tan(newRoofAngle)) / 2 + 0.06, endZ * newRoofLength / 2);
        newRoofGroup.add(leftEndBarrier);

        const rightEndBarrier = new THREE.Mesh(new THREE.BoxGeometry(newRoofRightWidth + 0.16, 0.14, 0.12), gutterMat);
        rightEndBarrier.rotation.z = -newRoofRightAngle;
        rightEndBarrier.position.set(newRoofCenterX + newRoofRightSpan / 2, newRoofEaveY + (newRoofRightSpan * Math.tan(newRoofRightAngle)) / 2 + 0.06, endZ * newRoofLength / 2);
        newRoofGroup.add(rightEndBarrier);
    });

    newLeftRoof.geometry.dispose();
    newLeftRoof.geometry = new THREE.BoxGeometry(newRoofLeftWidth, 0.16, newRoofLength);
    newRightRoof.geometry.dispose();
    newRightRoof.geometry = new THREE.BoxGeometry(newRoofRightWidth, 0.16, newRoofLength);
    newLeftRoof.visible = true;
    newRightRoof.visible = true;
    const flatRoof = new THREE.Mesh(
        new THREE.BoxGeometry(CLASS_WIDTH / 2 + corridorOuterX + 0.7, 0.16, newRoofLength),
        newRoofMat
    );
    flatRoof.position.set(newRoofCenterX, CLASS_HEIGHT + 0.08, 0);
    flatRoof.castShadow = true;
    flatRoof.receiveShadow = true;
    flatRoof.visible = false;
    newRoofGroup.add(flatRoof);

    scene.add(newRoofGroup);

    // Interior ceiling covering the classrooms and the full corridor.
    const interiorCeilingMat = new THREE.MeshBasicMaterial({
        color: 0x554f3f,
        side: THREE.DoubleSide
    });
    const interiorCeilingWidth = corridorOuterX + CLASS_WIDTH / 2;
    const interiorCeiling = new THREE.Mesh(
        new THREE.BoxGeometry(interiorCeilingWidth, 0.08, newRoofLength - 0.12),
        interiorCeilingMat
    );
    interiorCeiling.position.set(
        (corridorOuterX - CLASS_WIDTH / 2) / 2,
        CLASS_HEIGHT - 0.12,
        0
    );
    interiorCeiling.castShadow = false;
    interiorCeiling.receiveShadow = true;
    scene.add(interiorCeiling);

    // Walls (wallMat is now defined above)

    // Classroom Structural Pillars
    const columnMat = new THREE.MeshStandardMaterial({ color: 0xf5df9d, roughness: 0.8 }); // S/G QDE DepEd YELLOW RAIN
    corridorPosts.forEach((post) => {
        post.material = columnMat;
    });
    corridorUpperHorizontalPost.material = columnMat;
    addedRoomPosts.forEach((post) => {
        post.material = columnMat;
    });
    addedRoomBeams.forEach((beam) => {
        beam.material = columnMat;
    });

    // Back Wall (Teacher side)
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(CLASS_WIDTH + 0.4, CLASS_HEIGHT, 0.2), wallMat);
    backWall.position.set(0, CLASS_HEIGHT / 2, -CLASS_LENGTH / 2);
    scene.add(backWall);
    obstacles.push(backWall);

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

    // Horizontal ties from the classroom wall to the package/corridor posts.
    const corridorTieBeamGeo = new THREE.BoxGeometry(corridorOuterX - CLASS_WIDTH / 2 - 0.2, hBeamHeight, 0.4);
    corridorPostPositions.forEach((z) => {
        const tieBeam = new THREE.Mesh(corridorTieBeamGeo, columnMat);
        tieBeam.position.set((CLASS_WIDTH / 2 + corridorOuterX - 0.2) / 2, hBeamY, z);
        scene.add(tieBeam);
        obstacles.push(tieBeam);
    });


    // Four Corners
    function buildRoom(zCenter, i) {
        const zDir = (i % 2 === 0) ? 1 : -1;
        // Structural corner posts: aligned with the actual room corners.
        const roomHalfLength = SINGLE_ROOM_LENGTH / 2;
        createClassPillar(-CLASS_WIDTH / 2, zCenter - roomHalfLength);
        createClassPillar(-CLASS_WIDTH / 2, zCenter + roomHalfLength);
        createClassPillar(CLASS_WIDTH / 2, zCenter - roomHalfLength);
        createClassPillar(CLASS_WIDTH / 2, zCenter + roomHalfLength);

        // Left Wall (No CR, Solid with windows)
        const leftWallBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 1.5), wallMat);
        leftWallBack.position.set(-CLASS_WIDTH / 2, CLASS_HEIGHT / 2, zCenter - zDir * 8.25);
        scene.add(leftWallBack);
        obstacles.push(leftWallBack);

        const leftWallFront = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 1.5), wallMat);
        leftWallFront.position.set(-CLASS_WIDTH / 2, CLASS_HEIGHT / 2, zCenter + zDir * 8.25);
        scene.add(leftWallFront);
        obstacles.push(leftWallFront);

        const leftMidBottom = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 15.0), wallMat);
        leftMidBottom.position.set(-CLASS_WIDTH / 2, 0.5, zCenter);
        scene.add(leftMidBottom);
        obstacles.push(leftMidBottom);

        const leftMidTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 15.0), wallMat);
        leftMidTop.position.set(-CLASS_WIDTH / 2, 3.0, zCenter);
        scene.add(leftMidTop);
        obstacles.push(leftMidTop);

        const leftMidCenter = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 2.8), wallMat);
        leftMidCenter.position.set(-CLASS_WIDTH / 2, 1.75, zCenter);
        scene.add(leftMidCenter);
        obstacles.push(leftMidCenter);
        
        // Exactly three evenly spaced windows on the wall opposite the doors.
        const windowPositions = [-WINDOW_OFFSET, WINDOW_OFFSET];
        windowPositions.forEach((offset, index) => {
            const window = createJalousieWindow(zCenter + zDir * offset, WINDOW_WIDTH, -CLASS_WIDTH / 2);
            window.name = `classroomWindow${index + 1}`;
            scene.add(window);
            obstacles.push(window);
        });

        // Fully close the wall sections that do not contain windows.
        [-6.9, 6.9].forEach((offset) => {
            const wallFill = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 4.2), wallMat);
            wallFill.position.set(-CLASS_WIDTH / 2, 1.75, zCenter + zDir * offset);
            scene.add(wallFill);
            obstacles.push(wallFill);
        });
        
        // Left Wall
        const leftWallBottom = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, SINGLE_ROOM_LENGTH), wallMat);
        leftWallBottom.position.set(-CLASS_WIDTH / 2, 0.5, zCenter);
        scene.add(leftWallBottom);
        obstacles.push(leftWallBottom);

        const leftWallTopBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 16.15), wallMat);
        leftWallTopBack.position.set(-CLASS_WIDTH / 2, 3.0, zCenter - zDir * 0.925);
        scene.add(leftWallTopBack);
        obstacles.push(leftWallTopBack);

        const leftWallTopFront = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.65), wallMat);
        leftWallTopFront.position.set(-CLASS_WIDTH / 2, 3.0, zCenter + zDir * 8.675);
        scene.add(leftWallTopFront);
        obstacles.push(leftWallTopFront);

        const leftWallBoardSide = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1.5), wallMat);
        leftWallBoardSide.position.set(-CLASS_WIDTH / 2, 1.75, zCenter - zDir * 8.25);
        scene.add(leftWallBoardSide);
        obstacles.push(leftWallBoardSide);

        // Solid wall strips only fill the gaps between the three windows.
        // Right Wall
        const doorWidth = 1.6;
        const doorHeight = 2.5;
        const topWallHeight = CLASS_HEIGHT - doorHeight;
        const door1Z = zCenter + zDir * 6.7;
        const door2Z = zCenter - zDir * 6.7;

        const rightWallBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 1.5), wallMat);
        rightWallBack.position.set(CLASS_WIDTH / 2, CLASS_HEIGHT / 2, zCenter - zDir * 8.25);
        scene.add(rightWallBack);
        obstacles.push(rightWallBack);

        const rightMidBottom = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 11.8), wallMat);
        rightMidBottom.position.set(CLASS_WIDTH / 2, 0.5, zCenter);
        scene.add(rightMidBottom);
        obstacles.push(rightMidBottom);

        const rightMidTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 11.8), wallMat);
        rightMidTop.position.set(CLASS_WIDTH / 2, 3.0, zCenter);
        scene.add(rightMidTop);
        obstacles.push(rightMidTop);

        const rightMidFront = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1.95), wallMat);
        rightMidFront.position.set(CLASS_WIDTH / 2, 1.75, zCenter + zDir * 4.925);
        scene.add(rightMidFront);
        obstacles.push(rightMidFront);

        const rightMidCenter = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 2.8), wallMat);
        rightMidCenter.position.set(CLASS_WIDTH / 2, 1.75, zCenter);
        scene.add(rightMidCenter);
        obstacles.push(rightMidCenter);

        const rightMidBack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1.95), wallMat);
        rightMidBack.position.set(CLASS_WIDTH / 2, 1.75, zCenter - zDir * 4.925);
        scene.add(rightMidBack);
        obstacles.push(rightMidBack);

        // Matching three windows on the opposite wall, placed between the doors.
        [-WINDOW_OFFSET, WINDOW_OFFSET].forEach((offset, index) => {
            const window = createJalousieWindow(zCenter + zDir * offset, WINDOW_WIDTH, CLASS_WIDTH / 2 + 0.01);
            window.name = `oppositeClassroomWindow${index + 1}`;
            scene.add(window);
            obstacles.push(window);
        });

        // Close the narrow gaps between the outer windows and the doors.
        [-5.35, 5.35].forEach((offset) => {
            const doorSideWallFill = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 1.1), wallMat);
            doorSideWallFill.position.set(CLASS_WIDTH / 2, 1.75, zCenter + zDir * offset);
            scene.add(doorSideWallFill);
            obstacles.push(doorSideWallFill);
        });

        const rightWallFront = new THREE.Mesh(new THREE.BoxGeometry(0.2, CLASS_HEIGHT, 1.5), wallMat);
        rightWallFront.position.set(CLASS_WIDTH / 2, CLASS_HEIGHT / 2, zCenter + zDir * 8.25);
        scene.add(rightWallFront);
        obstacles.push(rightWallFront);

        const rightWallTop1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, topWallHeight, doorWidth), wallMat);
        rightWallTop1.position.set(CLASS_WIDTH / 2, CLASS_HEIGHT - topWallHeight / 2, door1Z);
        scene.add(rightWallTop1);
        obstacles.push(rightWallTop1);

        const rightWallTop2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, topWallHeight, doorWidth), wallMat);
        rightWallTop2.position.set(CLASS_WIDTH / 2, CLASS_HEIGHT - topWallHeight / 2, door2Z);
        scene.add(rightWallTop2);
        obstacles.push(rightWallTop2);

        const doorGeo = new THREE.BoxGeometry(0.1, doorHeight, doorWidth);
        const doorGroup1 = new THREE.Group();
        doorGroup1.position.set(CLASS_WIDTH / 2, 0, door1Z + doorWidth / 2);
        doorGroup1.userData = { isOpen: false, openType: 'rotate', openRot: Math.PI / 2, closeRot: 0 };
        const dMesh1 = createPanelDoor(doorWidth, doorHeight, 0.05, doorMeshMat, 'left');
        dMesh1.position.set(0, doorHeight / 2, -doorWidth / 2);
        doorGroup1.add(dMesh1);
        scene.add(doorGroup1);
        doorMeshes.push(doorGroup1);
        obstacles.push(dMesh1);

        const doorGroup2 = new THREE.Group();
        doorGroup2.position.set(CLASS_WIDTH / 2, 0, door2Z - doorWidth / 2);
        doorGroup2.userData = { isOpen: false, openType: 'rotate', openRot: -Math.PI / 2, closeRot: 0 };
        const dMesh2 = createPanelDoor(doorWidth, doorHeight, 0.05, doorMeshMat, 'right');
        dMesh2.position.set(0, doorHeight / 2, doorWidth / 2);
        doorGroup2.add(dMesh2);
        scene.add(doorGroup2);
        doorMeshes.push(doorGroup2);
        obstacles.push(dMesh2);
        
        // Partition Wall at the front (except for the last room)
        const partitionWall = new THREE.Mesh(new THREE.BoxGeometry(CLASS_WIDTH + 0.4, CLASS_HEIGHT, 0.2), wallMat);
        partitionWall.position.set(0, CLASS_HEIGHT / 2, zCenter + SINGLE_ROOM_LENGTH / 2);
        partitionWall.userData.isWalkObstacle = true;
        scene.add(partitionWall);
        obstacles.push(partitionWall);

        const partitionTopBeam = new THREE.Mesh(
            new THREE.BoxGeometry(CLASS_WIDTH + 0.4, 0.4, 0.4),
            columnMat
        );
        partitionTopBeam.position.set(0, CLASS_HEIGHT - 0.2, zCenter + SINGLE_ROOM_LENGTH / 2);
        scene.add(partitionTopBeam);
        obstacles.push(partitionTopBeam);

        const dividerGableShape = new THREE.Shape();
        dividerGableShape.moveTo(-CLASS_WIDTH / 2, 0);
        dividerGableShape.lineTo(0, ridgeHeightFromWall - 0.18);
        dividerGableShape.lineTo(corridorOuterX + 0.2, 0);
        dividerGableShape.lineTo(-CLASS_WIDTH / 2, 0);
        const dividerGable = new THREE.Mesh(
            new THREE.ExtrudeGeometry(dividerGableShape, { depth: 0.2, bevelEnabled: false }),
            wallMat
        );
        dividerGable.position.set(0, CLASS_HEIGHT, zCenter + SINGLE_ROOM_LENGTH / 2);
        scene.add(dividerGable);
    }

    for (let i = 0; i < 6; i++) {
        let zCenter = -CLASS_LENGTH / 2 + (SINGLE_ROOM_LENGTH / 2) + (i * SINGLE_ROOM_LENGTH);
        buildRoom(zCenter, i);
    }

}

function setupInitialClassroom() {
    for (let i = 0; i < 6; i++) {
        let zCenter = -CLASS_LENGTH / 2 + (SINGLE_ROOM_LENGTH / 2) + (i * SINGLE_ROOM_LENGTH);
        const zDir = (i % 2 === 0) ? 1 : -1;
        const rotY = (i % 2 === 0) ? 0 : Math.PI; // Wait, originally +Z was BACK of room?
        // Let's think: board is originally at zCenter - 8.85
        // If zDir = 1, it's at -8.85. If zDir = -1, it's at +8.85.
        // So board1 Z: zCenter - zDir * (SINGLE_ROOM_LENGTH / 2 - 0.15)
        // Originally: board1 at zCenter - 8.85 (which is SINGLE_ROOM_LENGTH/2 - 0.15).
        
        const board1 = Factory.createBoard();
        board1.position.set(-2.2, 0, zCenter - zDir * (SINGLE_ROOM_LENGTH / 2 - 0.15));
        board1.rotation.y = rotY;
        addObj(board1);

        const board2 = Factory.createBoard();
        board2.position.set(2.2, 0, zCenter - zDir * (SINGLE_ROOM_LENGTH / 2 - 0.15));
        board2.rotation.y = rotY;
        addObj(board2);

        const tDesk = Factory.createTeacherTable();
        tDesk.position.set(0, 0, zCenter - zDir * (SINGLE_ROOM_LENGTH / 2 - 1.5));
        tDesk.rotation.y = rotY;
        addObj(tDesk);

        const tChair = Factory.createTeacherChair();
        tChair.position.set(0, 0, zCenter - zDir * (SINGLE_ROOM_LENGTH / 2 - 0.8));
        tChair.rotation.y = rotY;
        addObj(tChair);

        // Eight columns total: one column removed from each side of the previous layout.
        generateSeatingForRoom(9, 8, zCenter, zDir, rotY);
    }
}
function generateSeatingForRoom(rows, cols, zCenter, zDir, rotY) {
    const spacingX = 1.2;
    const spacingZ = zDir * 1.4;
    const totalWidth = (cols - 1) * spacingX + 0.8;
    const startX = -totalWidth / 2;
    const startZ = zCenter - zDir * (SINGLE_ROOM_LENGTH / 2 - 3.5);

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const chair = Factory.createStudentChair();
            let xPos = startX + c * spacingX;
            if (c >= cols / 2) {
                xPos += 0.8; 
            }
            chair.position.set(xPos, 0, startZ + r * spacingZ);
            chair.rotation.y = rotY;
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
    const corridorEnd = CLASS_LENGTH / 2 + 2;
    if (position.z < -corridorEnd) position.z = -corridorEnd;
    if (position.z > corridorEnd) position.z = corridorEnd;
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
    if (position.x <= CLASS_WIDTH / 2 + radius && position.z > fenceZ - radius && position.z < fenceZ + radius) {
        if (position.z < fenceZ) position.z = fenceZ - radius; else position.z = fenceZ + radius;
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
            const openDoorHere = doorMeshes.some((door) =>
                door.userData.isOpen && Math.abs(position.z - door.position.z) < 1.6 / 2 + radius
            );

            if (openDoorHere) {
                // Pass
            } else {
                if (position.x < classX) position.x = classX - radius; else position.x = classX + radius;
            }
        }
    }

    // Obstacle Check (Furniture / interior geometry).
    // The exterior corridor is intentionally kept free of interior hitboxes.
    if (position.x <= CLASS_WIDTH / 2 + radius) {
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
