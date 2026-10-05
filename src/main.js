import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

import * as Factory from './components/factory.js';

// Global State
let scene, camera, renderer;
let editCamera;
let orbitControls, transformControls;
let currentMode = 'EDIT'; // 'EDIT' or 'VIEW'

// Walk/View mode keyboard state
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let prevTime = performance.now();

// Classroom objects
const objects = []; // Editable objects
// Walk Mode and collision processing are disabled for performance. Keep the
// registry API as a no-op so the existing model-generation code stays simple.
const disabledWalkRegistry = {
    push() {},
    forEach() {},
    includes() { return false; },
    indexOf() { return -1; },
    splice() {}
};
const obstacles = disabledWalkRegistry;
let raycaster, mouse;
let selectedObject = null;

// Classroom Dimensions
const CLASS_WIDTH = 12;
const SINGLE_ROOM_LENGTH = 18;
const CLASS_LENGTH = SINGLE_ROOM_LENGTH * 6;
const CLASS_HEIGHT = 3.5;
const WINDOW_WIDTH = 3.4;
const WINDOW_OFFSET = 3.1;

const doorMeshes = disabledWalkRegistry;

// Shared security-device materials and small model helpers. These devices
// are visual room details and are intentionally not added to obstacles.
const securityLockMat = new THREE.MeshStandardMaterial({
    color: 0x20252d,
    roughness: 0.28,
    metalness: 0.65
});
const securityKeypadMat = new THREE.MeshStandardMaterial({
    color: 0x36515b,
    emissive: 0x102a33,
    emissiveIntensity: 0.65,
    roughness: 0.35,
    metalness: 0.35
});
const securityCameraMat = new THREE.MeshStandardMaterial({
    color: 0x252b31,
    roughness: 0.3,
    metalness: 0.55
});
const securityLensMat = new THREE.MeshStandardMaterial({
    color: 0x5db7d4,
    emissive: 0x174c62,
    emissiveIntensity: 0.8,
    roughness: 0.2,
    metalness: 0.45
});
const extinguisherMat = new THREE.MeshStandardMaterial({
    color: 0xc7372f,
    roughness: 0.42,
    metalness: 0.2
});
const extinguisherDarkMat = new THREE.MeshStandardMaterial({
    color: 0x252525,
    roughness: 0.5,
    metalness: 0.35
});
const firstAidBodyMat = new THREE.MeshStandardMaterial({
    color: 0xf2f0e7,
    roughness: 0.72,
    metalness: 0.05
});
const firstAidCrossMat = new THREE.MeshStandardMaterial({
    color: 0x35a85a,
    roughness: 0.5,
    metalness: 0.05
});
const smokeDetectorMat = new THREE.MeshStandardMaterial({
    color: 0xe8e9e5,
    roughness: 0.8,
    metalness: 0.0
});

function createDigitalLock(width, height, thickness, handleSide = 'left', axis = 'z') {
    const lockGroup = new THREE.Group();
    const lockY = -height / 2 + height * 0.48;
    const coordinate = handleSide === 'left'
        ? -width / 2 + 0.18
        : width / 2 - 0.18;
    const body = axis === 'z'
        ? new THREE.Mesh(new THREE.BoxGeometry(thickness + 0.10, 0.22, 0.16), securityLockMat)
        : new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, thickness + 0.10), securityLockMat);
    body.position.set(axis === 'z' ? 0 : coordinate, lockY, axis === 'z' ? coordinate : 0);
    body.castShadow = true;
    body.receiveShadow = true;
    lockGroup.add(body);

    const keypad = axis === 'z'
        ? new THREE.Mesh(new THREE.BoxGeometry(thickness + 0.115, 0.10, 0.10), securityKeypadMat)
        : new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.10, thickness + 0.115), securityKeypadMat);
    keypad.position.set(axis === 'z' ? 0 : coordinate, lockY + 0.02, axis === 'z' ? coordinate : 0);
    keypad.castShadow = true;
    lockGroup.add(keypad);
    lockGroup.name = 'DigitalLock';
    lockGroup.userData.isSecurityDevice = true;
    return lockGroup;
}

function addRoomCctv(position, target, name) {
    const cameraGroup = new THREE.Group();
    cameraGroup.position.copy(position);
    cameraGroup.lookAt(target);

    const mount = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.10, 12),
        securityCameraMat
    );
    mount.position.y = 0.045;
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.18, 0.26),
        securityCameraMat
    );
    body.position.y = -0.06;
    const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.065, 0.08, 12),
        securityLensMat
    );
    lens.rotation.x = -Math.PI / 2;
    lens.position.set(0, -0.06, -0.17);
    [mount, body, lens].forEach((part) => {
        part.castShadow = true;
        part.receiveShadow = true;
        cameraGroup.add(part);
    });
    cameraGroup.name = name;
    cameraGroup.userData.isSecurityDevice = true;
    scene.add(cameraGroup);
}

function addRoomFireExtinguisher(position, name) {
    const extinguisher = new THREE.Group();
    extinguisher.position.copy(position);

    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.13, 0.55, 14),
        extinguisherMat
    );
    body.position.y = 0.30;
    const neck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.065, 0.12, 12),
        extinguisherDarkMat
    );
    neck.position.y = 0.64;
    const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.075, 0.018, 8, 12, Math.PI),
        extinguisherDarkMat
    );
    handle.rotation.x = Math.PI / 2;
    handle.position.set(0, 0.72, 0);
    const hose = new THREE.Mesh(
        new THREE.TorusGeometry(0.09, 0.014, 8, 12, Math.PI * 0.75),
        extinguisherDarkMat
    );
    hose.rotation.z = Math.PI / 2;
    hose.position.set(0.075, 0.53, 0.02);
    [body, neck, handle, hose].forEach((part) => {
        part.castShadow = true;
        part.receiveShadow = true;
        extinguisher.add(part);
    });
    extinguisher.name = name;
    extinguisher.userData.isSecurityDevice = true;
    scene.add(extinguisher);
}

function addRoomSmokeDetector(position, name) {
    const detector = new THREE.Group();
    detector.position.copy(position);
    const base = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.06, 16),
        smokeDetectorMat
    );
    const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 10, 8),
        securityLensMat
    );
    led.position.set(0.09, 0.04, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    led.castShadow = true;
    detector.add(base, led);
    detector.name = name;
    detector.userData.isSecurityDevice = true;
    scene.add(detector);
}

function addRoomFirstAidKit(position, name) {
    const kit = new THREE.Group();
    kit.position.copy(position);
    const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.48, 0.38),
        firstAidBodyMat
    );
    const verticalCross = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.28, 0.07),
        firstAidCrossMat
    );
    const horizontalCross = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.07, 0.22),
        firstAidCrossMat
    );
    verticalCross.position.x = 0.075;
    horizontalCross.position.x = 0.075;
    [box, verticalCross, horizontalCross].forEach((part) => {
        part.castShadow = true;
        part.receiveShadow = true;
        kit.add(part);
    });
    kit.name = name;
    kit.userData.isSecurityDevice = true;
    scene.add(kit);
}

function addClassroomSecurityPackage(zCenter, roomIndex) {
    const cornerX = CLASS_WIDTH / 2 - 0.45;
    const cornerZ = SINGLE_ROOM_LENGTH / 2 - 0.45;
    const cameraTarget = new THREE.Vector3(0, 1.45, zCenter);
    [-1, 1].forEach((xSide) => {
        [-1, 1].forEach((zSide) => {
            addRoomCctv(
                new THREE.Vector3(xSide * cornerX, CLASS_HEIGHT - 0.30, zCenter + zSide * cornerZ),
                cameraTarget,
                `classroom${roomIndex + 1}CCTV${xSide > 0 ? 'Right' : 'Left'}${zSide > 0 ? 'Front' : 'Back'}`
            );
        });
    });

    const zDir = (roomIndex % 2 === 0) ? 1 : -1;
    addRoomFireExtinguisher(
        new THREE.Vector3(CLASS_WIDTH / 2 - 0.42, 0.0, zCenter + zDir * 5.55),
        `classroom${roomIndex + 1}FireExtinguisher`
    );
    addRoomSmokeDetector(
        new THREE.Vector3(0, CLASS_HEIGHT - 0.08, zCenter),
        `classroom${roomIndex + 1}SmokeDetector`
    );
    addRoomFirstAidKit(
        new THREE.Vector3(-CLASS_WIDTH / 2 + 0.22, 1.35, zCenter - zDir * 7.65),
        `classroom${roomIndex + 1}FirstAidKit`
    );
}

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

    camera = editCamera;

    // Renderer
    renderer = new THREE.WebGLRenderer({
        antialias: false,
        powerPreference: 'high-performance'
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    // The scene does not use a shadow-casting light, so keeping the shadow
    // map enabled only adds renderer overhead.
    renderer.shadowMap.enabled = false;
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
    createThirdFloor();
    createSecondFloor();
    createFirstFloor();
    liftBuildingStackToGround();
    createEndRoomStairToSecond();
    createUnderStairRooms();
    createEndRoomBathrooms(0, 'firstFloor');
    createEndRoomBathrooms(CLASS_HEIGHT, 'secondFloor');
    createEndRoomBathrooms(CLASS_HEIGHT * 2, 'thirdFloor');
    createEndRoomBathrooms(CLASS_HEIGHT * 3, 'fourthFloor');
    createUShapedBuildingLayout();
    applyComponentVisibilityToggles();
    applyBuildingVisibilityToggles();
}

function createEndRoomStairToSecond() {
    const stairMat = new THREE.MeshStandardMaterial({
        // Match the finished structural post color.
        color: 0xf5df9d,
        roughness: 0.95,
        metalness: 0.0
    });
    const corridorOuterX = CLASS_WIDTH / 2 + 2.2;
    // Keep the complete stair footprint inside the add-room post line.
    const stairRun = 9.5;
    const stairWidth = 2.10;
    const stepCount = 20;
    const stepDepth = stairRun / stepCount;
    const stepHeight = CLASS_HEIGHT / stepCount;
    const stairSlabThickness = 0.12;
    // Shift the complete stair assembly into the end-room footprint while
    // keeping its top edge aligned with the corridor-side boundary.
    const stairTopX = corridorOuterX - 11.7;
    const stairBottomX = stairTopX + stairRun;
    // Trim the gray upper-flight end so it clears the recessed door.
    const upperEndX = CLASS_WIDTH / 2 - 0.30;
    const upperStairFillEndX = CLASS_WIDTH / 2 - 0.085;
    const stairBackOffset = 0.825;
    const endRoomCenterZ = CLASS_LENGTH / 2 + SINGLE_ROOM_LENGTH / 6 + stairBackOffset;
    // Keep the two flights as separate parallel meshes, but flush their edges
    // together so the switchback has no visible gap at the middle.
    const flightGap = 0.0;
    const flightOffsetZ = stairWidth / 2 + flightGap;
    const landingX = stairTopX + stairRun / 2;
    const railingMat = new THREE.MeshStandardMaterial({
        color: 0x9dc359,
        roughness: 0.65,
        metalness: 0.15
    });
    const handrailHeight = 0.90;
    const handrailThickness = 0.10;
    const railingPostThickness = 0.08;
    // Use one real-world spacing target so short and long railing sections
    // have the same support density instead of only matching percentages.
    const railingPostSpacing = 0.60;
    const getRailingPostRatios = (length) => {
        const segmentCount = Math.max(1, Math.ceil(length / railingPostSpacing));
        return Array.from({ length: segmentCount + 1 }, (_, index) => index / segmentCount);
    };
    const createRailingTube = (length, radius) => {
        const tubeGroup = new THREE.Group();
        const tubeBody = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, length, 12, 1, true),
            railingMat
        );
        const topCap = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
            railingMat
        );
        const bottomCap = new THREE.Mesh(
            new THREE.SphereGeometry(radius, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
            railingMat
        );
        topCap.position.y = length / 2;
        bottomCap.position.y = -length / 2;
        [tubeBody, topCap, bottomCap].forEach((part) => {
            part.castShadow = true;
            part.receiveShadow = true;
            tubeGroup.add(part);
        });
        return tubeGroup;
    };
    const addStairRegion = () => null;
    const addFlight = (startX, endX, baseY, z, prefix) => {
        // Use one thin sloped slab underneath the flight instead of stacking
        // full-height blocks. The underside now follows the stair incline.
        const flightRise = stepHeight * (stepCount / 2);
        const flightRun = endX - startX;
        const slabLength = Math.hypot(flightRun, flightRise);
        const slabAngle = Math.atan2(flightRise, flightRun);
        const stairSlab = new THREE.Mesh(
            new THREE.BoxGeometry(slabLength, stairSlabThickness, stairWidth),
            stairMat
        );
        stairSlab.position.set(
            (startX + endX) / 2,
            baseY + flightRise / 2 - stairSlabThickness * 1.5,
            z
        );
        stairSlab.rotation.z = slabAngle;
        stairSlab.name = `${prefix}SlopedUnderSlab`;
        stairSlab.castShadow = true;
        stairSlab.receiveShadow = true;
        scene.add(stairSlab);

        const flightStepCount = stepCount / 2;
        const flightStepDepth = Math.abs(flightRun) / flightStepCount;
        const flightDirection = Math.sign(flightRun) || 1;
        addStairRegion(`${prefix}FloorRegion`, {
            type: 'flight',
            startX,
            endX,
            z,
            baseY,
            rise: flightRise,
            halfWidth: stairWidth / 2
        });

        // Close the open spaces between the treads while keeping the
        // underside sloped. This makes the stair read as a solid stair
        // profile instead of a row of floating thin plates.
        const stairBodyShape = new THREE.Shape();
        stairBodyShape.moveTo(startX, baseY + stepHeight - stairSlabThickness);
        for (let i = 0; i < flightStepCount; i++) {
            const stepEndX = startX + flightDirection * flightStepDepth * (i + 1);
            const stepBottomY = baseY + stepHeight * (i + 1) - stairSlabThickness;
            stairBodyShape.lineTo(stepEndX, stepBottomY);
            if (i < flightStepCount - 1) {
                stairBodyShape.lineTo(stepEndX, baseY + stepHeight * (i + 2) - stairSlabThickness);
            }
        }
        stairBodyShape.lineTo(endX, baseY + flightRise - stairSlabThickness);
        stairBodyShape.lineTo(startX, baseY - stairSlabThickness);
        stairBodyShape.closePath();

        const stairBody = new THREE.Mesh(
            new THREE.ExtrudeGeometry(stairBodyShape, {
                depth: stairWidth,
                bevelEnabled: false
            }),
            stairMat
        );
        stairBody.position.z = z - stairWidth / 2;
        stairBody.name = `${prefix}FilledStepBody`;
        stairBody.castShadow = true;
        stairBody.receiveShadow = true;
        scene.add(stairBody);

        for (let i = 0; i < flightStepCount; i++) {
            const stepHeightTotal = stepHeight * (i + 1);
            const step = new THREE.Mesh(
                new THREE.BoxGeometry(stepDepth + 0.02, stairSlabThickness, stairWidth),
                stairMat
            );
            const t = (i + 0.5) / (stepCount / 2);
            step.position.set(
                startX + (endX - startX) * t,
                baseY + stepHeightTotal - stairSlabThickness / 2,
                z
            );
            step.name = `${prefix}${i + 1}`;
            step.castShadow = true;
            step.receiveShadow = true;
            scene.add(step);
        }
    };

    const addFlightRailing = (startX, endX, baseY, z, prefix, railSides) => {
        const flightStepCount = stepCount / 2;
        const flightRise = stepHeight * flightStepCount;
        const flightRun = endX - startX;
        // Start and finish the handrail at the same height above each floor
        // or landing so the switchback rail ends meet cleanly.
        const railRise = flightRise;
        const railLength = Math.hypot(flightRun, railRise);
        const railAngle = Math.atan2(railRise, flightRun);
        const railCenterY = baseY + flightRise / 2 + handrailHeight;

        railSides.forEach((side) => {
            const railZ = z + side * (stairWidth / 2 - handrailThickness / 2);
            const handrail = createRailingTube(railLength, handrailThickness / 2);
            handrail.position.set((startX + endX) / 2, railCenterY, railZ);
            handrail.rotation.z = railAngle - Math.PI / 2;
            handrail.name = `${prefix}GreenHandrail${side > 0 ? 'Outer' : 'Inner'}`;
            handrail.castShadow = true;
            handrail.receiveShadow = true;
            scene.add(handrail);

            getRailingPostRatios(railLength).forEach((t, index) => {
                const stepIndex = Math.max(0, Math.min(flightStepCount, Math.ceil(t * flightStepCount)));
                const treadTopY = baseY + stepHeight * stepIndex;
                const railY = baseY + t * railRise + handrailHeight;
                const postHeight = Math.max(0.12, railY - treadTopY);
                const post = createRailingTube(postHeight, railingPostThickness / 2);
                post.position.set(
                    startX + flightRun * t,
                    treadTopY + postHeight / 2,
                    railZ
                );
                post.name = `${prefix}GreenRailingPost${side > 0 ? 'Outer' : 'Inner'}${index + 1}`;
                post.castShadow = true;
                post.receiveShadow = true;
                scene.add(post);
            });
        });
    };

    const addLandingRailing = (baseY, centerX, centerZ, prefix, railSides) => {
        const landingTopY = baseY + CLASS_HEIGHT / 2;
        // Stop the landing rail at the upper-flight start so the horizontal
        // and sloped rails meet cleanly instead of overlapping.
        const landingRailLength = 1.70;
        const landingRailCenterX = centerX - 0.15;
        const landingPostOffset = landingRailLength / 2 - railingPostThickness / 2;
        railSides.forEach((side) => {
            const railZ = centerZ + side * (stairWidth - handrailThickness / 2);
            const handrail = createRailingTube(landingRailLength, handrailThickness / 2);
            handrail.position.set(landingRailCenterX, landingTopY + handrailHeight, railZ);
            handrail.rotation.z = -Math.PI / 2;
            handrail.name = `${prefix}GreenLandingHandrail${side > 0 ? 'Outer' : 'Inner'}`;
            handrail.castShadow = true;
            handrail.receiveShadow = true;
            scene.add(handrail);

            getRailingPostRatios(landingRailLength).forEach((t, index) => {
                const offset = -landingPostOffset + (landingPostOffset * 2 * t);
                const post = createRailingTube(handrailHeight, railingPostThickness / 2);
                post.position.set(landingRailCenterX + offset, landingTopY + handrailHeight / 2, railZ);
                post.name = `${prefix}GreenLandingPost${side > 0 ? 'Outer' : 'Inner'}${index + 1}`;
                post.castShadow = true;
                post.receiveShadow = true;
                scene.add(post);
            });
        });
    };

    const addCrHallwayRailing = (baseY, endSide, stairCenterZ, prefix, edgeSide = -endSide) => {
        // Guard the open edge beside the stair while keeping the hallway to
        // the CR on the wall side clear. There is no fall at ground level.
        if (baseY === 0) return;

        const hallwayFloorY = baseY + 0.06;
        // Place the rail on the requested edge of the stair opening.
        const hallwayRailShiftZ = edgeSide * 0.05;
        const hallwayCenterZ = stairCenterZ + edgeSide * stairWidth + hallwayRailShiftZ;
        // Align the far end with the upper-stair endpoint so the two rails
        // finish flush instead of leaving an overhanging tip.
        const hallwayRailShiftX = -0.20;
        const hallwayEndPostX = CLASS_WIDTH / 2 - 0.085 + hallwayRailShiftX;
        // Keep the CR-side end just clear of the wall/landing edge so this
        // rail does not overlap the adjacent railing or wall.
        const hallwayStartX = landingX - 1.50 + hallwayRailShiftX;
        // Finish the handrail at the end-post line so its tip does not extend
        // past the post when viewed from the hallway.
        const hallwayRailEndX = hallwayEndPostX;
        const hallwayRailLength = Math.abs(hallwayRailEndX - hallwayStartX);
        const hallwayHandrail = createRailingTube(hallwayRailLength, handrailThickness / 2);
        // Follow the walkway toward the CR instead of running along the
        // stair-side edge.
        hallwayHandrail.rotation.z = -Math.PI / 2;
        hallwayHandrail.position.set(
            (hallwayStartX + hallwayRailEndX) / 2,
            hallwayFloorY + handrailHeight,
            hallwayCenterZ
        );
        hallwayHandrail.name = `${prefix}GreenCrHallwayHandrail`;
        hallwayHandrail.castShadow = true;
        hallwayHandrail.receiveShadow = true;
        scene.add(hallwayHandrail);

        const hallwayPostBottomY = hallwayFloorY;
        const hallwayPostHeight = handrailHeight + (hallwayFloorY - hallwayPostBottomY);
        getRailingPostRatios(hallwayRailLength).forEach((t, index) => {
            const post = createRailingTube(hallwayPostHeight, railingPostThickness / 2);
            post.position.set(
                hallwayStartX + (hallwayEndPostX - hallwayStartX) * t,
                hallwayPostBottomY + hallwayPostHeight / 2,
                hallwayCenterZ
            );
            post.name = `${prefix}GreenCrHallwayPost${index + 1}`;
            post.castShadow = true;
            post.receiveShadow = true;
            scene.add(post);
        });
    };

    const addFourthFloorOpeningEndGuard = (baseY, endSide, stairCenterZ, prefix) => {
        if (baseY !== CLASS_HEIGHT * 3) return;

        const floorY = baseY + 0.06;
        const guardX = CLASS_WIDTH / 2 - 0.085;
        // Keep the stair-width opening clear and retain the guard only on
        // the side opposite the stair approach.
        const guardLength = stairWidth + 0.10;
        const handrail = createRailingTube(guardLength, handrailThickness / 2);
        handrail.rotation.x = Math.PI / 2;
        handrail.position.set(
            guardX,
            floorY + handrailHeight,
            stairCenterZ + endSide * guardLength / 2
        );
        handrail.name = `${prefix}GreenFourthFloorOpeningEndGuard`;
        handrail.castShadow = true;
        handrail.receiveShadow = true;
        scene.add(handrail);

        getRailingPostRatios(guardLength).forEach((t, index) => {
            const post = createRailingTube(handrailHeight, railingPostThickness / 2);
            post.position.set(
                guardX,
                floorY + handrailHeight / 2,
                stairCenterZ + endSide * guardLength * t
            );
            post.name = `${prefix}GreenFourthFloorOpeningEndPost${index + 1}`;
            post.castShadow = true;
            post.receiveShadow = true;
            scene.add(post);
        });
    };

    // Make the landing twice as thick as the individual stair treads.
    const landingThickness = stairSlabThickness * 2;
    const stairLevels = [
        { baseY: 0, levelName: 'FirstToSecond' },
        { baseY: CLASS_HEIGHT, levelName: 'SecondToThird' },
        { baseY: CLASS_HEIGHT * 2, levelName: 'ThirdToFourth' }
    ];

    stairLevels.forEach(({ baseY, levelName }) => {
        // Build the same switchback at both attached-room ends. Mirroring the
        // Z position keeps both staircases aligned with their respective post line.
        [1, -1].forEach((endSide) => {
            const stairCenterZ = endSide * endRoomCenterZ;
            const lowerFlightZ = stairCenterZ + endSide * flightOffsetZ;
            const upperFlightZ = stairCenterZ - endSide * flightOffsetZ;
            const sideName = endSide > 0 ? 'Positive' : 'Negative';

            // First flight rises toward the middle landing.
            addFlight(stairBottomX, landingX, baseY, lowerFlightZ, `endRoom${sideName}${levelName}LowerStairStep`);
            // The opposite side is against the end wall; rail only the open
            // inner edge of this flight.
            addFlightRailing(
                stairBottomX,
                landingX,
                baseY,
                lowerFlightZ,
                `endRoom${sideName}${levelName}LowerStair`,
                baseY > 0 ? [-endSide] : []
            );

            const middleLanding = new THREE.Mesh(
                new THREE.BoxGeometry(2.0, landingThickness, stairWidth * 2 + flightGap * 2),
                stairMat
            );
            middleLanding.position.set(landingX - 0.70, baseY + CLASS_HEIGHT / 2 - landingThickness / 2, stairCenterZ);
            middleLanding.name = `endRoom${sideName}${levelName}StairMiddleLanding`;
            middleLanding.castShadow = true;
            middleLanding.receiveShadow = true;
            scene.add(middleLanding);
            addStairRegion(`${sideName}${levelName}MiddleLandingFloorRegion`, {
                type: 'landing',
                minX: landingX - 0.70 - 1.0,
                maxX: landingX - 0.70 + 1.0,
                centerZ: stairCenterZ,
                halfDepth: stairWidth + flightGap,
                floorY: baseY + CLASS_HEIGHT / 2
            });
            addLandingRailing(
                baseY,
                landingX - 0.70,
                stairCenterZ,
                `endRoom${sideName}${levelName}`,
                [-endSide]
            );
            addCrHallwayRailing(
                baseY,
                endSide,
                stairCenterZ,
                `endRoom${sideName}${levelName}`
            );

            // Keep the lower landing filled as before. The 2nd-to-3rd-floor
            // landing stays as a thin slab with an open underside, so it does
            // not become a large solid block in the upper stairwell.
            if (baseY === 0) {
                const landingSupportHeight = CLASS_HEIGHT / 2 - landingThickness;
                const landingSupport = new THREE.Mesh(
                    new THREE.BoxGeometry(2.0, landingSupportHeight, stairWidth * 2 + flightGap * 2),
                    stairMat
                );
                landingSupport.position.set(
                    landingX - 0.70,
                    baseY + landingSupportHeight / 2,
                    stairCenterZ
                );
                landingSupport.name = `endRoom${sideName}${levelName}StairLandingUnderfill`;
                landingSupport.castShadow = true;
                landingSupport.receiveShadow = true;
                landingSupport.userData.isWalkObstacle = true;
                landingSupport.userData.isStairLandingUnderfill = true;
                obstacles.push(landingSupport);
                scene.add(landingSupport);
            }

            // Second flight reverses direction, forming the U-shaped switchback.
            addFlight(landingX, upperEndX, baseY + CLASS_HEIGHT / 2, upperFlightZ, `endRoom${sideName}${levelName}UpperStairStep`);
            // The upper flight mirrors the open edge of the lower flight.
            addFlightRailing(
                landingX,
                upperEndX,
                baseY + CLASS_HEIGHT / 2,
                upperFlightZ,
                `endRoom${sideName}${levelName}UpperStair`,
                [-endSide]
            );
            // Add the matching guard on the other open side of the upper
            // flight. This is additive only; the existing railing stays put.
            addFlightRailing(
                landingX,
                upperEndX,
                baseY + CLASS_HEIGHT / 2,
                upperFlightZ,
                `endRoom${sideName}${levelName}UpperStairOpenSide`,
                [endSide]
            );
            // Close the short horizontal gap between the last upper step and
            // the wall line with a thin cap, not a full-height end panel.
            const upperStairCapEndX = CLASS_WIDTH / 2 - 0.085;
            const upperStairCapWidth = upperStairCapEndX - upperEndX;
            if (upperStairCapWidth > 0) {
                const upperStairCap = new THREE.Mesh(
                    new THREE.BoxGeometry(upperStairCapWidth, stairSlabThickness, stairWidth),
                    stairMat
                );
                upperStairCap.position.set(
                    upperEndX + upperStairCapWidth / 2,
                    baseY + CLASS_HEIGHT - stairSlabThickness / 2,
                    upperFlightZ
                );
                upperStairCap.name = `endRoom${sideName}${levelName}UpperStairEndCap`;
                upperStairCap.castShadow = true;
                upperStairCap.receiveShadow = true;
                scene.add(upperStairCap);
            }
            addStairRegion(`${sideName}${levelName}UpperLandingFloorRegion`, {
                type: 'landing',
                minX: upperEndX,
                maxX: upperStairFillEndX,
                centerZ: upperFlightZ,
                halfDepth: stairWidth / 2,
                floorY: baseY + CLASS_HEIGHT
            });

            // Guard the open fourth-floor hallway edge beside the top of the
            // stair. The lower levels already receive this guard from their
            // stair-level setup, but the top floor has no next flight to add it.
            if (baseY === CLASS_HEIGHT * 2) {
                addCrHallwayRailing(
                    CLASS_HEIGHT * 3,
                    endSide,
                    stairCenterZ,
                    `endRoom${sideName}FourthFloor`
                );
                addFourthFloorOpeningEndGuard(
                    CLASS_HEIGHT * 3,
                    endSide,
                    stairCenterZ,
                    `endRoom${sideName}FourthFloor`
                );
            }
        });
    });
}

function createUnderStairRooms() {
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0xf5df9d,
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.DoubleSide
    });
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0xf5df9d,
        roughness: 0.95,
        metalness: 0.0,
        side: THREE.DoubleSide
    });
    const doorMat = new THREE.MeshStandardMaterial({
        color: 0x9dc359,
        roughness: 0.3,
        metalness: 0.1
    });

    const stairTopX = CLASS_WIDTH / 2 + 2.2 - 11.7;
    const stairRun = 9.5;
    const landingX = stairTopX + stairRun / 2;
    const upperEndX = CLASS_WIDTH / 2 - 0.30;
    const stairWidth = 2.10;
    const stairSlabThickness = 0.12;
    const flightOffsetZ = stairWidth / 2;
    const roomMinX = landingX;
    const roomMaxX = CLASS_WIDTH / 2;
    const wallThickness = 0.18;
    const roomWidth = roomMaxX - roomMinX;
    const roomDepth = stairWidth;
    // Keep the room walls below the underside of the first upper step.
    const roomHeight = CLASS_HEIGHT / 2 - 0.12;
    // Keep first-floor room infill below the second-floor slab so it cannot
    // protrude into the level above.
    const firstFloorRoomTop = CLASS_HEIGHT - 0.18;
    const doorWidth = 1.5;
    const doorHeight = 2.5;
    const doorFrameHeight = doorHeight + 0.1;
    const roomCenterX = (roomMinX + roomMaxX) / 2;
    const roomCenterZ = CLASS_LENGTH / 2 + SINGLE_ROOM_LENGTH / 6 + 0.825 - flightOffsetZ;

    const addSolidWall = (geometry, position, name) => {
        const wall = new THREE.Mesh(geometry, wallMat);
        wall.position.copy(position);
        wall.name = name;
        wall.castShadow = true;
        wall.receiveShadow = true;
        wall.userData.isWalkObstacle = true;
        scene.add(wall);
        obstacles.push(wall);
    };

    // Mirror the under-stair room beneath the upper flight at both attached
    // ends so the right and left sides have the same layout and alignment.
    [1, -1].forEach((endSide) => {
        const centerZ = endSide * roomCenterZ;
        const roomFloor = new THREE.Mesh(
            new THREE.BoxGeometry(roomWidth, 0.06, roomDepth),
            floorMat
        );
        roomFloor.position.set(roomCenterX, 0.03, centerZ);
        roomFloor.name = `underStairRoomFloor${endSide > 0 ? 'Positive' : 'Negative'}`;
        roomFloor.receiveShadow = true;
        scene.add(roomFloor);

        // Inner wall and the two end walls form the room beneath the flights.
        addSolidWall(
            new THREE.BoxGeometry(wallThickness, roomHeight, roomDepth),
            new THREE.Vector3(roomMinX + wallThickness / 2, roomHeight / 2, centerZ),
            `underStairRoomInnerWall${endSide > 0 ? 'Positive' : 'Negative'}`
        );
        [-1, 1].forEach((zSide) => {
            addSolidWall(
                new THREE.BoxGeometry(roomWidth, roomHeight, wallThickness),
                new THREE.Vector3(roomCenterX, roomHeight / 2, centerZ + zSide * (roomDepth / 2 - wallThickness / 2)),
                `underStairRoomEndWall${endSide > 0 ? 'Positive' : 'Negative'}${zSide > 0 ? 'Outer' : 'Inner'}`
            );
        });

        // Fill the first-floor room up to the underside of the upper flight.
        // The top follows the stair slope instead of leaving a triangular gap.
        const underStairFillShape = new THREE.Shape();
        const fillStartX = roomMinX;
        const fillEndX = roomMaxX;
        const upperFlightTopAtStart = CLASS_HEIGHT / 2 - stairSlabThickness;
        const upperFlightTopAtEnd = firstFloorRoomTop;
        underStairFillShape.moveTo(fillStartX, roomHeight);
        underStairFillShape.lineTo(fillEndX, roomHeight);
        underStairFillShape.lineTo(fillEndX, upperFlightTopAtEnd);
        underStairFillShape.lineTo(upperEndX, upperFlightTopAtEnd);
        underStairFillShape.lineTo(fillStartX, upperFlightTopAtStart);
        underStairFillShape.closePath();
        // Keep the doorway clear through the filled area. Two side pieces
        // preserve the first-floor room fill without putting a wall behind
        // the door opening.
        const gapFillSideDepth = (roomDepth - doorWidth) / 2;
        [-1, 1].forEach((zSide) => {
            const underStairGapFill = new THREE.Mesh(
                new THREE.ExtrudeGeometry(underStairFillShape, {
                    depth: gapFillSideDepth,
                    bevelEnabled: false
                }),
                wallMat
            );
            underStairGapFill.position.set(
                0,
                0,
                centerZ + zSide * (doorWidth / 2 + gapFillSideDepth / 2) - gapFillSideDepth / 2
            );
            underStairGapFill.name = `underStairRoomSlopedGapFill${endSide > 0 ? 'Positive' : 'Negative'}${zSide > 0 ? 'Outer' : 'Inner'}`;
            underStairGapFill.castShadow = true;
            underStairGapFill.receiveShadow = true;
            scene.add(underStairGapFill);
        });

        // Corridor-side wall with a centered door opening.
        const sideWallLength = (roomDepth - doorWidth) / 2;
        [-1, 1].forEach((zSide) => {
            addSolidWall(
                new THREE.BoxGeometry(wallThickness, doorFrameHeight, sideWallLength),
                new THREE.Vector3(
                    roomMaxX - wallThickness / 2,
                    doorFrameHeight / 2,
                    centerZ + zSide * (doorWidth / 2 + sideWallLength / 2)
                ),
                `underStairRoomDoorSide${endSide > 0 ? 'Positive' : 'Negative'}${zSide > 0 ? 'Outer' : 'Inner'}`
            );
        });
        addSolidWall(
            new THREE.BoxGeometry(wallThickness, doorFrameHeight - doorHeight, doorWidth),
            new THREE.Vector3(roomMaxX - wallThickness / 2, doorHeight + (doorFrameHeight - doorHeight) / 2, centerZ),
            `underStairRoomDoorLintel${endSide > 0 ? 'Positive' : 'Negative'}`
        );

        // Fill only the exact first-floor gap above the doorway. Keep the
        // fill door-width so it does not become a large blocking wall.
        const doorGapFillHeight = Math.max(0, firstFloorRoomTop - doorFrameHeight);
        if (doorGapFillHeight > 0) {
            addSolidWall(
                new THREE.BoxGeometry(wallThickness, doorGapFillHeight, doorWidth),
                new THREE.Vector3(
                    roomMaxX - wallThickness / 2,
                    doorFrameHeight + doorGapFillHeight / 2,
                    centerZ
                ),
                `underStairRoomDoorAboveFill${endSide > 0 ? 'Positive' : 'Negative'}`
            );
        }

        const doorGroup = new THREE.Group();
        doorGroup.position.set(roomMaxX - 0.06, 0, centerZ - doorWidth / 2);
        doorGroup.userData = {
            isOpen: false,
            openType: 'rotate',
            // The doorway is on the corridor-side wall, so swing the panel
            // inward into the under-stair room instead of blocking the hall.
            openRot: -Math.PI / 2,
            closeRot: 0,
            openingZ: centerZ,
            openingAxis: 'z',
            openingWidth: doorWidth,
            openingLocal: { x: 0, y: 0, z: doorWidth / 2 }
        };
        const doorThickness = 0.05;
        const panelCenterY = doorHeight / 2;
        const panelCenterZ = doorWidth / 2;
        const doorMesh = new THREE.Mesh(
            new THREE.BoxGeometry(doorThickness * 0.4, doorHeight, doorWidth),
            doorMat
        );
        doorMesh.position.set(0, panelCenterY, panelCenterZ);
        doorMesh.name = 'underStairRoomDoor';
        doorMesh.castShadow = true;
        doorMesh.receiveShadow = true;
        doorMesh.userData.isWalkObstacle = true;
        doorGroup.add(doorMesh);

        const stileWidth = 0.15;
        const stileGeo = new THREE.BoxGeometry(doorThickness, doorHeight, stileWidth);
        [-1, 1].forEach((side) => {
            const stile = new THREE.Mesh(stileGeo, doorMat);
            stile.position.set(0, panelCenterY, panelCenterZ + side * (doorWidth / 2 - stileWidth / 2));
            doorGroup.add(stile);
        });

        const bottomRailHeight = 0.25;
        const bottomPanelHeight = doorHeight * 0.35;
        const lockRailHeight = 0.15;
        const middlePanelHeight = doorHeight * 0.2;
        const middleRailHeight = 0.15;
        const topRailHeight = 0.15;
        const railWidth = doorWidth - 2 * stileWidth;
        const railGeo = new THREE.BoxGeometry(doorThickness, 1, railWidth);
        const addRail = (height, y) => {
            const rail = new THREE.Mesh(railGeo, doorMat);
            rail.scale.y = height;
            rail.position.set(0, y, panelCenterZ);
            doorGroup.add(rail);
        };

        const bottomRailY = bottomRailHeight / 2;
        const lockRailY = bottomRailHeight + bottomPanelHeight + lockRailHeight / 2;
        const middleRailY = lockRailY + lockRailHeight / 2 + middlePanelHeight + middleRailHeight / 2;
        addRail(bottomRailHeight, bottomRailY);
        addRail(lockRailHeight, lockRailY);
        addRail(middleRailHeight, middleRailY);
        addRail(topRailHeight, doorHeight - topRailHeight / 2);

        // Keep traditional knobs only on the under-stair room doors.
        const underStairHandleMat = new THREE.MeshStandardMaterial({
            color: 0xaaaaaa,
            metalness: 0.8,
            roughness: 0.2
        });
const underStairHandleZ = panelCenterZ + doorWidth / 2 - stileWidth / 2;
        const underStairHandlePlate = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, doorThickness + 0.02, 16),
            underStairHandleMat
        );
        underStairHandlePlate.rotation.z = Math.PI / 2;
        underStairHandlePlate.position.set(0, lockRailY, underStairHandleZ);
        doorGroup.add(underStairHandlePlate);
        [-1, 1].forEach((side) => {
            const knob = new THREE.Mesh(
                new THREE.SphereGeometry(0.035, 16, 16),
                underStairHandleMat
            );
            knob.position.set(side * (doorThickness / 2 + 0.04), lockRailY, underStairHandleZ);
            doorGroup.add(knob);
        });

        const mullionWidth = 0.15;
        const bottomMullion = new THREE.Mesh(
            new THREE.BoxGeometry(doorThickness, bottomPanelHeight, mullionWidth),
            doorMat
        );
        bottomMullion.position.set(0, lockRailY - lockRailHeight / 2 - bottomPanelHeight / 2, panelCenterZ);
        doorGroup.add(bottomMullion);

        const middleMullionGeo = new THREE.BoxGeometry(doorThickness, middlePanelHeight, mullionWidth);
        const middlePanelSpace = (railWidth - 2 * mullionWidth) / 3;
        [-1, 1].forEach((side) => {
            const mullion = new THREE.Mesh(middleMullionGeo, doorMat);
            mullion.position.set(
                0,
                lockRailY + lockRailHeight / 2 + middlePanelHeight / 2,
                panelCenterZ + side * (railWidth / 2 - middlePanelSpace - mullionWidth / 2)
            );
            doorGroup.add(mullion);
        });

        const doorEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(doorThickness * 0.4, doorHeight, doorWidth)),
            new THREE.LineBasicMaterial({ color: 0x5a7530, linewidth: 2 })
        );
        doorEdges.position.set(0, panelCenterY, panelCenterZ);
        doorGroup.add(doorEdges);
        scene.add(doorGroup);
        doorMeshes.push(doorGroup);
        obstacles.push(doorMesh);
    });
}

function createEndRoomBathrooms(baseY = 0, floorGroupName = 'firstFloor') {
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0xeedcb0,
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.DoubleSide
    });
    const interiorWallMat = new THREE.MeshStandardMaterial({
        color: 0xf5df9d,
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.DoubleSide
    });
    const floorMat = new THREE.MeshStandardMaterial({
        color: 0xf5df9d,
        roughness: 0.95,
        metalness: 0.0,
        side: THREE.DoubleSide
    });
    const doorMat = new THREE.MeshStandardMaterial({
        color: 0x9dc359,
        roughness: 0.3,
        metalness: 0.1
    });

    // The strip on the classroom side of the stair is unused. Keep the CR
    // inside the add-room bay and outside the complete stair footprint.
    const stairTopX = CLASS_WIDTH / 2 + 2.2 - 11.7;
    const stairRun = 9.5;
    const landingX = stairTopX + stairRun / 2;
    const stairWidth = 2.10;
    const wallThickness = 0.16;
    const bathroomMinX = -CLASS_WIDTH / 2 + wallThickness;
    // Restore the CR to the previous landing-edge position.
    const landingCenterX = landingX - 0.70;
    const landingBackEdgeX = landingCenterX - 2.0 / 2;
    const bathroomMaxX = landingBackEdgeX;
    const bathroomWidth = bathroomMaxX - bathroomMinX;
    const endRoomLength = SINGLE_ROOM_LENGTH / 3;
    // Match the CR exactly to the combined width of the two stair flights.
    const bathroomDepth = stairWidth * 2;
    const bathroomCenterZ = CLASS_LENGTH / 2 + endRoomLength / 2 + 0.825;
    const endRoomFloorThickness = 0.10;
    const endRoomFloorTop = 0.06;

    const addSolid = (geometry, position, material, name) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        mesh.name = name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.isWalkObstacle = true;
        scene.add(mesh);
        obstacles.push(mesh);
        return mesh;
    };

    [1, -1].forEach((endSide) => {
        const sideName = endSide > 0 ? 'Positive' : 'Negative';
        const centerZ = endSide * bathroomCenterZ;
        const innerZ = centerZ - endSide * (bathroomDepth / 2);
        const outerZ = centerZ + endSide * (bathroomDepth / 2);

        // Keep the selected floor's outer wall aligned with the CR edge.
        const floorGroup = scene.getObjectByName(floorGroupName);
        const outerWallName = `endRoomOuterWall${sideName}`;
        const originalOuterWalls = [];
        if (floorGroup) {
            floorGroup.traverse((part) => {
                if (part.name === outerWallName) originalOuterWalls.push(part);
            });
        } else if (baseY === CLASS_HEIGHT * 3) {
            // The 4th floor is the original source geometry, which is a
            // direct scene child rather than a cloned floor group.
            scene.children.forEach((part) => {
                if (part.parent === scene && part.name === outerWallName &&
                    Math.abs(part.position.y - (baseY + CLASS_HEIGHT / 2)) < 0.05) {
                    originalOuterWalls.push(part);
                }
            });
        }
        originalOuterWalls.forEach((part) => {
            part.parent?.remove(part);
            const obstacleIndex = obstacles.indexOf(part);
            if (obstacleIndex !== -1) obstacles.splice(obstacleIndex, 1);
        });

        // Add the upper-floor slab around the stair footprint. The center
        // opening is deliberately left clear so the stair flights remain
        // visible and walkable.
        if (baseY > 0) {
            const floorMinX = -CLASS_WIDTH / 2;
            const floorMaxX = CLASS_WIDTH / 2;
            const floorMinZ = Math.min(
                endSide * (CLASS_LENGTH / 2),
                endSide * (CLASS_LENGTH / 2 + endRoomLength)
            );
            const floorMaxZ = Math.max(
                endSide * (CLASS_LENGTH / 2),
                endSide * (CLASS_LENGTH / 2 + endRoomLength)
            );
            const stairOpeningMinX = stairTopX;
            const stairOpeningMaxX = CLASS_WIDTH / 2 - 0.085;
            const stairOpeningMinZ = centerZ - stairWidth;
            const stairOpeningMaxZ = centerZ + stairWidth;
            const addFloorPiece = (minX, maxX, minZ, maxZ, suffix) => {
                const width = maxX - minX;
                const depth = maxZ - minZ;
                if (width <= 0 || depth <= 0) return;
                const floorPiece = new THREE.Mesh(
                    new THREE.BoxGeometry(width, endRoomFloorThickness, depth),
                    floorMat
                );
                floorPiece.position.set(
                    (minX + maxX) / 2,
                    baseY + endRoomFloorTop - endRoomFloorThickness / 2,
                    (minZ + maxZ) / 2
                );
                floorPiece.name = `endRoomBathroomHallwayFloor${sideName}${suffix}`;
                floorPiece.receiveShadow = true;
                scene.add(floorPiece);
            };

            // Side strips beside the stair opening.
            addFloorPiece(floorMinX, stairOpeningMinX, floorMinZ, floorMaxZ, 'Left');
            addFloorPiece(stairOpeningMaxX, floorMaxX, floorMinZ, floorMaxZ, 'Right');

            // End strips before and after the switchback footprint.
            const openingMinX = Math.max(floorMinX, stairOpeningMinX);
            const openingMaxX = Math.min(floorMaxX, stairOpeningMaxX);
            addFloorPiece(openingMinX, openingMaxX, floorMinZ, stairOpeningMinZ, 'Near');
            addFloorPiece(openingMinX, openingMaxX, stairOpeningMaxZ, floorMaxZ, 'Far');
        }

        const bathroomFloor = new THREE.Mesh(
            new THREE.BoxGeometry(bathroomWidth, endRoomFloorThickness, bathroomDepth),
            floorMat
        );
        bathroomFloor.position.set(
            (bathroomMinX + bathroomMaxX) / 2,
            baseY + endRoomFloorTop - endRoomFloorThickness / 2,
            centerZ
        );
        bathroomFloor.name = `endRoomBathroomFloor${sideName}`;
        bathroomFloor.receiveShadow = true;
        scene.add(bathroomFloor);

        // Close the top of the CR so the room is fully enclosed instead of
        // leaving an exposed rectangular opening above the walls.
        const bathroomCeiling = new THREE.Mesh(
            new THREE.BoxGeometry(bathroomWidth, 0.08, bathroomDepth),
            wallMat
        );
        bathroomCeiling.position.set(
            (bathroomMinX + bathroomMaxX) / 2,
            baseY + CLASS_HEIGHT - 0.04,
            centerZ
        );
        bathroomCeiling.name = `endRoomBathroomCeiling${sideName}`;
        bathroomCeiling.castShadow = true;
        bathroomCeiling.receiveShadow = true;
        bathroomCeiling.userData.isWalkObstacle = true;
        obstacles.push(bathroomCeiling);
        scene.add(bathroomCeiling);

        // Inner end wall with a door opening facing the remaining side space.
        const bathroomDoorWidth = 1.5;
        const bathroomDoorHeight = 2.5;
        const bathroomDoorCenterX = (bathroomMinX + bathroomMaxX) / 2;
        const bathroomDoorSideWidth = (bathroomWidth - bathroomDoorWidth) / 2;
        const innerWallZ = innerZ + endSide * wallThickness / 2;
        [-1, 1].forEach((xSide) => {
            addSolid(
                new THREE.BoxGeometry(bathroomDoorSideWidth, CLASS_HEIGHT, wallThickness),
                new THREE.Vector3(
                    bathroomDoorCenterX + xSide * (bathroomDoorWidth / 2 + bathroomDoorSideWidth / 2),
                    baseY + CLASS_HEIGHT / 2,
                    innerWallZ
                ),
                interiorWallMat,
                `endRoomBathroomBackWall${sideName}${xSide > 0 ? 'Right' : 'Left'}`
            );
        });
        addSolid(
            new THREE.BoxGeometry(bathroomDoorWidth, CLASS_HEIGHT - bathroomDoorHeight, wallThickness),
            new THREE.Vector3(
                bathroomDoorCenterX,
                baseY + bathroomDoorHeight + (CLASS_HEIGHT - bathroomDoorHeight) / 2,
                innerWallZ
            ),
            interiorWallMat,
            `endRoomBathroomDoorLintel${sideName}`
        );

        // Panel door placed in the side opening, with the same interaction
        // behavior as the other doors in the building.
        const bathroomDoorGroup = new THREE.Group();
        // Put the group origin on the left hinge, matching the classroom door
        // setup so opening rotates from the side instead of the center.
        bathroomDoorGroup.position.set(bathroomDoorCenterX - bathroomDoorWidth / 2, baseY, innerWallZ);
        bathroomDoorGroup.userData = {
            isOpen: false,
            openType: 'rotate',
            openRot: endSide * Math.PI / 2,
            closeRot: 0,
            openingZ: innerWallZ,
            openingAxis: 'x',
            openingX: bathroomDoorCenterX,
            openingWidth: bathroomDoorWidth,
            openingLocal: { x: bathroomDoorWidth / 2, y: 0, z: 0 }
        };
        const bathroomDoorThickness = 0.06;
        const bathroomDoorPanel = new THREE.Group();
        bathroomDoorPanel.position.x = bathroomDoorWidth / 2;
        bathroomDoorGroup.add(bathroomDoorPanel);
        const bathroomDoorMesh = new THREE.Mesh(
            new THREE.BoxGeometry(bathroomDoorWidth, bathroomDoorHeight, bathroomDoorThickness * 0.4),
            doorMat
        );
        bathroomDoorMesh.position.y = bathroomDoorHeight / 2;
        bathroomDoorMesh.name = `endRoomBathroomDoor${sideName}`;
        bathroomDoorMesh.castShadow = true;
        bathroomDoorMesh.receiveShadow = true;
        bathroomDoorMesh.userData.isWalkObstacle = true;
        bathroomDoorPanel.add(bathroomDoorMesh);
        // Raised stiles and rails give the CR door the same multi-panel look
        // as the regular classroom doors.
        const stileWidth = 0.15;
        const bottomRailHeight = 0.25;
        const bottomPanelHeight = bathroomDoorHeight * 0.35;
        const lockRailHeight = 0.15;
        const middlePanelHeight = bathroomDoorHeight * 0.20;
        const middleRailHeight = 0.15;
        const topRailHeight = 0.15;
        const railWidth = bathroomDoorWidth - 2 * stileWidth;
        const addDoorBar = (width, height, x, y) => {
            const bar = new THREE.Mesh(
                new THREE.BoxGeometry(width, height, bathroomDoorThickness),
                doorMat
            );
            bar.position.set(x, y, 0);
            bar.castShadow = true;
            bar.receiveShadow = true;
            bathroomDoorPanel.add(bar);
        };

        addDoorBar(stileWidth, bathroomDoorHeight, -bathroomDoorWidth / 2 + stileWidth / 2, bathroomDoorHeight / 2);
        addDoorBar(stileWidth, bathroomDoorHeight, bathroomDoorWidth / 2 - stileWidth / 2, bathroomDoorHeight / 2);

        const bottomRailY = bottomRailHeight / 2;
        const lockRailY = bottomRailHeight + bottomPanelHeight + lockRailHeight / 2;
        const middleRailY = lockRailY + lockRailHeight / 2 + middlePanelHeight + middleRailHeight / 2;
        addDoorBar(railWidth, bottomRailHeight, 0, bottomRailY);
        addDoorBar(railWidth, lockRailHeight, 0, lockRailY);
        addDoorBar(railWidth, middleRailHeight, 0, middleRailY);
        addDoorBar(railWidth, topRailHeight, 0, bathroomDoorHeight - topRailHeight / 2);

        // Keep traditional knobs only on CR doors.
        const bathroomHandleMat = new THREE.MeshStandardMaterial({
            color: 0xaaaaaa,
            metalness: 0.8,
            roughness: 0.2
        });
        const bathroomHandleX = bathroomDoorWidth / 2 - 0.22;
        const bathroomHandlePlate = new THREE.Mesh(
            new THREE.CylinderGeometry(0.045, 0.045, bathroomDoorThickness + 0.03, 16),
            bathroomHandleMat
        );
        bathroomHandlePlate.rotation.x = Math.PI / 2;
        bathroomHandlePlate.position.set(bathroomHandleX, lockRailY, 0);
        bathroomDoorPanel.add(bathroomHandlePlate);
        [-1, 1].forEach((side) => {
            const bathroomKnob = new THREE.Mesh(
                new THREE.SphereGeometry(0.035, 16, 16),
                bathroomHandleMat
            );
            bathroomKnob.position.set(
                bathroomHandleX,
                lockRailY,
                side * (bathroomDoorThickness / 2 + 0.04)
            );
            bathroomDoorPanel.add(bathroomKnob);
        });

        const mullionWidth = 0.15;
        addDoorBar(
            mullionWidth,
            bottomPanelHeight,
            0,
            lockRailY - lockRailHeight / 2 - bottomPanelHeight / 2
        );
        const middlePanelSpace = (railWidth - 2 * mullionWidth) / 3;
        [-1, 1].forEach((xSide) => {
            addDoorBar(
                mullionWidth,
                middlePanelHeight,
                xSide * (railWidth / 2 - middlePanelSpace - mullionWidth / 2),
                lockRailY + lockRailHeight / 2 + middlePanelHeight / 2
            );
        });

        const bathroomDoorEdges = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(bathroomDoorWidth, bathroomDoorHeight, bathroomDoorThickness * 0.4)),
            new THREE.LineBasicMaterial({ color: 0x304117, linewidth: 2 })
        );
        bathroomDoorEdges.position.y = bathroomDoorHeight / 2;
        bathroomDoorPanel.add(bathroomDoorEdges);

        scene.add(bathroomDoorGroup);
        doorMeshes.push(bathroomDoorGroup);
        obstacles.push(bathroomDoorPanel);

        // Classroom-side wall.
        addSolid(
            new THREE.BoxGeometry(wallThickness, CLASS_HEIGHT, bathroomDepth),
            new THREE.Vector3(bathroomMinX + wallThickness / 2, baseY + CLASS_HEIGHT / 2, centerZ),
            interiorWallMat,
            `endRoomBathroomSideWall${sideName}`
        );

        // Solid wall facing the stair landing; no opening is left here.
        addSolid(
            new THREE.BoxGeometry(wallThickness, CLASS_HEIGHT, bathroomDepth),
            new THREE.Vector3(bathroomMaxX - wallThickness / 2, baseY + CLASS_HEIGHT / 2, centerZ),
            interiorWallMat,
            `endRoomBathroomLandingWall${sideName}`
        );

        // Keep the CR's outer/back side completely solid—no door or opening.
        addSolid(
            new THREE.BoxGeometry(CLASS_WIDTH, CLASS_HEIGHT, 0.18),
            new THREE.Vector3(
                0,
                baseY + CLASS_HEIGHT / 2,
                outerZ
            ),
            wallMat,
            `endRoomBathroomSolidBackWall${sideName}`
        );
    });
}

function createThirdFloor() {
    const thirdFloor = new THREE.Group();
    thirdFloor.name = 'thirdFloor';
    thirdFloor.position.y = -CLASS_HEIGHT;

    // Move the exterior ground below the new lower floor so it is not buried.
    const groundPath = scene.getObjectByName('groundPath');
    const streetGround = scene.getObjectByName('streetGround');
    if (groundPath) groundPath.position.y -= CLASS_HEIGHT * 3;
    if (streetGround) streetGround.position.y -= CLASS_HEIGHT * 3;

    const excluded = new Set([
        'groundPath',
        'streetGround',
        'oldRoof4',
        'newRoof4',
        'ceiling4',
        'ceiling4Interior',
        'canopy4',
        'frontGable4',
        'backGable4'
    ]);

    scene.children.slice().forEach((child) => {
        if (child === thirdFloor || child === transformControls?.getHelper()) return;
        if (!child.isMesh && !child.isGroup) return;
        if (excluded.has(child.name)) return;
        if (child.userData.noThirdFloorClone) return;

        const duplicate = child.clone(true);
        duplicate.traverse((part) => {
            if (part.isMesh) {
                part.castShadow = child.castShadow;
                part.receiveShadow = child.receiveShadow;
            }
            if ((part.isMesh || part.isGroup) && part.userData?.isWalkObstacle) {
                addUniqueRegistryItem(obstacles, part);
            }
            if (part.userData?.isComponent) {
                addUniqueRegistryItem(objects, part);
            }
            if (part.isGroup && part.userData?.openType) {
                part.userData.isOpen = false;
                addUniqueRegistryItem(doorMeshes, part);
            }
        });
        thirdFloor.add(duplicate);
    });

    scene.add(thirdFloor);
}

function createSecondFloor() {
    const thirdFloor = scene.getObjectByName('thirdFloor');
    if (!thirdFloor) return;

    const secondFloor = thirdFloor.clone(true);
    secondFloor.name = 'secondFloor';
    secondFloor.position.y = -CLASS_HEIGHT * 2;
    secondFloor.traverse((part) => {
        if ((part.isMesh || part.isGroup) && part.userData?.isWalkObstacle) {
            addUniqueRegistryItem(obstacles, part);
        }
        if (part.userData?.isComponent) {
            addUniqueRegistryItem(objects, part);
        }
        if (part.isGroup && part.userData?.openType) {
            part.userData.isOpen = false;
            addUniqueRegistryItem(doorMeshes, part);
        }
    });
    scene.add(secondFloor);
}

function createFirstFloor() {
    const secondFloor = scene.getObjectByName('secondFloor');
    if (!secondFloor) return;

    const firstFloor = secondFloor.clone(true);
    firstFloor.name = 'firstFloor';
    firstFloor.position.y = -CLASS_HEIGHT * 3;
    firstFloor.traverse((part) => {
        if ((part.isMesh || part.isGroup) && part.userData?.isWalkObstacle) {
            addUniqueRegistryItem(obstacles, part);
        }
        if (part.userData?.isComponent) {
            addUniqueRegistryItem(objects, part);
        }
        if (part.isGroup && part.userData?.openType) {
            part.userData.isOpen = false;
            addUniqueRegistryItem(doorMeshes, part);
        }
    });

    // Keep every structural post on the first floor continuous down to the
    // slab.  Posts are local to this floor, so their base is local Y=0 and
    // will meet the slab top when the group is placed at its final elevation.
    firstFloor.traverse((part) => {
        if (!part.isMesh) return;
        const params = part.geometry?.parameters;
        if (part.name === 'thirdFloorSource') {
            // Match the room walking surface to the corridor box top.
            part.position.y = 0.06;
            part.material = part.material.clone();
            part.material.color.set(0xf5df9d);
            return;
        }
        if (params?.width === 0.4 && params?.height === CLASS_HEIGHT && params?.depth === 0.4) {
            part.scale.y = 1;
            part.position.y = CLASS_HEIGHT / 2;
        }
    });

    // Restore the two first-floor add-room floors now that the large slab is
    // removed. They meet the corridor edge and use the same finish/color.
    const firstFloorEndRoomMat = new THREE.MeshStandardMaterial({
        color: 0xf5df9d,
        roughness: 0.9,
        metalness: 0.0,
        side: THREE.DoubleSide
    });
    const endRoomLength = SINGLE_ROOM_LENGTH / 3;
    [-1, 1].forEach((side) => {
        const endRoomFloor = new THREE.Mesh(
            new THREE.BoxGeometry(CLASS_WIDTH, 0.06, endRoomLength),
            firstFloorEndRoomMat
        );
        endRoomFloor.position.set(0, 0.03, side * (CLASS_LENGTH / 2 + endRoomLength / 2));
        endRoomFloor.name = 'firstFloorEndRoomFloor';
        endRoomFloor.receiveShadow = true;
        firstFloor.add(endRoomFloor);
    });
    // --- ADD PWD RAMPS AT END GAPS (SIDEWAYS) ---
    const rampWidth = 2.0; 
    const rampLength = 6.0; 
    const rampHeight = 0.06;
    const landingLength = 6.0;

    const rampMat = new THREE.MeshStandardMaterial({ color: 0xf5df9d, roughness: 0.95, metalness: 0.0 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x9dc359, roughness: 0.65, metalness: 0.15 });

    const corridorOuterX = CLASS_WIDTH / 2 + 2.2;
    const rampStartX = corridorOuterX; 
    const rampCenterX = rampStartX + rampWidth / 2;

    [ {zGap: -57, dir: 1}, {zGap: 57, dir: -1} ].forEach(({zGap, dir}) => {
        // --- LANDING ---
        const landingBase = new THREE.Mesh(new THREE.BoxGeometry(rampWidth, rampHeight, landingLength), rampMat);
        landingBase.position.set(rampCenterX, rampHeight / 2, zGap);
        landingBase.receiveShadow = true;
        landingBase.castShadow = true;
        firstFloor.add(landingBase);
        obstacles.push(landingBase);

        // --- RAMP ---
        const rampBase = new THREE.Mesh(new THREE.BoxGeometry(rampWidth, rampHeight, rampLength), rampMat);
        const rampCenterZ = zGap + dir * (landingLength / 2 + rampLength / 2);
        
        const tiltAngle = Math.atan2(rampHeight, rampLength);
        rampBase.rotation.x = dir * tiltAngle; 
        
        rampBase.position.set(rampCenterX, 0.00, rampCenterZ);
        rampBase.receiveShadow = true;
        rampBase.castShadow = true;
        firstFloor.add(rampBase);
        obstacles.push(rampBase);

        // --- RAILINGS ---
        [rampWidth / 2 - 0.1].forEach((xOffset) => {
            const sideX = rampCenterX + xOffset;
            
            // Horizontal rails
            [0.9, 0.45].forEach((hHeight) => {
                const r = (hHeight > 0.5) ? 0.04 : 0.02; // Match main corridor thickness
                
                // Landing Rail 
                const lRail = new THREE.Mesh(new THREE.CylinderGeometry(r, r, landingLength, 12), railMat);
                lRail.rotation.x = Math.PI / 2;
                lRail.position.set(sideX, rampHeight + hHeight, zGap);
                firstFloor.add(lRail);
                obstacles.push(lRail);

                // Ramp Rail 
                const slopeLength = Math.sqrt(rampLength*rampLength + rampHeight*rampHeight);
                const rRail = new THREE.Mesh(new THREE.CylinderGeometry(r, r, slopeLength, 12), railMat);
                rRail.rotation.x = Math.PI / 2 + dir * tiltAngle; 
                rRail.position.set(sideX, 0.03 + hHeight, rampCenterZ);
                firstFloor.add(rRail);
                obstacles.push(rRail);
            });

            // Vertical posts for landing
            [-3, -2, -1, 0, 1, 2, 3].forEach((zOffset) => {
                const postZ = zGap + zOffset;
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 12), railMat);
                post.position.set(sideX, rampHeight + 0.45, postZ);
                firstFloor.add(post);
                obstacles.push(post);
                obstacles.push(post);
                
                // Add sphere joint at the top of EVERY post
                const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 12), railMat);
                sphere.position.set(sideX, rampHeight + 0.9, postZ);
                firstFloor.add(sphere);
                obstacles.push(sphere);
            });

            // Vertical posts for ramp (skip -3 because landing already has one there)
            [-2, -1, 0, 1, 2, 3].forEach((zOffset) => {
                const postZ = rampCenterZ + dir * zOffset;
                const baseY = 0.03 - dir * zOffset * (rampHeight / rampLength);
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 12), railMat);
                post.position.set(sideX, baseY + 0.45, postZ);
                firstFloor.add(post);
                obstacles.push(post);
                obstacles.push(post);
                
                // Add sphere joint at the top of EVERY post
                const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 12), railMat);
                sphere.position.set(sideX, baseY + 0.9, postZ);
                firstFloor.add(sphere);
                obstacles.push(sphere);
            });
            
            // End railing (perpendicular) at the other end of the landing
            if (xOffset === rampWidth / 2 - 0.1) {
                const endZ = zGap - dir * (landingLength / 2);
                [0.9, 0.45].forEach((hHeight) => {
                    const r = (hHeight > 0.5) ? 0.04 : 0.02;
                    // Stop exactly at the end posts centers to avoid protruding
                    const endRailGeo = new THREE.CylinderGeometry(r, r, rampWidth - 0.2, 12);
                    const endRail = new THREE.Mesh(endRailGeo, railMat);
                    endRail.rotation.z = Math.PI / 2; // Runs along X axis
                    endRail.position.set(rampCenterX, rampHeight + hHeight, endZ);
                    endRail.castShadow = true;
                    firstFloor.add(endRail);
                    obstacles.push(endRail);
                });
                
                // Add vertical posts along the end railing
                [-0.9, 0, 0.9].forEach(xOff => {
                    const endPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 12), railMat);
                    endPost.position.set(rampCenterX + xOff, rampHeight + 0.45, endZ);
                    endPost.castShadow = true;
                    firstFloor.add(endPost);
                    obstacles.push(endPost);
                    obstacles.push(endPost);
                    
                    // Sphere joint at the top
                    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 12), railMat);
                    sphere.position.set(rampCenterX + xOff, rampHeight + 0.9, endZ);
                    firstFloor.add(sphere);
                obstacles.push(sphere);
                });
            }
        });
    });

    // Create a middle entrance (butas sa gitna) in the corridor railing on the first floor
    const corridorRailParts = ['corridorBalustrade', 'corridorTopRail', 'terraceGreenTube'];
    const entranceWidth = 24.2; // 6 meter wide entrance in the middle
    const centerPost = firstFloor.getObjectByName('corridorOuterPostCenter');
    if (centerPost) {
        centerPost.parent?.remove(centerPost);
        const obstacleIndex = obstacles.indexOf(centerPost);
        if (obstacleIndex !== -1) obstacles.splice(obstacleIndex, 1);
    }

    const centerTubeSupport1 = firstFloor.getObjectByName('corridorGreenTubeSupportCenter');
    if (centerTubeSupport1) {
        centerTubeSupport1.parent?.remove(centerTubeSupport1);
    }
    
    const centerTubeSupport2 = firstFloor.getObjectByName('corridorCenterGreenTubeSupport');
    if (centerTubeSupport2) {
        centerTubeSupport2.parent?.remove(centerTubeSupport2);
    }

    // Remove the adjacent posts to widen the entrance
    const postsToRemove = [];
    firstFloor.traverse((part) => {
        if (part.name === 'corridorOuterPost' || part.name === 'corridorGreenTubeSupport') {
            if (Math.abs(part.position.z) > 5.0 && Math.abs(part.position.z) < 6.0) {
                postsToRemove.push(part);
            }
        }
    });
    postsToRemove.forEach((part) => {
        part.parent?.remove(part);
        const obstacleIndex = obstacles.indexOf(part);
        if (obstacleIndex !== -1) obstacles.splice(obstacleIndex, 1);
    });

    // Remove floating green uprights (visibleGreenUpright) in the middle gap
    const greenUprightsToRemove = [];
    firstFloor.traverse((part) => {
        if (part.name === 'corridorGreenUpright') {
            if (part.position.z > -12.2 && part.position.z < 12.2) {
                greenUprightsToRemove.push(part);
            }
        }
    });
    greenUprightsToRemove.forEach(part => {
        part.parent?.remove(part);
        const obstacleIndex = obstacles.indexOf(part);
        if (obstacleIndex !== -1) obstacles.splice(obstacleIndex, 1);
    });


    corridorRailParts.forEach((partName) => {
        const part = firstFloor.getObjectByName(partName);
        if (part) {
            // Remove the original full-length part
            part.parent?.remove(part);
            const obstacleIndex = obstacles.indexOf(part);
            if (obstacleIndex !== -1) obstacles.splice(obstacleIndex, 1);
            
            // Create two halves
            const halfLength = (CLASS_LENGTH - entranceWidth) / 2;
            const leftZ = -CLASS_LENGTH / 2 + halfLength / 2;
            const rightZ = CLASS_LENGTH / 2 - halfLength / 2;

            const partLeft = part.clone();
            const partRight = part.clone();

            if (partLeft.geometry.type === 'BoxGeometry') {
                partLeft.geometry = new THREE.BoxGeometry(part.geometry.parameters.width, part.geometry.parameters.height, halfLength);
                partRight.geometry = new THREE.BoxGeometry(part.geometry.parameters.width, part.geometry.parameters.height, halfLength);
            } else if (partLeft.geometry.type === 'CylinderGeometry') {
                // For terraceGreenTube, length is height parameter
                partLeft.geometry = new THREE.CylinderGeometry(part.geometry.parameters.radiusTop, part.geometry.parameters.radiusBottom, halfLength, part.geometry.parameters.radialSegments);
                partRight.geometry = new THREE.CylinderGeometry(part.geometry.parameters.radiusTop, part.geometry.parameters.radiusBottom, halfLength, part.geometry.parameters.radialSegments);
            }

            partLeft.position.z = leftZ;
            partRight.position.z = rightZ;

            firstFloor.add(partLeft);
            firstFloor.add(partRight);
            
            if (part.userData.isWalkObstacle) {
                obstacles.push(partLeft);
                obstacles.push(partRight);
            }
        }
    });

    // Keep the far-end first-floor side opening clear by removing its side barrier set.
    const endBarrierNames = new Set([
        'endRoomRailing',
        'endRoomTopRail',
        'endGreenTube',
        'endGreenUpright'
    ]);
    const endBarrierParts = [];
    firstFloor.traverse((part) => {
        if (endBarrierNames.has(part.name)) endBarrierParts.push(part);
    });
    endBarrierParts.forEach((part) => {
        part.parent?.remove(part);
        const obstacleIndex = obstacles.indexOf(part);
        if (obstacleIndex !== -1) obstacles.splice(obstacleIndex, 1);
    });

    scene.add(firstFloor);
}

function addEndRoomFloors(floorName) {
    const floorGroup = scene.getObjectByName(floorName);
    if (!floorGroup) return;

    const endRoomLength = SINGLE_ROOM_LENGTH / 3;
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xf5df9d, roughness: 0.95, metalness: 0.0, side: THREE.DoubleSide });
    [-1, 1].forEach((side) => {
        const endRoomFloor = new THREE.Mesh(
            new THREE.BoxGeometry(CLASS_WIDTH + 0.04, 0.06, endRoomLength),
            floorMat
        );
        endRoomFloor.position.set(0, 0, side * (CLASS_LENGTH / 2 + endRoomLength / 2));
        endRoomFloor.name = `${floorName}EndRoomFloor`;
        endRoomFloor.receiveShadow = true;
        floorGroup.add(endRoomFloor);

        const floorBridge = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.06, endRoomLength - 0.18),
            new THREE.MeshStandardMaterial({ color: 0xf5df9d, roughness: 0.9, metalness: 0.0 })
        );
        floorBridge.position.set(CLASS_WIDTH / 2, 0, side * (CLASS_LENGTH / 2 + endRoomLength / 2));
        floorBridge.name = `${floorName}EndRoomFloorBridge`;
        floorBridge.receiveShadow = true;
        floorGroup.add(floorBridge);
    });
}

function createUShapedBuildingLayout() {
    if (scene.getObjectByName('buildingUnitLeft')) return;

    const excludedNames = new Set(['groundPath', 'streetGround']);
    const buildingParts = scene.children.slice().filter((child) => (
        (child.isMesh || child.isGroup) &&
        child !== transformControls?.getHelper() &&
        !excludedNames.has(child.name)
    ));
    if (buildingParts.length === 0) return;

    // Gather the finished building into one unit so every wall, floor, stair,
    // door, railing, roof, ceiling, and room device is copied together.
    const buildingUnit = new THREE.Group();
    buildingUnit.name = 'buildingUnitLeft';
    buildingParts.forEach((part) => buildingUnit.add(part));

    const unitBounds = new THREE.Box3().setFromObject(buildingUnit);
    const unitCenter = unitBounds.getCenter(new THREE.Vector3());
    const unitSize = unitBounds.getSize(new THREE.Vector3());

    // Put the unit origin at the footprint center so rotated copies pivot
    // around their own center instead of swinging around the old origin.
    buildingUnit.traverse((part) => {
        if (part.parent !== buildingUnit) return;
        part.position.x -= unitCenter.x;
        part.position.z -= unitCenter.z;
    });
    scene.add(buildingUnit);

    const buildingLength = Math.max(unitSize.x, unitSize.z);
    const buildingWidth = Math.min(unitSize.x, unitSize.z);
    // Use four full building copies to form one continuous U. The upper pair
    // meet end-to-end at the center, while the side units sit at their ends.
    const sideInset = Math.max(1.2, buildingWidth * 0.08);
    // Triple the original clearance so every building has much more room
    // between its neighboring copies while keeping the U layout aligned.
    const buildingGap = Math.max(3, buildingWidth * 0.16) * 3;
    // Pull the side units inside the upper ends so they do not protrude past
    // the U's top corners.
    const sideCenterX = buildingLength - buildingWidth / 2 + buildingGap / 2 - sideInset + 2;
    const topCenterX = buildingLength / 2 + buildingGap / 2;
    // Keep a small, consistent visual gap at the corners and between the
    // upper pair instead of letting the copied buildings merge together.
    const topCenterZ = buildingLength / 2 + buildingWidth / 2 + buildingGap / 2;

    // Keep the original unit as the left side of the U.
    buildingUnit.position.set(-sideCenterX, 0, 0);

    const registerBuildingClone = (clone) => {
        addUniqueRegistryItem(objects, clone);
        clone.traverse((part) => {
            if ((part.isMesh || part.isGroup) && part.userData?.isWalkObstacle) {
                addUniqueRegistryItem(obstacles, part);
            }
            if (part.userData?.isComponent) {
                addUniqueRegistryItem(objects, part);
            }
            if (part.isGroup && part.userData?.openType) {
                part.userData.isOpen = false;
                addUniqueRegistryItem(doorMeshes, part);
            }
            if (part.name === 'newRoof4' && window.roofGroups) {
                window.roofGroups.push(part);
            }
            if (part.name === 'ceiling4Interior' && window.ceilingGroups) {
                window.ceilingGroups.push(part);
            }
        });
        scene.add(clone);
    };

    const cloneUnit = (name, x, z, rotationY = 0) => {
        const clone = buildingUnit.clone(true);
        clone.name = name;
        clone.position.set(x, 0, z);
        clone.rotation.y = rotationY;
        registerBuildingClone(clone);
        return clone;
    };

    // Rotate the right side so its corridor/openings face the courtyard.
    cloneUnit('buildingUnitRight', sideCenterX, 0, Math.PI);
    cloneUnit('buildingUnitTopLeft', -topCenterX, topCenterZ, Math.PI / 2);
    cloneUnit('buildingUnitTopRight', topCenterX, topCenterZ, Math.PI / 2);

    // Expand the shared ground planes so the four-unit U layout is not cut
    // off at the old single-building boundary.
    const layoutHalfWidth = Math.max(
        sideCenterX + buildingWidth / 2,
        topCenterX + buildingLength / 2
    );
    const layoutWidth = 2 * layoutHalfWidth;
    const groundPath = scene.getObjectByName('groundPath');
    const streetGround = scene.getObjectByName('streetGround');
    if (groundPath?.geometry?.parameters?.width) {
        groundPath.scale.x = Math.max(groundPath.scale.x, layoutWidth / groundPath.geometry.parameters.width);
    }
    if (streetGround?.geometry?.parameters?.width) {
        streetGround.scale.x = Math.max(streetGround.scale.x, layoutWidth / streetGround.geometry.parameters.width);
    }

    // Frame the full U layout in the editor on startup.
    if (editCamera && orbitControls) {
        const viewDistance = Math.max(layoutWidth, topCenterZ + buildingWidth) * 1.05;
        editCamera.position.set(viewDistance * 0.72, viewDistance * 0.58, viewDistance * 0.82);
        orbitControls.target.set(0, CLASS_HEIGHT * 1.5, topCenterZ / 3);
        orbitControls.update();
    }

}



function liftBuildingStackToGround() {
    const firstFloorBaseY = 0.00;

    // Anchor cloned floors directly so repeated edits cannot accumulate Y
    // offsets and make floors merge or drift apart.
    const firstFloor = scene.getObjectByName('firstFloor');
    const secondFloor = scene.getObjectByName('secondFloor');
    const thirdFloor = scene.getObjectByName('thirdFloor');
    if (firstFloor) firstFloor.position.y = firstFloorBaseY;
    if (secondFloor) secondFloor.position.y = firstFloorBaseY + CLASS_HEIGHT;
    if (thirdFloor) thirdFloor.position.y = firstFloorBaseY + CLASS_HEIGHT * 2;

    // The original source geometry is the 4th floor. Its source baseline is
    // zero, so place it one full floor above the third-floor clone.
    const clonedFloors = new Set([firstFloor, secondFloor, thirdFloor]);
    scene.children.forEach((child) => {
        if (child === transformControls?.getHelper() || clonedFloors.has(child)) return;
        if (child.name === 'groundPath' || child.name === 'streetGround') {
            child.position.y = 0;
            return;
        }

        if (child.isMesh || child.isGroup) child.position.y += firstFloorBaseY + CLASS_HEIGHT * 3;
    });
}

function buildClassroom() {
    // Floor (Inside Classroom)
    const floorGeo = new THREE.PlaneGeometry(CLASS_WIDTH, CLASS_LENGTH);
      const floorMat = new THREE.MeshStandardMaterial({
          color: 0xf5df9d,
          roughness: 0.95,
          metalness: 0.0,
          side: THREE.DoubleSide
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.name = 'thirdFloorSource';
      floor.rotation.x = -Math.PI / 2;
      
      floor.receiveShadow = true;
      scene.add(floor);

    // Straight corridor running continuously along the classroom door side.
    const corridorCenterX = CLASS_WIDTH / 2 + 1.1;
    const corridorMat = new THREE.MeshStandardMaterial({
        color: 0xf5df9d,
        roughness: 0.9,
        metalness: 0.0
    });
    const corridor = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.06, CLASS_LENGTH),
        corridorMat
    );
    corridor.name = 'thirdFloorCorridorSource';
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
        color: 0xeedcb0,
        roughness: 0.8,
        metalness: 0.0
    });

    const corridorCanopy = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 0.18, CLASS_LENGTH),
        corridorStructureMat
    );
    corridorCanopy.name = 'canopy4';
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
        post.name = Math.abs(z) < 1e-6 ? 'corridorOuterPostCenter' : 'corridorOuterPost';
        post.castShadow = true;
        scene.add(post);
        corridorPosts.push(post);
    });

    const corridorBalustrade = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.95, CLASS_LENGTH),
        corridorRailMat
    );
    corridorBalustrade.name = 'corridorBalustrade';
    corridorBalustrade.position.set(corridorOuterX, 0.48, 0);
    corridorBalustrade.castShadow = true;
    scene.add(corridorBalustrade);

    const corridorTopRail = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.12, CLASS_LENGTH),
        corridorStructureMat
    );
    corridorTopRail.name = 'corridorTopRail';
    corridorTopRail.position.set(corridorOuterX, 1.02, 0);
    corridorTopRail.userData.isWalkObstacle = true;
    obstacles.push(corridorTopRail);
    corridorTopRail.castShadow = true;
    scene.add(corridorTopRail);

    const greenTubeMat = new THREE.MeshStandardMaterial({ color: 0x9dc359, roughness: 0.65, metalness: 0.15 });
    const terraceGreenTube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, CLASS_LENGTH, 16),
        greenTubeMat
    );
    terraceGreenTube.name = 'terraceGreenTube';
    terraceGreenTube.rotation.x = Math.PI / 2;
    terraceGreenTube.position.set(corridorOuterX, 1.32, 0);
    terraceGreenTube.castShadow = true;
    scene.add(terraceGreenTube);

    const corridorUpperHorizontalPost = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 0.4, CLASS_LENGTH),
        corridorStructureMat
    );
    corridorUpperHorizontalPost.name = 'corridorUpperHorizontalPost';
    corridorUpperHorizontalPost.position.set(corridorOuterX, CLASS_HEIGHT - 0.2, 0);
    corridorUpperHorizontalPost.userData.isWalkObstacle = true;
    obstacles.push(corridorUpperHorizontalPost);
    corridorUpperHorizontalPost.castShadow = true;
    scene.add(corridorUpperHorizontalPost);

    corridorPostPositions.forEach((z) => {
        const terraceGreenTubeSupport = new THREE.Mesh(
            new THREE.CylinderGeometry(0.08, 0.08, 1.32, 16),
            greenTubeMat
        );
        terraceGreenTubeSupport.name = Math.abs(z) < 1e-6
            ? 'corridorGreenTubeSupportCenter'
            : 'corridorGreenTubeSupport';
        terraceGreenTubeSupport.position.set(corridorOuterX + 0.12, 0.66, z);
        terraceGreenTubeSupport.castShadow = true;
        scene.add(terraceGreenTubeSupport);
    });

    const centerGreenTubeSupport = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 1.32, 16),
        greenTubeMat
    );
    centerGreenTubeSupport.name = 'corridorCenterGreenTubeSupport';
    centerGreenTubeSupport.position.set(corridorOuterX + 0.12, 0.66, 0);
    centerGreenTubeSupport.castShadow = true;
    scene.add(centerGreenTubeSupport);

    // Three green uprights in the middle of every bay between the main posts.
    const sortedRailingPosts = [...new Set(corridorPostPositions)].sort((a, b) => a - b);
    for (let i = 0; i < sortedRailingPosts.length - 1; i++) {
        const startZ = sortedRailingPosts[i];
        const endZ = sortedRailingPosts[i + 1];
        [0.25, 0.5, 0.75].forEach((ratio) => {
            const uprightZ = startZ + (endZ - startZ) * ratio;
            const visibleGreenUpright = new THREE.Mesh(
                new THREE.CylinderGeometry(0.07, 0.07, 0.42, 16),
                greenTubeMat
            );
            visibleGreenUpright.name = 'corridorGreenUpright';
            visibleGreenUpright.position.set(corridorOuterX, 1.14, uprightZ);
            visibleGreenUpright.castShadow = true;
            scene.add(visibleGreenUpright);
        });
    }

    // The dark gray apron has been removed so the gravel yard goes straight up to the walls.

    // Rock / Gravel Yard (Surrounding the room)
    const pathWidth = CLASS_WIDTH + 200;
    const pathLength = CLASS_LENGTH + 200;
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

    const groundMat = new THREE.MeshStandardMaterial({
        color: 0x707070,
        roughness: 1.0,
        metalness: 0.0
    });
    const pathMat = groundMat;
    const path = new THREE.Mesh(pathGeo, pathMat);
    path.name = 'groundPath';
    path.rotation.x = -Math.PI / 2;
    path.position.y = -0.005; // Slightly below floor to avoid z-fighting
    path.receiveShadow = true;
    scene.add(path);

    // Sidewalk Outside Fence
    const streetGeo = new THREE.PlaneGeometry(220, CLASS_LENGTH + 220);
    const streetMat = groundMat; // Same single-color ground outside the fence
    const street = new THREE.Mesh(streetGeo, streetMat);
    street.name = 'streetGround';
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
    roofGroup.name = 'oldRoof4';
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
    ceiling.name = 'ceiling4';
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
        endWall.name = `endRoomOuterWall${z > 0 ? 'Positive' : 'Negative'}`;
        endWall.position.set(0, CLASS_HEIGHT / 2, z + (z < 0 ? -endRoomLength / 2 : endRoomLength / 2));
        endWall.userData.isWalkObstacle = true;
        scene.add(endWall);
        obstacles.push(endWall);

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
        endGable.userData.noThirdFloorClone = true;
        endGable.position.set(0, CLASS_HEIGHT, z + (z < 0 ? -endRoomLength / 2 : endRoomLength / 2));
        scene.add(endGable);

        const packageRoomFloor = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, endRoomLength), corridorMat);
        packageRoomFloor.name = 'packageRoomFloor';
        // Match the corridor floor's top surface to remove the visible joint
        // where the attached room meets the corridor on every floor.
        packageRoomFloor.position.set(corridorCenterX, 0.02, z);
        packageRoomFloor.receiveShadow = true;
        scene.add(packageRoomFloor);

        [-1, 1].forEach((side) => {
            if (side === 1) return; // Keep the door-side corridor open.
            const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, CLASS_HEIGHT, endRoomLength), wallMat);
            sideWall.position.set(side * (CLASS_WIDTH / 2 - 0.09), CLASS_HEIGHT / 2, z);
            sideWall.userData.isWalkObstacle = true;
            scene.add(sideWall);
            obstacles.push(sideWall);
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
        endRoomRailing.name = 'endRoomRailing';
        endRoomRailing.position.set(corridorOuterX, 0.48, z);
        endRoomRailing.userData.isWalkObstacle = true;
        scene.add(endRoomRailing);
        obstacles.push(endRoomRailing);

        const endRoomTopRail = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.12, endRoomLength),
            corridorStructureMat
        );
        endRoomTopRail.name = 'endRoomTopRail';
        endRoomTopRail.position.set(corridorOuterX, 1.02, z);
        endRoomTopRail.userData.isWalkObstacle = true;
        obstacles.push(endRoomTopRail);
        scene.add(endRoomTopRail);

        const endGreenTube = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.06, endRoomLength, 16),
            greenTubeMat
        );
        endGreenTube.name = 'endGreenTube';
        endGreenTube.rotation.x = Math.PI / 2;
        endGreenTube.position.set(corridorOuterX, 1.32, z);
        endGreenTube.castShadow = true;
        scene.add(endGreenTube);

        const endRoomUpperPost = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.4, endRoomLength),
            corridorStructureMat
        );
        endRoomUpperPost.name = 'endRoomUpperPost';
        endRoomUpperPost.position.set(corridorOuterX, CLASS_HEIGHT - 0.2, z);
        endRoomUpperPost.userData.isWalkObstacle = true;
        obstacles.push(endRoomUpperPost);
        endRoomUpperPost.castShadow = true;
        scene.add(endRoomUpperPost);
        addedRoomBeams.push(endRoomUpperPost);

        [0.25, 0.5, 0.75].forEach((ratio) => {
            const endGreenUpright = new THREE.Mesh(
                new THREE.CylinderGeometry(0.07, 0.07, 0.42, 16),
                greenTubeMat
            );
            endGreenUpright.name = 'endGreenUpright';
            endGreenUpright.position.set(corridorOuterX, 1.14, z - endRoomLength / 2 + endRoomLength * ratio);
            endGreenUpright.castShadow = true;
            scene.add(endGreenUpright);
        });

        const endZ = z + (z < 0 ? -endRoomLength / 2 : endRoomLength / 2);
        const endSideRailing = new THREE.Mesh(
            new THREE.BoxGeometry(2.2, 0.95, 0.14),
            corridorRailMat
        );
        endSideRailing.name = 'endSideRailing';
        endSideRailing.position.set(corridorCenterX, 0.48, endZ);
        endSideRailing.userData.isWalkObstacle = true;
        scene.add(endSideRailing);
        obstacles.push(endSideRailing);

        const endSideTopRail = new THREE.Mesh(
            new THREE.BoxGeometry(2.2, 0.12, 0.18),
            corridorStructureMat
        );
        endSideTopRail.name = 'endSideTopRail';
        endSideTopRail.position.set(corridorCenterX, 1.02, endZ);
        endSideTopRail.userData.isWalkObstacle = true;
        obstacles.push(endSideTopRail);
        scene.add(endSideTopRail);

        const endSideGreenTube = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.06, 2.2, 16),
            greenTubeMat
        );
        endSideGreenTube.name = 'endSideGreenTube';
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
    frontPediment.name = 'frontGable4';
    // Extrude goes +Z. Front wall occupies [CLASS_LENGTH/2 - 0.1, CLASS_LENGTH/2 + 0.1]. Place at -0.1 to match.
    frontPediment.position.set(roofCenterOffsetX, CLASS_HEIGHT, CLASS_LENGTH / 2 - 0.1);
    scene.add(frontPediment); // Add to scene, not roofGroup, so it stays when roof is hidden
    obstacles.push(frontPediment);
    frontPediment.visible = false;

    const backPediment = new THREE.Mesh(pedimentGeo, pedimentMat);
    backPediment.name = 'backGable4';
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
    newRoofGroup.name = 'newRoof4';
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
    // The active roof is the replacement group above; expose it for the
    // Components checkbox instead of the old removed roof group.
    window.roofGroup = newRoofGroup;
    window.roofGroups = [newRoofGroup];

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
    interiorCeiling.name = 'ceiling4Interior';
    interiorCeiling.position.set(
        (corridorOuterX - CLASS_WIDTH / 2) / 2,
        CLASS_HEIGHT - 0.12,
        0
    );
    interiorCeiling.castShadow = false;
    interiorCeiling.receiveShadow = true;
    scene.add(interiorCeiling);
    window.ceilingGroup = interiorCeiling;
    window.ceilingGroups = [interiorCeiling];

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

        // 2. Lock rail for the digital lock
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

        const midRailY = -0.1; // Slightly below center

        return group;
    }
function createJalousieWindow(zCenter, width = 4, wallX = -CLASS_WIDTH / 2) {
        const group = new THREE.Group();
        group.userData.type = 'window';
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
        group.userData.type = 'window';
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
        doorGroup1.userData = {
            isOpen: false,
            openType: 'rotate',
            openRot: Math.PI / 2,
            closeRot: 0,
            openingZ: door1Z,
            openingAxis: 'z',
            openingWidth: doorWidth,
            openingLocal: { x: 0, y: 0, z: -doorWidth / 2 }
        };
        const dMesh1 = createPanelDoor(doorWidth, doorHeight, 0.05, doorMeshMat, 'left');
        dMesh1.position.set(0, doorHeight / 2, -doorWidth / 2);
        dMesh1.add(createDigitalLock(doorWidth, doorHeight, 0.05, 'left', 'z'));
        doorGroup1.add(dMesh1);
        scene.add(doorGroup1);
        doorMeshes.push(doorGroup1);
        obstacles.push(dMesh1);

        const doorGroup2 = new THREE.Group();
        doorGroup2.position.set(CLASS_WIDTH / 2, 0, door2Z - doorWidth / 2);
        doorGroup2.userData = {
            isOpen: false,
            openType: 'rotate',
            openRot: -Math.PI / 2,
            closeRot: 0,
            openingZ: door2Z,
            openingAxis: 'z',
            openingWidth: doorWidth,
            openingLocal: { x: 0, y: 0, z: doorWidth / 2 }
        };
        const dMesh2 = createPanelDoor(doorWidth, doorHeight, 0.05, doorMeshMat, 'right');
        dMesh2.position.set(0, doorHeight / 2, doorWidth / 2);
        dMesh2.add(createDigitalLock(doorWidth, doorHeight, 0.05, 'right', 'z'));
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
        dividerGable.userData.noThirdFloorClone = true;
        dividerGable.position.set(0, CLASS_HEIGHT, zCenter + SINGLE_ROOM_LENGTH / 2);
        scene.add(dividerGable);

        // Add the security package to the source floor. The floor-cloning
        // setup below carries these room devices to every school floor.
        addClassroomSecurityPackage(zCenter, i);
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

function addUniqueRegistryItem(registry, item) {
    if (!registry.includes(item)) registry.push(item);
}

function addObj(obj) {
    scene.add(obj);
    addUniqueRegistryItem(objects, obj);
}

function removeObj(obj) {
    scene.remove(obj);
    const idx = objects.indexOf(obj);
    if (idx > -1) objects.splice(idx, 1);
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

function setChairsVisibility(visible) {
    scene.traverse((object) => {
        if (object.userData?.type === 'studentChair' || object.userData?.type === 'teacherChair') {
            object.visible = visible;
        }
    });
}

function setBlackboardsVisibility(visible) {
    scene.traverse((object) => {
        if (object.userData?.type === 'board') {
            object.visible = visible;
        }
    });
}

function setDoorsVisibility(visible) {
    scene.traverse((object) => {
        if (object.userData?.openType) {
            object.visible = visible;
        }
    });
}

function setWindowsVisibility(visible) {
    scene.traverse((object) => {
        if (object.userData?.type === 'window') {
            object.visible = visible;
        }
    });
}

function applyComponentVisibilityToggles() {
    const chairsToggle = document.getElementById('chk-toggle-chairs');
    const blackboardsToggle = document.getElementById('chk-toggle-blackboards');
    const doorsToggle = document.getElementById('chk-toggle-doors');
    const windowsToggle = document.getElementById('chk-toggle-windows');
    setChairsVisibility(chairsToggle ? chairsToggle.checked : false);
    setBlackboardsVisibility(blackboardsToggle ? blackboardsToggle.checked : true);
    setDoorsVisibility(doorsToggle ? doorsToggle.checked : true);
    setWindowsVisibility(windowsToggle ? windowsToggle.checked : true);
}

function getBuildingVisibilityConfigs() {
    return [
        { id: 'chk-building-left', name: 'buildingUnitLeft' },
        { id: 'chk-building-right', name: 'buildingUnitRight' },
        { id: 'chk-building-back-left', name: 'buildingUnitTopLeft' },
        { id: 'chk-building-back-right', name: 'buildingUnitTopRight' }
    ];
}

function setBuildingVisibility(buildingName, visible) {
    const building = scene.getObjectByName(buildingName);
    if (building) building.visible = visible;
}

function applyBuildingVisibilityToggles() {
    getBuildingVisibilityConfigs().forEach(({ id, name }) => {
        const toggle = document.getElementById(id);
        setBuildingVisibility(name, toggle ? toggle.checked : true);
    });
}

function setupUI() {
    // Mode Buttons
    document.getElementById('btn-edit-mode').addEventListener('click', () => setMode('EDIT'));
    document.getElementById('btn-view-mode').addEventListener('click', () => setMode('VIEW'));

    // Roof Toggle Checkbox
    const chkToggleRoof = document.getElementById('chk-toggle-roof');
    if (chkToggleRoof) {
        const setRoofAndCeilingVisibility = (visible) => {
            const roofGroups = window.roofGroups || (window.roofGroup ? [window.roofGroup] : []);
            const ceilingGroups = window.ceilingGroups || (window.ceilingGroup ? [window.ceilingGroup] : []);
            roofGroups.forEach((group) => { group.visible = visible; });
            ceilingGroups.forEach((group) => { group.visible = visible; });
        };
        chkToggleRoof.addEventListener('change', (e) => {
            setRoofAndCeilingVisibility(e.target.checked);
        });
        setRoofAndCeilingVisibility(chkToggleRoof.checked);
    }

    // Chairs Toggle
    const chkToggleChairs = document.getElementById('chk-toggle-chairs');
    if (chkToggleChairs) {
        chkToggleChairs.addEventListener('change', (e) => {
            setChairsVisibility(e.target.checked);
        });
    }

    // Blackboards Toggle
    const chkToggleBlackboards = document.getElementById('chk-toggle-blackboards');
    if (chkToggleBlackboards) {
        chkToggleBlackboards.addEventListener('change', (e) => {
            setBlackboardsVisibility(e.target.checked);
        });
    }

    // Doors Toggle
    const chkToggleDoors = document.getElementById('chk-toggle-doors');
    if (chkToggleDoors) {
        chkToggleDoors.addEventListener('change', (e) => {
            setDoorsVisibility(e.target.checked);
        });
    }

    // Windows Toggle
    const chkToggleWindows = document.getElementById('chk-toggle-windows');
    if (chkToggleWindows) {
        chkToggleWindows.addEventListener('change', (e) => {
            setWindowsVisibility(e.target.checked);
        });
    }

    // Building visibility toggles
    getBuildingVisibilityConfigs().forEach(({ id, name }) => {
        const toggle = document.getElementById(id);
        if (!toggle) return;
        toggle.addEventListener('change', (e) => {
            setBuildingVisibility(name, e.target.checked);
        });
    });

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
    if (mode !== 'EDIT' && mode !== 'VIEW') mode = 'EDIT';
    currentMode = mode;
    const btnEdit = document.getElementById('btn-edit-mode');
    const btnView = document.getElementById('btn-view-mode');

    btnEdit.classList.remove('active');
    btnView.classList.remove('active');

    moveForward = false;
    moveBackward = false;
    moveLeft = false;
    moveRight = false;

    if (mode === 'EDIT') {
        btnEdit.classList.add('active');

        camera = editCamera;
        orbitControls.enabled = true;

        // Re-enable editing tools
        document.getElementById('left-sidebar').style.display = 'block';
        document.getElementById('right-sidebar').style.display = 'block';

    } else if (mode === 'VIEW') {
        btnView.classList.add('active');

        camera = editCamera;
        orbitControls.enabled = true;

        deselect();

        // Disable UI
        document.getElementById('left-sidebar').style.display = 'none';
        document.getElementById('right-sidebar').style.display = 'none';
    }

    onWindowResize();
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    editCamera.aspect = width / height;
    editCamera.updateProjectionMatrix();

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
    } else if (currentMode === 'VIEW') {
        switch (event.code) {
            case 'KeyW': moveForward = true; break;
            case 'KeyA': moveLeft = true; break;
            case 'KeyS': moveBackward = true; break;
            case 'KeyD': moveRight = true; break;
        }
    }
}

function onKeyUp(event) {
    if (currentMode === 'VIEW') {
        switch (event.code) {
            case 'KeyW': moveForward = false; break;
            case 'KeyA': moveLeft = false; break;
            case 'KeyS': moveBackward = false; break;
            case 'KeyD': moveRight = false; break;
        }
    }
}

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    if (currentMode === 'EDIT' && selectedObject) updatePropertiesPanel();

    if (currentMode === 'VIEW') {
        const viewDirection = new THREE.Vector3();
        editCamera.getWorldDirection(viewDirection);
        viewDirection.y = 0;
        viewDirection.normalize();
        const viewRight = new THREE.Vector3().crossVectors(viewDirection, editCamera.up).normalize();
        const viewMove = new THREE.Vector3();
        viewMove.addScaledVector(viewDirection, Number(moveForward) - Number(moveBackward));
        viewMove.addScaledVector(viewRight, Number(moveRight) - Number(moveLeft));
        if (viewMove.lengthSq() > 0) {
            viewMove.normalize().multiplyScalar(10.0 * delta);
            editCamera.position.add(viewMove);
            orbitControls.target.add(viewMove);
            orbitControls.update();
        }
    }

    prevTime = time;
    renderer.render(scene, camera);
}
