import * as THREE from 'three';

export function createStudentChair() {
    const group = new THREE.Group();
    group.userData.type = 'studentChair';
    group.userData.isComponent = true;
    group.userData.isWalkObstacle = true;

    // Seat
    const seatGeo = new THREE.BoxGeometry(0.4, 0.05, 0.4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
    const seat = new THREE.Mesh(seatGeo, mat);
    seat.position.y = 0.45;
    group.add(seat);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.05, 0.45, 0.05);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
    const positions = [
        [-0.175, 0.225, -0.175],
        [0.175, 0.225, -0.175],
        [-0.175, 0.225, 0.175],
        [0.175, 0.225, 0.175]
    ];
    positions.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(...pos);
        group.add(leg);
    });

    // Backrest (at positive Z, so person faces negative Z)
    const backGeo = new THREE.BoxGeometry(0.4, 0.4, 0.05);
    const back = new THREE.Mesh(backGeo, mat);
    back.position.set(0, 0.65, 0.175);
    group.add(back);

    // Armrest/Desk part (right side, positive X when facing negative Z)
    const deskGeo = new THREE.BoxGeometry(0.2, 0.05, 0.5);
    const desk = new THREE.Mesh(deskGeo, mat);
    desk.position.set(0.3, 0.65, -0.05);
    group.add(desk);

    const deskLegGeo = new THREE.BoxGeometry(0.05, 0.65, 0.05);
    const deskLeg = new THREE.Mesh(deskLegGeo, legMat);
    deskLeg.position.set(0.3, 0.325, -0.2);
    group.add(deskLeg);

    return group;
}

export function createTeacherTable() {
    const group = new THREE.Group();
    group.userData.type = 'teacherTable';
    group.userData.isComponent = true;
    group.userData.isWalkObstacle = true;

    const topGeo = new THREE.BoxGeometry(1.5, 0.05, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5c4033 });
    const top = new THREE.Mesh(topGeo, mat);
    top.position.y = 0.75;
    group.add(top);

    const legGeo = new THREE.BoxGeometry(0.05, 0.75, 0.05);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const positions = [
        [-0.7, 0.375, -0.35],
        [0.7, 0.375, -0.35],
        [-0.7, 0.375, 0.35],
        [0.7, 0.375, 0.35]
    ];
    positions.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(...pos);
        group.add(leg);
    });

    return group;
}

export function createTeacherChair() {
    const group = new THREE.Group();
    group.userData.type = 'teacherChair';
    group.userData.isComponent = true;
    group.userData.isWalkObstacle = true;

    const seatGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const seat = new THREE.Mesh(seatGeo, mat);
    seat.position.y = 0.5;
    group.add(seat);

    const backGeo = new THREE.BoxGeometry(0.5, 0.6, 0.1);
    const back = new THREE.Mesh(backGeo, mat);
    back.position.set(0, 0.8, -0.2);
    group.add(back);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.05, 0.5, 0.05);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x222222 }); // Dark legs
    const legPositions = [
        [-0.2, 0.25, -0.2],
        [0.2, 0.25, -0.2],
        [-0.2, 0.25, 0.2],
        [0.2, 0.25, 0.2]
    ];
    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(...pos);
        group.add(leg);
    });

    return group;
}

export function createCabinet() {
    const group = new THREE.Group();
    group.userData.type = 'cabinet';
    group.userData.isComponent = true;
    group.userData.isWalkObstacle = true;

    // Dimensions
    const width = 0.9;
    const height = 1.8;
    const depth = 0.45;

    // Green Metal Material
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x1abc9c, roughness: 0.7, metalness: 0.2 });
    
    // Main Body
    const bodyGeo = new THREE.BoxGeometry(width, height, depth);
    const body = new THREE.Mesh(bodyGeo, metalMat);
    body.position.y = height / 2;
    group.add(body);

    // Frosted Glass Panels (Front)
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.9, metalness: 0.1 });
    const glassWidth = 0.3;
    const glassHeight = 1.55;
    const glassDepth = 0.02;

    // Left Glass
    const glassLeft = new THREE.Mesh(new THREE.BoxGeometry(glassWidth, glassHeight, glassDepth), glassMat);
    glassLeft.position.set(-width / 4, height / 2, depth / 2 + 0.01);
    group.add(glassLeft);

    // Right Glass
    const glassRight = new THREE.Mesh(new THREE.BoxGeometry(glassWidth, glassHeight, glassDepth), glassMat);
    glassRight.position.set(width / 4, height / 2, depth / 2 + 0.01);
    group.add(glassRight);

    // Handles (Silver)
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.2 });
    const handleGeo = new THREE.BoxGeometry(0.02, 0.15, 0.03);

    const handleLeft = new THREE.Mesh(handleGeo, handleMat);
    handleLeft.position.set(-0.05, height / 2, depth / 2 + 0.02);
    group.add(handleLeft);

    const handleRight = new THREE.Mesh(handleGeo, handleMat);
    handleRight.position.set(0.05, height / 2, depth / 2 + 0.02);
    group.add(handleRight);

    // Middle separator line (to make it look like 2 doors)
    const lineGeo = new THREE.BoxGeometry(0.01, height, 0.01);
    const line = new THREE.Mesh(lineGeo, metalMat);
    line.position.set(0, height / 2, depth / 2 + 0.015);
    group.add(line);

    return group;
}

export function createBoard() {
    const group = new THREE.Group();
    group.userData.type = 'board';
    group.userData.isComponent = true;

    const bWidth = 4.0;
    const bHeight = 1.5;

    // Create a canvas texture for the ruled lines
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    // Chalkboard background
    ctx.fillStyle = '#2c3e50';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw horizontal writing lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 3;
    const numLines = 10;
    for (let i = 1; i < numLines; i++) {
        const y = (canvas.height / numLines) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    // Fix color washing out due to linear encoding
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else texture.encoding = 3001; // THREE.sRGBEncoding fallback

    const boardGeo = new THREE.BoxGeometry(bWidth, bHeight, 0.05);
    const boardMat = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, color: 0xffffff }); 
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.y = 1.5;
    
    const frameGeo = new THREE.BoxGeometry(bWidth + 0.1, bHeight + 0.1, 0.02);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = 1.5;
    frame.position.z = -0.02;

    group.add(board);
    group.add(frame);
    return group;
}

export function createTrashBin() {
    const group = new THREE.Group();
    group.userData.type = 'trashbin';
    group.userData.isComponent = true;
    group.userData.isWalkObstacle = true;

    const geo = new THREE.CylinderGeometry(0.2, 0.15, 0.4, 16);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3498db });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.2;
    group.add(mesh);
    return group;
}
