import { TAU } from "../core/math.js";
import { game, isDayMode } from "../core/state.js";
import { MAPS } from "../config/maps.js";
import { getMap3DTheme } from "../config/themes.js";
import { WORLD_W, WORLD_H } from "../entities/track.js";
import { renderRuntime } from "./render-runtime.js";
import {
  THREE_STATE,
  ENABLE_3D_SHADOWS,
  canvas3d,
  hudCanvas,
  hudCtx,
  loadThreeJS,
  dispose3DObject,
} from "./three-state.js";
import { rebuild3DTrack } from "./three-track.js";

export function apply3DMapTheme() {
  if (!window.THREE || !THREE_STATE.scene || !THREE_STATE.renderer) return;
  const T = window.THREE;
  const mapId = MAPS[game.selectedMapIdx || 0].id;
  const day = isDayMode();
  const theme = getMap3DTheme(mapId, day);
  const isArenaDay = day && !!MAPS[game.selectedMapIdx || 0].arena;

  THREE_STATE.renderer.setClearColor(theme.clearColor);
  THREE_STATE.renderer.toneMappingExposure = isArenaDay ? 0.9 : 1.15;
  THREE_STATE.scene.fog = new T.FogExp2(theme.fog[0], theme.fog[1]);

  if (THREE_STATE.starField) THREE_STATE.starField.visible = !day;

  // Daylight lighting tweaks
  if (THREE_STATE.dirLight) {
    if (day) {
      THREE_STATE.dirLight.color.setHex(isArenaDay ? 0xfff4e8 : 0xfff0d0);
      THREE_STATE.dirLight.intensity = isArenaDay ? 1.05 : 1.35;
    } else {
      THREE_STATE.dirLight.color.setHex(0x9999ff);
      THREE_STATE.dirLight.intensity = 0.9;
    }
  }
  THREE_STATE.scene.traverse((child) => {
    if (child.isHemisphereLight) {
      if (day) {
        child.color.setHex(isArenaDay ? 0x8fc7ef : 0xb8d4ff);
        child.groundColor.setHex(isArenaDay ? 0x78a977 : 0x8ab878);
        child.intensity = isArenaDay ? 0.75 : 1.1;
      } else {
        child.color.setHex(0x2a1860);
        child.groundColor.setHex(0x0a2f12);
        child.intensity = 0.8;
      }
    }
    if (child.isAmbientLight) {
      child.intensity = day ? (isArenaDay ? 0.28 : 0.55) : 0.35;
      child.color.setHex(day ? (isArenaDay ? 0xd8e7f0 : 0xf0f4ff) : 0x1a1040);
    }
  });
  if (THREE_STATE.playerLight) THREE_STATE.playerLight.intensity = isArenaDay ? 0.35 : 0.9;
  if (THREE_STATE.backLight) THREE_STATE.backLight.intensity = isArenaDay ? 0.18 : 0.35;
  if (THREE_STATE.rimLight) THREE_STATE.rimLight.intensity = isArenaDay ? 0.18 : 0.3;

  // Update sky dome texture
  THREE_STATE.scene.traverse(child => {
    if (child.geometry && child.geometry.type === "SphereGeometry" &&
        child.material && child.material.side === T.BackSide && child.material.map) {
      const c = document.createElement("canvas");
      c.width = 1; c.height = 256;
      const cx = c.getContext("2d");
      const grad = cx.createLinearGradient(0, 0, 0, 256);
      const stops = theme.sky;
      for (let i = 0; i < stops.length; i++) {
        grad.addColorStop(i / (stops.length - 1), stops[i]);
      }
      cx.fillStyle = grad;
      cx.fillRect(0, 0, 1, 256);
      child.material.map.image = c;
      child.material.map.needsUpdate = true;
      child.material.toneMapped = !(isArenaDay || (day && !MAPS[game.selectedMapIdx || 0].arena));
      child.material.needsUpdate = true;
    }
  });

  // Update ground texture
  if (THREE_STATE.groundMesh && THREE_STATE.groundMesh.material) {
    const gMat = THREE_STATE.groundMesh.material;
    gMat.color.set(theme.ground);
    if (gMat.map) {
      const c = document.createElement("canvas");
      c.width = 512; c.height = 512;
      const cx = c.getContext("2d");
      const gGrad = cx.createRadialGradient(256, 256, 0, 256, 256, 360);
      gGrad.addColorStop(0, theme.groundAccent);
      gGrad.addColorStop(0.5, theme.ground);
      gGrad.addColorStop(1, theme.ground);
      cx.fillStyle = gGrad;
      cx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 2000; i++) {
        const col = new T.Color(theme.groundAccent);
        cx.fillStyle = `rgba(${Math.floor(col.r * 255)}, ${Math.floor(col.g * 255)}, ${Math.floor(col.b * 255)}, ${0.1 + Math.random() * 0.15})`;
        cx.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 3);
      }
      gMat.map.image = c;
      gMat.map.needsUpdate = true;
    }
  }

  // Update grid colors
  THREE_STATE.scene.traverse(child => {
    if (child.isGridHelper) {
      child.material.color.set(theme.gridColor);
      child.material.opacity = 0.18;
    }
  });

  // Build distant scenery per map theme
  build3DScenery(theme);
}

export function build3DScenery(theme) {
  if (!window.THREE || !THREE_STATE.scene) return;
  const T = window.THREE;

  // Remove old scenery
  if (THREE_STATE._sceneryGroup) {
    THREE_STATE.scene.remove(THREE_STATE._sceneryGroup);
    dispose3DObject(THREE_STATE._sceneryGroup);
  }
  const sg = new T.Group();
  THREE_STATE._sceneryGroup = sg;
  THREE_STATE.scene.add(sg);

  // Fixed arena boundary markers replace random generic pillars and keep chase sightlines clear.
  if (game.track?.arenaFloor) return;

  const cx = WORLD_W / 2, cz = WORLD_H / 2;
  const mapRadius = Math.max(WORLD_W, WORLD_H) * 0.7;
  const day = !!theme.isDay;
  const sceneryOpacity = day ? 0.08 : 0.12;
  const sceneryGlowOpacity = day ? 0.14 : 0.25;

  if (theme.scenery === "cyber" || theme.scenery === "dragon") {
    // Distant holographic towers / data pillars
    const towerMat = new T.MeshBasicMaterial({ color: theme.gridColor, transparent: true, opacity: sceneryOpacity });
    const towerGlowMat = new T.MeshBasicMaterial({ color: theme.gridColor, transparent: true, opacity: sceneryGlowOpacity });
    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * TAU + Math.random() * 0.3;
      const r = mapRadius + 200 + Math.random() * 600;
      const h = 200 + Math.random() * 400;
      const w = 15 + Math.random() * 30;
      const tower = new T.Mesh(new T.BoxGeometry(w, h, w), towerMat);
      tower.position.set(cx + Math.cos(ang) * r, h / 2, cz + Math.sin(ang) * r);
      sg.add(tower);
      // Glow cap
      const cap = new T.Mesh(new T.SphereGeometry(w * 0.4, 6, 4), towerGlowMat);
      cap.position.set(cx + Math.cos(ang) * r, h + w * 0.2, cz + Math.sin(ang) * r);
      sg.add(cap);
    }
  }

  if (theme.scenery === "ice") {
    // Icy crystal spires
    const iceMat = new T.MeshBasicMaterial({ color: theme.gridColor, transparent: true, opacity: day ? 0.06 : 0.08 });
    const iceGlowMat = new T.MeshBasicMaterial({ color: theme.gridColor, transparent: true, opacity: day ? 0.12 : 0.2 });
    for (let i = 0; i < 22; i++) {
      const ang = (i / 22) * TAU + Math.random() * 0.3;
      const r = mapRadius + 100 + Math.random() * 800;
      const h = 150 + Math.random() * 350;
      const w = 8 + Math.random() * 20;
      const spire = new T.Mesh(new T.ConeGeometry(w, h, 5), iceMat);
      spire.position.set(cx + Math.cos(ang) * r, h / 2, cz + Math.sin(ang) * r);
      spire.rotation.z = (Math.random() - 0.5) * 0.15;
      sg.add(spire);
      const glow = new T.Mesh(new T.OctahedronGeometry(w * 0.5), iceGlowMat);
      glow.position.set(cx + Math.cos(ang) * r, h, cz + Math.sin(ang) * r);
      sg.add(glow);
    }
  }

  if (theme.scenery === "japanese") {
    // Distant mountain silhouettes
    const mtMat = new T.MeshBasicMaterial({
      color: day ? 0x6a9a7a : 0x1a0808,
      transparent: true,
      opacity: day ? 0.12 : 0.15,
    });
    for (let i = 0; i < 12; i++) {
      const x = WORLD_W * (i / 12) + Math.random() * 2000;
      const h = 300 + Math.random() * 500;
      const w = 400 + Math.random() * 600;
      const mt = new T.Mesh(new T.ConeGeometry(w, h, 4), mtMat);
      mt.position.set(x, h / 2, cz + mapRadius + 200 + Math.random() * 400);
      sg.add(mt);
      const mt2 = mt.clone();
      mt2.position.z = cz - mapRadius - 200 - Math.random() * 400;
      sg.add(mt2);
    }
    // Torii gate silhouettes
    const toriiMat = new T.MeshBasicMaterial({
      color: day ? 0xbb3333 : 0x661111,
      transparent: true,
      opacity: day ? 0.28 : 0.2,
    });
    for (let i = 0; i < 6; i++) {
      const x = WORLD_W * (i / 6) + 1000 + Math.random() * 2000;
      const z = (Math.random() > 0.5 ? 1 : -1) * (mapRadius + 150 + Math.random() * 200) + cz;
      const g = new T.Group();
      // Posts
      for (const s of [-1, 1]) {
        const post = new T.Mesh(new T.CylinderGeometry(5, 6, 120, 6), toriiMat);
        post.position.set(s * 35, 60, 0);
        g.add(post);
      }
      // Top beams
      g.add(new T.Mesh(new T.BoxGeometry(90, 6, 8), toriiMat)).position.y = 115;
      g.add(new T.Mesh(new T.BoxGeometry(80, 4, 6), toriiMat)).position.y = 100;
      g.position.set(x, 0, z);
      g.rotation.y = Math.random() * TAU;
      sg.add(g);
    }
  }
}


export function setViewMode(mode) {
  game.viewMode = mode;
  renderRuntime.saveGameSettings({ viewMode: mode });
  const is3d = mode === "3d";
  renderRuntime.canvas.style.display = is3d ? "none" : "block";
  canvas3d.style.display = is3d ? "block" : "none";
  if (hudCanvas) hudCanvas.style.display = is3d ? "block" : "none";
  if (renderRuntime.view2dBtn) renderRuntime.view2dBtn.classList.toggle("active", !is3d);
  if (renderRuntime.view3dBtn) renderRuntime.view3dBtn.classList.toggle("active", is3d);
  if (is3d) {
    loadThreeJS(() => {
      if (!THREE_STATE.renderer) init3DScene();
      rebuild3DTrack();
    });
  }
}


export function init3DScene() {
  if (!window.THREE || THREE_STATE.renderer) return;
  const T = window.THREE;

  THREE_STATE.renderer = new T.WebGLRenderer({ canvas: canvas3d, antialias: true, alpha: false });
  THREE_STATE.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  THREE_STATE.renderer.setSize(renderRuntime.getViewW(), renderRuntime.getViewH());
  THREE_STATE.renderer.setClearColor(0x060514);
  THREE_STATE.renderer.toneMapping = T.ACESFilmicToneMapping;
  THREE_STATE.renderer.toneMappingExposure = 1.15;
  THREE_STATE.renderer.shadowMap.enabled = ENABLE_3D_SHADOWS;
  THREE_STATE.renderer.shadowMap.type = T.PCFSoftShadowMap;

  THREE_STATE.scene = new T.Scene();
  THREE_STATE.scene.fog = new T.FogExp2(0x060514, 0.0004);

  THREE_STATE.camera = new T.PerspectiveCamera(70, renderRuntime.getViewW() / renderRuntime.getViewH(), 1, 8000);
  THREE_STATE.camera.position.set(0, 120, -200);

  const hemiLight = new T.HemisphereLight(0x2a1860, 0x0a2f12, 0.8);
  THREE_STATE.scene.add(hemiLight);
  const ambient = new T.AmbientLight(0x1a1040, 0.35);
  THREE_STATE.scene.add(ambient);
  const dirLight = new T.DirectionalLight(0x9999ff, 0.9);
  dirLight.position.set(300, 600, -300);
  dirLight.castShadow = ENABLE_3D_SHADOWS;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 10;
  dirLight.shadow.camera.far = 2000;
  dirLight.shadow.camera.left = -600;
  dirLight.shadow.camera.right = 600;
  dirLight.shadow.camera.top = 600;
  dirLight.shadow.camera.bottom = -600;
  dirLight.shadow.bias = -0.002;
  THREE_STATE.scene.add(dirLight);
  THREE_STATE.scene.add(dirLight.target);
  THREE_STATE.dirLight = dirLight;
  const pointLight = new T.PointLight(0x57f2ff, 0.9, 3000);
  pointLight.position.set(0, 200, 0);
  THREE_STATE.scene.add(pointLight);
  THREE_STATE.playerLight = pointLight;
  const backLight = new T.PointLight(0xff4d6d, 0.35, 1800);
  backLight.position.set(0, 100, 0);
  THREE_STATE.scene.add(backLight);
  THREE_STATE.backLight = backLight;
  const rimLight = new T.PointLight(0xfd9927, 0.3, 2000);
  rimLight.position.set(-200, 150, 200);
  THREE_STATE.scene.add(rimLight);
  THREE_STATE.rimLight = rimLight;

  // Ground plane with procedural texture
  const groundGeo = new T.PlaneGeometry(12000, 12000, 64, 64);
  const groundCanvas = document.createElement("canvas");
  groundCanvas.width = 512; groundCanvas.height = 512;
  const gCtx = groundCanvas.getContext("2d");
  const gGrad = gCtx.createRadialGradient(256, 256, 0, 256, 256, 360);
  gGrad.addColorStop(0, "#0e2a12");
  gGrad.addColorStop(0.5, "#0a1f0d");
  gGrad.addColorStop(1, "#061208");
  gCtx.fillStyle = gGrad;
  gCtx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 3000; i++) {
    gCtx.fillStyle = `rgba(${20 + Math.random() * 30}, ${40 + Math.random() * 50}, ${15 + Math.random() * 20}, ${0.15 + Math.random() * 0.2})`;
    const gx = Math.random() * 512, gy = Math.random() * 512;
    gCtx.fillRect(gx, gy, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const groundTex = new T.CanvasTexture(groundCanvas);
  groundTex.wrapS = T.RepeatWrapping; groundTex.wrapT = T.RepeatWrapping;
  groundTex.repeat.set(40, 40);
  const groundMat = new T.MeshStandardMaterial({
    map: groundTex,
    color: 0x0a1f0d,
    roughness: 0.85,
    metalness: 0.15,
  });
  const ground = new T.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  ground.receiveShadow = true;
  THREE_STATE.scene.add(ground);
  THREE_STATE.groundMesh = ground;

  // Grid helper for cyberpunk feel
  const gridSize = 10000;
  const gridDiv = 100;
  const grid = new T.GridHelper(gridSize, gridDiv, 0x7b75ff, 0x1a1040);
  grid.position.y = -0.5;
  grid.material.opacity = 0.22;
  grid.material.transparent = true;
  THREE_STATE.scene.add(grid);

  // Gradient sky dome
  const skyGeo = new T.SphereGeometry(5000, 32, 24);
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 1; skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext("2d");
  const skyGrad = skyCtx.createLinearGradient(0, 0, 0, 256);
  skyGrad.addColorStop(0, "#0a0820");
  skyGrad.addColorStop(0.3, "#0e0630");
  skyGrad.addColorStop(0.55, "#180a40");
  skyGrad.addColorStop(0.75, "#0d1a28");
  skyGrad.addColorStop(1, "#060514");
  skyCtx.fillStyle = skyGrad;
  skyCtx.fillRect(0, 0, 1, 256);
  const skyTex = new T.CanvasTexture(skyCanvas);
  const skyMat = new T.MeshBasicMaterial({ map: skyTex, side: T.BackSide });
  const skyMesh = new T.Mesh(skyGeo, skyMat);
  THREE_STATE.scene.add(skyMesh);
  THREE_STATE.skyMesh = skyMesh;

  // Stars with size variation and color tints
  const starVerts = [];
  const starColors = [];
  const starSizes = [];
  for (let i = 0; i < 2000; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 4500 + Math.random() * 400;
    starVerts.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
    const tint = Math.random();
    if (tint < 0.1) starColors.push(0.7, 0.75, 1.0);
    else if (tint < 0.15) starColors.push(1.0, 0.85, 0.6);
    else if (tint < 0.2) starColors.push(0.9, 0.6, 1.0);
    else starColors.push(0.93, 0.93, 1.0);
    starSizes.push(1.5 + Math.random() * 4);
  }
  const starGeo = new T.BufferGeometry();
  starGeo.setAttribute("position", new T.Float32BufferAttribute(starVerts, 3));
  starGeo.setAttribute("color", new T.Float32BufferAttribute(starColors, 3));
  starGeo.setAttribute("size", new T.Float32BufferAttribute(starSizes, 1));
  const starMat = new T.PointsMaterial({ size: 3.5, sizeAttenuation: false, transparent: true, opacity: 0.8, vertexColors: true });
  const starField = new T.Points(starGeo, starMat);
  THREE_STATE.scene.add(starField);
  THREE_STATE.starField = starField;

  // HUD overlay canvas
  if (hudCanvas) {
    hudCanvas.width = Math.floor(renderRuntime.getViewW() * renderRuntime.getDpr());
    hudCanvas.height = Math.floor(renderRuntime.getViewH() * renderRuntime.getDpr());
    hudCanvas.style.width = renderRuntime.getViewW() + "px";
    hudCanvas.style.height = renderRuntime.getViewH() + "px";
    if (hudCtx) hudCtx.setTransform(renderRuntime.getDpr(), 0, 0, renderRuntime.getDpr(), 0, 0);
  }

  window.addEventListener("resize", () => {
    if (THREE_STATE.renderer) {
      THREE_STATE.renderer.setSize(renderRuntime.getViewW(), renderRuntime.getViewH());
      THREE_STATE.camera.aspect = renderRuntime.getViewW() / renderRuntime.getViewH();
      THREE_STATE.camera.updateProjectionMatrix();
      if (hudCanvas) {
        hudCanvas.width = Math.floor(renderRuntime.getViewW() * renderRuntime.getDpr());
        hudCanvas.height = Math.floor(renderRuntime.getViewH() * renderRuntime.getDpr());
        hudCanvas.style.width = renderRuntime.getViewW() + "px";
        hudCanvas.style.height = renderRuntime.getViewH() + "px";
        if (hudCtx) hudCtx.setTransform(renderRuntime.getDpr(), 0, 0, renderRuntime.getDpr(), 0, 0);
      }
    }
  });
}
