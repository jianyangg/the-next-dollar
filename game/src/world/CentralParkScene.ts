import * as THREE from 'three';
import { playStep } from '../audio/soundEngine';
import { PostFx } from './postfx';
import { type FxQuality, resolveFxQuality } from './postfxQuality';
import type { Random } from '../core/rng';
import { NeighborhoodId, getNeighborhood } from '../core/neighborhoods';
import {
  DistrictPedestrianKind,
  FounderSpecies,
  createAsphaltTexture,
  createBrownstoneFacadeTexture,
  createCampusBrickFacadeTexture,
  createCobblestoneTexture,
  createDistrictPedestrianTexture,
  createGlassTowerFacadeTexture,
  createGrassTexture,
  createIronFenceTexture,
  createKnockedOutSpriteTexture,
  createLemonCrateTexture,
  createLemonadeStandFrontTexture,
  createLimestoneLuxuryFacadeTexture,
  createMascotSpriteTexture,
  createParkBenchTexture,
  createParkPathTexture,
  createPitcherTexture,
  createSidewalkTexture,
  createSoulSpriteTexture,
  createStoneWallTexture,
  createTheaterMarqueeFacadeTexture,
  createTreeSpriteTexture,
} from './pixelArt';

export type NearbyTarget =
  | 'own-stand'
  | 'seller-stand'
  | 'market-stalls'
  | 'market-lemons'
  | 'market-pitchers'
  | 'plot-lease'
  | null;

export type PlotStatus = 'empty' | 'leased' | 'built';

export interface QueuedCustomerAnchor {
  id: number;
  x: number;
  y: number;
  patienceRatio: number;
  isFront: boolean;
}

export interface ProjectedAnchors {
  ownStand: { x: number; y: number };
  sellerStand: { x: number; y: number };
  player: { x: number; y: number };
  nearby: NearbyTarget;
  queue: QueuedCustomerAnchor[];
  marketAnchors: {
    stalls: { x: number; y: number };
    pitchers: { x: number; y: number };
    lemons: { x: number; y: number };
  };
}

interface Pedestrian {
  id: number;
  sprite: THREE.Sprite;
  shadow: THREE.Mesh;
  soulSprite: THREE.Sprite;
  frames: Record<'down' | 'up' | 'left' | 'right', [THREE.CanvasTexture, THREE.CanvasTexture, THREE.CanvasTexture]>;
  x: number;
  z: number;
  homeZ: number;
  vx: number;
  speed: number;
  animTimer: number;
  canBuy: boolean;
  boughtCooldown: number;
  state: 'strolling' | 'walking-to-slot' | 'queued' | 'leaving';
  queueSlot: number;
  patience: number;
  maxPatience: number;
  careful: boolean;
  koTimer: number;
}

interface SaleSparkle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

interface TrafficVehicle {
  group: THREE.Group;
  axis: 'x' | 'z';
  dir: 1 | -1;
  speed: number;
  minBound: number;
  maxBound: number;
  halfX: number;
  halfZ: number;
}

interface StandStyleOptions {
  accentHex: string;
  secondaryHex: string;
  label: string;
  signTopText: string;
  signSubText: string;
  includePitchers: boolean;
  isSeller?: boolean;
  marketKind?: 'stalls' | 'lemons' | 'pitchers';
  parentGroup: THREE.Group;
}

/** The two seeded random streams the scene needs (see src/core/rng.ts). */
export interface SceneRandom {
  gameplay: Random;
  cosmetic: Random;
}

export interface SceneCallbacks {
  onCustomerPurchase: () => void;
  onCustomerWalkout?: () => void;
  onTaxiHit?: () => void;
  onAnchorsUpdate: (anchors: ProjectedAnchors) => void;
  onInteract: (target: NearbyTarget) => void;
}

const OWN_STAND_POS = new THREE.Vector3(5.6, 0, -1.6);
const SELLER_STAND_POS = new THREE.Vector3(-5.8, 0, -1.6);

const MARKET_STALLS_POS = new THREE.Vector3(-4.3, 0, -1.3);
const MARKET_PITCHERS_POS = new THREE.Vector3(0.0, 0, -1.3);
const MARKET_LEMONS_POS = new THREE.Vector3(4.3, 0, -1.3);

const QUEUE_MAX_PATIENCE = 16;
const QUEUE_SLOTS: Array<{ x: number; z: number }> = [
  { x: OWN_STAND_POS.x, z: OWN_STAND_POS.z + 1.05 },
  { x: OWN_STAND_POS.x + 0.88, z: OWN_STAND_POS.z + 1.35 },
  { x: OWN_STAND_POS.x + 1.76, z: OWN_STAND_POS.z + 1.62 },
  { x: OWN_STAND_POS.x + 2.64, z: OWN_STAND_POS.z + 1.85 },
];

// 32x40 Growtopia-style human chibi characters (0.80 aspect ratio)
const PLAYER_SPRITE_H = 1.44;
const PLAYER_SPRITE_W = PLAYER_SPRITE_H * 0.8;
// 36x40 district pedestrian sprites (0.90 aspect ratio so puppy/bags stay crisp)
const PED_SPRITE_H = 1.38;
const PED_SPRITE_W = PED_SPRITE_H * 0.9;
const BEHIND_COUNTER_LIFT = 0.28;

const DISTRICT_PEDESTRIANS: Record<NeighborhoodId, DistrictPedestrianKind[]> = {
  'central-park': ['park-dog-walker', 'park-jogger'],
  columbia: ['columbia-student'],
  fidi: ['fidi-suit'],
  broadway: ['broadway-theater', 'fidi-suit'],
  'fifth-ave': ['fifth-shopper', 'fidi-suit'],
  'west-village': ['village-artist', 'park-dog-walker', 'columbia-student'],
  market: ['village-artist', 'park-dog-walker', 'columbia-student'],
};

/**
 * A light-source material whose colour is multiplied above 1.0 (HDR) so the
 * bloom pass picks it up. `base` is the authored 0..1 colour; the displayed
 * colour is base * lerp(dayGain, nightGain, nightAmount).
 */
interface GlowEntry {
  mat: THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
  base: THREE.Color;
  dayGain: number;
  nightGain: number;
}

/** Streetlamp intensity at dusk (the largest `lampIntensity` keyframe); used to normalise to 0..1. */
const MAX_LAMP_INTENSITY = 1.55;

const ROAD_NEIGHBORHOODS = new Set<NeighborhoodId>(['central-park', 'broadway', 'fidi', 'fifth-ave']);

export class CentralParkScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private callbacks: SceneCallbacks;

  private hemiLight!: THREE.HemisphereLight;
  private sunLight!: THREE.DirectionalLight;
  private timeOfDayProgress = 0;
  private streetlampBulbMat = new THREE.MeshBasicMaterial({ color: '#fff3c4' });
  private fxQuality: FxQuality;
  private postfx: PostFx;
  /** Light-source materials that get an HDR colour boost so only they bloom. */
  private glowEntries: GlowEntry[] = [];
  /** 0 (day) .. 1 (dusk): current lamp intensity / 1.55. Drives glow gain and bloom. */
  private nightAmount = 0;
  private resizeObserver: ResizeObserver | null = null;
  private lastResize = { w: 0, h: 0, dpr: 0 };
  private streetlampLights: THREE.PointLight[] = [];

  private playerPos = new THREE.Vector3(3.6, 0, 0.8);
  private playerTarget: THREE.Vector3 | null = null;
  private playerFacing: 'down' | 'up' | 'left' | 'right' = 'down';
  private playerSpecies: FounderSpecies = 'squirrel';
  private workingAtStand = false;
  private currentNeighborhood: NeighborhoodId = 'central-park';
  private plotStatus: PlotStatus = 'empty';
  private playerSprite!: THREE.Sprite;
  private playerShadow!: THREE.Mesh;
  private playerFrames!: Record<'down' | 'up' | 'left' | 'right', THREE.CanvasTexture[]>;
  private playerKoTex!: THREE.CanvasTexture;
  private soulSprite!: THREE.Sprite;
  private koTimer = 0;
  private invulnTimer = 0;
  private playerAnimTimer = 0;
  private stepSoundCooldown = 0;

  private neighborhoodGroups = new Map<NeighborhoodId, THREE.Group>();
  private businessStandsGroup = new THREE.Group();
  private ownStandGroup = new THREE.Group();
  private emptyPlotGroup = new THREE.Group();
  private leasedPlotGroup = new THREE.Group();
  private marketStandsGroup = new THREE.Group();
  private streetSignAMat!: THREE.MeshStandardMaterial;
  private streetSignBMat!: THREE.MeshStandardMaterial;

  private keys = new Set<string>();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private pedSpriteBank!: Record<
    DistrictPedestrianKind,
    Record<'down' | 'up' | 'left' | 'right', [THREE.CanvasTexture, THREE.CanvasTexture, THREE.CanvasTexture]>
  >;
  private pedKoTex!: THREE.CanvasTexture;
  private pedestrians: Pedestrian[] = [];
  private queue: Pedestrian[] = [];
  private queueJoinCooldown = 1.2;
  private sparkles: SaleSparkle[] = [];
  private sparkleGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  private taxiGroup!: THREE.Group;
  private vehicles: TrafficVehicle[] = [];
  private pitcherSprites: THREE.Sprite[] = [];
  private standOpen = true;
  private rafId = 0;
  private clock = new THREE.Clock();
  private elapsedTime = 0;
  private disposed = false;

  private contactShadowMat!: THREE.MeshBasicMaterial;
  private summerTreeTex!: THREE.CanvasTexture;
  private autumnTreeTex!: THREE.CanvasTexture;

  // Seeded random streams are injected (not imported as globals) so the scene
  // stays testable. `gameplay` draws change game outcomes (customer flow);
  // `cosmetic` draws are visuals only, kept separate so they can never shift
  // the order of gameplay draws.
  private readonly rng: SceneRandom;

  constructor(
    container: HTMLElement,
    callbacks: SceneCallbacks,
    rng: SceneRandom,
    options: { fx?: FxQuality } = {}
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.rng = rng;

    // Post-processing tier. Tests/callers may force one; otherwise `?fx=` and
    // device heuristics decide. resolveFxQuality throws on an invalid `?fx=`.
    this.fxQuality =
      options.fx ??
      resolveFxQuality(window.location.search, {
        devicePixelRatio: window.devicePixelRatio,
        isCoarsePointer:
          typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches,
      });

    // `antialias` is fixed at context creation. The composer path renders into
    // offscreen buffers (the canvas MSAA would never apply) and uses SMAA, so
    // only the untouched 'off' path asks the browser for hardware MSAA.
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.fxQuality === 'off',
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // With post-processing, tone mapping happens at the END of the effect chain
    // (so bloom sees un-squashed HDR values); the renderer must not also do it.
    this.renderer.toneMapping = this.fxQuality === 'off' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    // Still read by the chain's ToneMappingEffect shader, so brightness matches.
    this.renderer.toneMappingExposure = 1.06;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#c7def2');
    this.scene.fog = new THREE.FogExp2('#d7e5f2', 0.013);

    // Straight-on 3/4 JRPG HD-2D camera
    this.camera = new THREE.PerspectiveCamera(
      32,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.5,
      120
    );
    this.camera.position.set(this.playerPos.x * 0.78, 10.9, this.playerPos.z + 14.3);
    this.camera.lookAt(this.playerPos.x * 0.78, 0.55, this.playerPos.z - 0.8);

    this.postfx = new PostFx(this.renderer, this.scene, this.camera, this.fxQuality);
    this.postfx.setSize(container.clientWidth, Math.max(container.clientHeight, 1));
    // Streetlamp bulbs: no extra glow by day (stay under the bloom threshold),
    // ~3x HDR at dusk so the lamps visibly bloom. Colour is refreshed per
    // keyframe in applyAtmosphere.
    this.registerGlow(this.streetlampBulbMat, 1.0, 3.2);

    this.contactShadowMat = new THREE.MeshBasicMaterial({
      map: this.createContactShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
    });
    this.summerTreeTex = createTreeSpriteTexture('summer');
    this.autumnTreeTex = createTreeSpriteTexture('autumn');

    this.setupLighting();
    this.buildSharedCornerSign();
    this.buildAllNeighborhoods();

    this.scene.add(this.businessStandsGroup);
    this.businessStandsGroup.add(this.ownStandGroup);
    this.businessStandsGroup.add(this.emptyPlotGroup);
    this.businessStandsGroup.add(this.leasedPlotGroup);
    this.marketStandsGroup.visible = false;
    this.scene.add(this.marketStandsGroup);

    this.buildPlotMarkings();
    this.buildOwnStand();
    this.buildSellerStand();
    this.buildMarketStands();
    this.buildTaxi();
    this.buildPlayer();
    this.buildPedestrians();

    this.setPlotState('empty');
    this.setNeighborhood('central-park');

    // ResizeObserver catches container-only changes (HUD layout, split panes)
    // that never fire a window 'resize'; the window listener still catches
    // devicePixelRatio changes (browser zoom, dragging between monitors).
    window.addEventListener('resize', this.handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleResize);
      this.resizeObserver.observe(container);
    }
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);

    this.clock.start();
    this.animate();
  }

  public setPitcherCount(count: number): void {
    const visible = Math.max(1, Math.min(3, count));
    this.pitcherSprites.forEach((sp, i) => {
      sp.visible = i < visible;
    });
  }

  public setStandOpen(open: boolean): void {
    this.standOpen = open;
  }

  public setPlotState(status: PlotStatus): void {
    this.plotStatus = status;
    this.emptyPlotGroup.visible = status === 'empty';
    this.leasedPlotGroup.visible = status === 'leased';
    this.ownStandGroup.visible = status === 'built';

    if (status !== 'built') {
      if (this.workingAtStand) {
        this.setWorkingAtStand(false);
      }
      this.clearQueuePeacefully();
    }
  }

  public burstSaleSparkles(combo = 1): void {
    const count = Math.min(18, 6 + Math.max(1, combo) * 2);
    const palette = ['#ffd740', '#fff176', '#ffb74d', '#ffffff'];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: palette[i % palette.length],
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(this.sparkleGeo, mat);
      const angle = (i / count) * Math.PI * 2 + (this.rng.cosmetic() - 0.5) * 0.45;
      const spread = 1.1 + this.rng.cosmetic() * 1.4;
      mesh.position.set(
        OWN_STAND_POS.x + (this.rng.cosmetic() - 0.5) * 0.7,
        1.2 + this.rng.cosmetic() * 0.35,
        OWN_STAND_POS.z + (this.rng.cosmetic() - 0.5) * 0.4
      );
      this.scene.add(mesh);

      this.sparkles.push({
        mesh,
        vx: Math.cos(angle) * spread,
        vy: 2.8 + this.rng.cosmetic() * 2.1,
        vz: Math.sin(angle) * spread * 0.65,
        life: 0.65,
        maxLife: 0.65,
      });
    }
  }

  public serveFrontCustomer(): { patienceRatio: number } | null {
    if (this.queue.length === 0) return null;
    const front = this.queue.shift()!;
    const patienceRatio = THREE.MathUtils.clamp(front.patience / front.maxPatience, 0, 1);

    front.state = 'leaving';
    front.queueSlot = -1;
    front.boughtCooldown = 8 + this.rng.gameplay() * 4;
    front.vx = (this.rng.gameplay() > 0.5 ? 1 : -1) * front.speed;

    this.shuffleQueueForward();
    return { patienceRatio };
  }

  private shuffleQueueForward(): void {
    this.queue.forEach((ped, idx) => {
      ped.queueSlot = idx;
      ped.state = 'walking-to-slot';
    });
  }

  private clearQueuePeacefully(): void {
    for (const ped of this.queue) {
      ped.state = 'leaving';
      ped.queueSlot = -1;
      ped.boughtCooldown = 2 + this.rng.gameplay() * 2;
    }
    this.queue = [];
  }

  public setWorkingAtStand(working: boolean): void {
    this.workingAtStand = working;
    this.playerTarget = null;
    this.keys.clear();

    if (working) {
      // Positioned directly behind the open-top counter so full face & body are 100% visible
      this.playerPos.set(OWN_STAND_POS.x, 0, OWN_STAND_POS.z - 0.62);
      this.playerFacing = 'down';
    } else {
      this.playerPos.set(OWN_STAND_POS.x, 0, OWN_STAND_POS.z + 1.12);
      this.playerFacing = 'down';
    }

    if (this.playerSprite) {
      const mat = this.playerSprite.material as THREE.SpriteMaterial;
      mat.map = this.playerFrames[this.playerFacing][0];
      mat.needsUpdate = true;
      const lift = working ? BEHIND_COUNTER_LIFT : 0;
      this.playerSprite.position.set(this.playerPos.x, PLAYER_SPRITE_H * 0.48 + lift, this.playerPos.z);
    }
    if (this.playerShadow) {
      this.playerShadow.scale.set(1, 1, 1);
      const shadowY = working ? 0.25 : 0.022;
      this.playerShadow.position.set(this.playerPos.x, shadowY, this.playerPos.z + 0.04);
    }
  }

  public setNeighborhood(id: NeighborhoodId): void {
    this.currentNeighborhood = id;
    const isMarket = id === 'market';

    // Toggle distinct 3D neighborhood geometry groups
    for (const [nid, grp] of this.neighborhoodGroups.entries()) {
      grp.visible = nid === id;
    }

    this.businessStandsGroup.visible = !isMarket;
    this.marketStandsGroup.visible = isMarket;
    if (this.taxiGroup) {
      this.taxiGroup.visible = ROAD_NEIGHBORHOODS.has(id);
    }
    if (isMarket && this.workingAtStand) {
      this.setWorkingAtStand(false);
    }
    if (isMarket) {
      this.clearQueuePeacefully();
    }

    const cfg = getNeighborhood(id);
    this.applyAtmosphere();

    // Refresh active pedestrians to match the new neighborhood's local crowd
    this.refreshPedestriansForNeighborhood(id);

    // Update green NYC corner street signs
    if (this.streetSignAMat) {
      if (this.streetSignAMat.map) this.streetSignAMat.map.dispose();
      this.streetSignAMat.map = this.createStreetSignTexture(cfg.streetSignA);
      this.streetSignAMat.needsUpdate = true;
    }
    if (this.streetSignBMat) {
      if (this.streetSignBMat.map) this.streetSignBMat.map.dispose();
      this.streetSignBMat.map = this.createStreetSignTexture(cfg.streetSignB);
      this.streetSignBMat.needsUpdate = true;
    }
  }

  public setTimeOfDay(progress: number): void {
    this.timeOfDayProgress = THREE.MathUtils.clamp(progress, 0, 1);
    this.applyAtmosphere();
  }

  private applyAtmosphere(): void {
    const cfg = getNeighborhood(this.currentNeighborhood);
    const { theme } = cfg;
    const p = this.timeOfDayProgress;

    const baseSky = new THREE.Color(theme.skyHex);
    const baseFog = new THREE.Color(theme.fogHex);

    const sunriseSky = new THREE.Color('#f3c9a4').lerp(baseSky, 0.42);
    const sunriseFog = new THREE.Color('#f5d8bc').lerp(baseFog, 0.42);
    const sunsetSky = new THREE.Color('#e88b5a').lerp(baseSky, 0.22);
    const sunsetFog = new THREE.Color('#e49b72').lerp(baseFog, 0.22);
    const duskSky = new THREE.Color('#23304c');
    const duskFog = new THREE.Color('#2b3958');

    interface TimeKeyframe {
      t: number;
      sky: THREE.Color;
      fog: THREE.Color;
      sunPos: THREE.Vector3;
      sunColor: THREE.Color;
      sunIntensity: number;
      hemiSky: THREE.Color;
      hemiGround: THREE.Color;
      hemiIntensity: number;
      lampIntensity: number;
      bulbColor: THREE.Color;
    }

    const isBroadway = this.currentNeighborhood === 'broadway';
    const keyframes: TimeKeyframe[] = [
      {
        t: 0.0,
        sky: sunriseSky,
        fog: sunriseFog,
        sunPos: new THREE.Vector3(18, 12.5, 10),
        sunColor: new THREE.Color('#ffd194'),
        sunIntensity: 1.42,
        hemiSky: new THREE.Color('#ffe8c8'),
        hemiGround: new THREE.Color('#636958'),
        hemiIntensity: 0.84,
        lampIntensity: 0.2,
        bulbColor: new THREE.Color('#fff0b8'),
      },
      {
        t: 0.4,
        sky: baseSky,
        fog: baseFog,
        sunPos: new THREE.Vector3(14, 23, 12),
        sunColor: new THREE.Color(isBroadway ? '#ffb86c' : '#ffe2ae'),
        sunIntensity: isBroadway ? 1.1 : 1.72,
        hemiSky: new THREE.Color(isBroadway ? '#b9c6ff' : '#fff6e0'),
        hemiGround: new THREE.Color('#5b6c54'),
        hemiIntensity: isBroadway ? 0.64 : 0.92,
        lampIntensity: isBroadway ? 0.75 : 0.0,
        bulbColor: new THREE.Color('#f7eed2'),
      },
      {
        t: 0.78,
        sky: sunsetSky,
        fog: sunsetFog,
        sunPos: new THREE.Vector3(-16, 11, 10),
        sunColor: new THREE.Color('#ffb36b'),
        sunIntensity: 1.35,
        hemiSky: new THREE.Color('#ffc996'),
        hemiGround: new THREE.Color('#544648'),
        hemiIntensity: 0.75,
        lampIntensity: 0.95,
        bulbColor: new THREE.Color('#ffe28a'),
      },
      {
        t: 1.0,
        sky: duskSky,
        fog: duskFog,
        sunPos: new THREE.Vector3(-14, 14, 9),
        sunColor: new THREE.Color('#8eb4ff'),
        sunIntensity: 0.62,
        hemiSky: new THREE.Color('#7892c9'),
        hemiGround: new THREE.Color('#2b3042'),
        hemiIntensity: 0.54,
        lampIntensity: 1.55,
        bulbColor: new THREE.Color('#ffd86b'),
      },
    ];

    let k0 = keyframes[0];
    let k1 = keyframes[keyframes.length - 1];
    for (let i = 0; i < keyframes.length - 1; i++) {
      if (p >= keyframes[i].t && p <= keyframes[i + 1].t) {
        k0 = keyframes[i];
        k1 = keyframes[i + 1];
        break;
      }
    }

    const span = Math.max(0.0001, k1.t - k0.t);
    const rawAlpha = THREE.MathUtils.clamp((p - k0.t) / span, 0, 1);
    const alpha = rawAlpha * rawAlpha * (3 - 2 * rawAlpha);

    const skyCol = k0.sky.clone().lerp(k1.sky, alpha);
    const fogCol = k0.fog.clone().lerp(k1.fog, alpha);
    this.scene.background = skyCol;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(fogCol);
      this.scene.fog.density = isBroadway ? 0.015 : 0.0125;
    }

    this.sunLight.position.lerpVectors(k0.sunPos, k1.sunPos, alpha);
    this.sunLight.color.copy(k0.sunColor).lerp(k1.sunColor, alpha);
    this.sunLight.intensity = THREE.MathUtils.lerp(k0.sunIntensity, k1.sunIntensity, alpha);

    this.hemiLight.color.copy(k0.hemiSky).lerp(k1.hemiSky, alpha);
    this.hemiLight.groundColor.copy(k0.hemiGround).lerp(k1.hemiGround, alpha);
    this.hemiLight.intensity = THREE.MathUtils.lerp(k0.hemiIntensity, k1.hemiIntensity, alpha);

    this.streetlampBulbMat.color.copy(k0.bulbColor).lerp(k1.bulbColor, alpha);
    const lampInt = THREE.MathUtils.lerp(k0.lampIntensity, k1.lampIntensity, alpha);
    for (const light of this.streetlampLights) {
      light.intensity = lampInt;
    }

    // Night amount (0 noon .. 1 dusk) drives bloom strength, vignette and the
    // HDR gain of every glow material. Normalised by the dusk lamp intensity.
    this.nightAmount = THREE.MathUtils.clamp(lampInt / MAX_LAMP_INTENSITY, 0, 1);
    if (this.fxQuality !== 'off') {
      // The streetlamp bulb colour is rewritten per keyframe above, so its
      // authored base colour must be refreshed before the gain is applied.
      const lamp = this.glowEntries.find((g) => g.mat === this.streetlampBulbMat);
      if (lamp) lamp.base.copy(this.streetlampBulbMat.color);
      for (const entry of this.glowEntries) this.applyGlowGain(entry);
    }
    this.postfx.setNightAmount(this.nightAmount);
  }

  /**
   * Make a material a bloom light source.
   *
   * Bloom keys off linear luminance BEFORE tone mapping, with a threshold just
   * under 1.0 (see postfx.ts). Ordinary unlit colours are authored in 0..1 so
   * they can never pass it; multiplying a light's colour by a gain > 1 pushes
   * only that material over. `toneMapped = false` is belt-and-braces: with the
   * composer the renderer applies no tone mapping anyway, but it keeps the glow
   * intact if someone re-enables renderer tone mapping.
   *
   * Gains: for MeshBasicMaterial the colour is multiplied by the gain; for
   * MeshStandardMaterial the gain IS the final emissiveIntensity (the emissive
   * colour stays as authored). Day/night gains are blended by nightAmount.
   *
   * Deliberately NOT applied to crosswalk stripes (#ece7dc), yellow road lines
   * (#f2c144) or plot dash markings. Those are also MeshBasicMaterial but are
   * never boosted, so their colour channels stay <= 1.0 and their luminance
   * (a weighted average of the channels, so never above the largest channel)
   * is ~0.80 for the stripes and ~0.60 for the yellow lines: below the 0.95
   * bloom threshold, so they cannot glow. This holds because bloom measures the
   * pre-tone-mapping linear value, which for an unlit basic material is just
   * its authored colour.
   *
   * With ?fx=off nothing is registered, so those materials render exactly as before.
   */
  private registerGlow<T extends THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>(
    mat: T,
    dayGain: number,
    nightGain: number
  ): T {
    if (this.fxQuality === 'off') return mat;
    mat.toneMapped = false;
    const entry: GlowEntry = {
      mat,
      base: mat.color.clone(),
      dayGain,
      nightGain,
    };
    this.glowEntries.push(entry);
    this.applyGlowGain(entry);
    return mat;
  }

  /** Standard materials glow via emissiveIntensity (base intensity * gain); basic ones via colour. */
  private applyGlowGain(e: GlowEntry): void {
    const gain = THREE.MathUtils.lerp(e.dayGain, e.nightGain, this.nightAmount);
    if (e.mat instanceof THREE.MeshStandardMaterial) {
      e.mat.emissiveIntensity = gain;
    } else {
      e.mat.color.copy(e.base).multiplyScalar(gain);
    }
  }

  public setPlayerSpecies(species: FounderSpecies): void {
    if (this.playerSpecies === species && this.playerFrames) return;
    this.playerSpecies = species;

    if (this.playerFrames) {
      for (const dir of ['down', 'up', 'left', 'right'] as const) {
        for (const tex of this.playerFrames[dir]) {
          tex.dispose();
        }
      }
    }
    if (this.playerKoTex) {
      this.playerKoTex.dispose();
    }

    this.playerFrames = this.buildPlayerFrames(species);
    this.playerKoTex = createKnockedOutSpriteTexture(species);
    if (this.playerSprite) {
      const mat = this.playerSprite.material as THREE.SpriteMaterial;
      mat.map = this.koTimer > 0 ? this.playerKoTex : this.playerFrames[this.playerFacing][0];
      mat.needsUpdate = true;
    }
  }

  private buildPlayerFrames(
    species: FounderSpecies
  ): Record<'down' | 'up' | 'left' | 'right', THREE.CanvasTexture[]> {
    return {
      down: [
        createMascotSpriteTexture(species, 0, 'down', 'apron'),
        createMascotSpriteTexture(species, 1, 'down', 'apron'),
        createMascotSpriteTexture(species, 2, 'down', 'apron'),
      ],
      up: [
        createMascotSpriteTexture(species, 0, 'up', 'apron'),
        createMascotSpriteTexture(species, 1, 'up', 'apron'),
        createMascotSpriteTexture(species, 2, 'up', 'apron'),
      ],
      left: [
        createMascotSpriteTexture(species, 0, 'left', 'apron'),
        createMascotSpriteTexture(species, 1, 'left', 'apron'),
        createMascotSpriteTexture(species, 2, 'left', 'apron'),
      ],
      right: [
        createMascotSpriteTexture(species, 0, 'right', 'apron'),
        createMascotSpriteTexture(species, 1, 'right', 'apron'),
        createMascotSpriteTexture(species, 2, 'right', 'apron'),
      ],
    };
  }

  private createContactShadowTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(16, 16, 3, 16, 16, 15);
    grad.addColorStop(0, 'rgba(18, 22, 30, 0.78)');
    grad.addColorStop(0.55, 'rgba(18, 22, 30, 0.44)');
    grad.addColorStop(1, 'rgba(18, 22, 30, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createContactShadowMesh(radiusX = 0.42, radiusZ = 0.28): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radiusX * 2, radiusZ * 2), this.contactShadowMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.022;
    mesh.renderOrder = 1;
    return mesh;
  }

  private createStreetSignTexture(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 36;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#155e33';
    ctx.fillRect(0, 0, 160, 36);
    ctx.strokeStyle = '#f2f5ef';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, 154, 30);

    ctx.fillStyle = '#f8faf6';
    ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 80, 19);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private createStandPlaqueTexture(
    topText: string,
    subText: string,
    borderHex: string,
    bgHex = '#faf3df'
  ): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 112;
    canvas.height = 56;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#4a2e1b';
    ctx.fillRect(0, 0, 112, 56);
    ctx.fillStyle = bgHex;
    ctx.fillRect(4, 4, 104, 48);
    ctx.strokeStyle = borderHex;
    ctx.lineWidth = 3;
    ctx.strokeRect(7, 7, 98, 42);

    ctx.fillStyle = '#1f232c';
    ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(topText, 56, 23);

    ctx.fillStyle = borderHex;
    ctx.font = 'bold 9px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(subText, 56, 39);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private setupLighting(): void {
    this.hemiLight = new THREE.HemisphereLight('#fff6e0', '#5b6c54', 0.92);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#ffe2ae', 1.72);
    this.sunLight.position.set(14, 23, 12);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -22;
    this.sunLight.shadow.camera.right = 22;
    this.sunLight.shadow.camera.top = 18;
    this.sunLight.shadow.camera.bottom = -18;
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 60;
    this.sunLight.shadow.bias = -0.0007;
    this.scene.add(this.sunLight);

    const fill = new THREE.DirectionalLight('#9dc8ff', 0.36);
    fill.position.set(-12, 9, -8);
    this.scene.add(fill);
  }

  private buildSharedCornerSign(): void {
    const group = new THREE.Group();
    group.position.set(3.45, 0, 1.75);

    const poleMat = new THREE.MeshStandardMaterial({ color: '#7e8791', roughness: 0.45, metalness: 0.65 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.048, 2.75, 8), poleMat);
    pole.position.y = 1.375;
    pole.castShadow = true;
    group.add(pole);

    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), poleMat);
    finial.position.y = 2.78;
    group.add(finial);

    const edgeMat = new THREE.MeshStandardMaterial({ color: '#14532d', roughness: 0.5 });

    const cpwTex = this.createStreetSignTexture('CENTRAL PARK W');
    this.streetSignAMat = new THREE.MeshStandardMaterial({ map: cpwTex, roughness: 0.4 });
    const cpwBlade = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.24, 0.035), [
      edgeMat,
      edgeMat,
      edgeMat,
      edgeMat,
      this.streetSignAMat,
      this.streetSignAMat,
    ]);
    cpwBlade.position.set(0.38, 2.55, 0);
    cpwBlade.castShadow = true;
    group.add(cpwBlade);

    const stTex = this.createStreetSignTexture('W 72 ST');
    this.streetSignBMat = new THREE.MeshStandardMaterial({ map: stTex, roughness: 0.4 });
    const stBlade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.9), [
      this.streetSignBMat,
      this.streetSignBMat,
      edgeMat,
      edgeMat,
      edgeMat,
      edgeMat,
    ]);
    stBlade.position.set(0, 2.32, 0.25);
    stBlade.castShadow = true;
    group.add(stBlade);

    this.scene.add(group);
  }

  private addAvenueAndCrosswalks(target: THREE.Group, sidewalkTint?: string): void {
    const sidewalkMat = new THREE.MeshStandardMaterial({
      map: createSidewalkTexture(18, 15),
      color: sidewalkTint ?? '#ffffff',
      roughness: 0.92,
    });
    // Extended south across z = 7..10 so players can walk across the horizontal zebra crossing to all 4 corners
    const sidewalk = new THREE.Mesh(new THREE.BoxGeometry(34, 0.2, 30), sidewalkMat);
    sidewalk.position.set(0, -0.1, 0.5);
    sidewalk.receiveShadow = true;
    target.add(sidewalk);

    const avenueMat = new THREE.MeshStandardMaterial({
      map: createAsphaltTexture(3, 16),
      roughness: 0.95,
    });
    const avenue = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.14, 30), avenueMat);
    avenue.position.set(0, -0.04, 0.5);
    avenue.receiveShadow = true;
    target.add(avenue);

    const crossStreet = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.14, 4.6),
      new THREE.MeshStandardMaterial({ map: createAsphaltTexture(18, 3), roughness: 0.95 })
    );
    crossStreet.position.set(0, -0.04, 5.2);
    crossStreet.receiveShadow = true;
    target.add(crossStreet);

    const yellowMat = new THREE.MeshBasicMaterial({ color: '#f2c144' });
    for (const dx of [-0.14, 0.14]) {
      const lineNorth = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 14.5), yellowMat);
      lineNorth.rotation.x = -Math.PI / 2;
      lineNorth.position.set(dx, 0.04, -7.8);
      target.add(lineNorth);

      const lineSouth = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 7.5), yellowMat);
      lineSouth.rotation.x = -Math.PI / 2;
      lineSouth.position.set(dx, 0.04, 11.4);
      target.add(lineSouth);
    }

    // Horizontal double yellow centerlines on East-West cross-street
    for (const dz of [-0.14, 0.14]) {
      for (const sx of [-10.6, 10.6]) {
        const lineEW = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 0.11), yellowMat);
        lineEW.rotation.x = -Math.PI / 2;
        lineEW.position.set(sx, 0.04, 5.2 + dz);
        target.add(lineEW);
      }
    }

    const stripeMat = new THREE.MeshBasicMaterial({ color: '#ece7dc' });
    // North zebra crossing
    for (let x = -2.0; x <= 2.01; x += 0.8) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 2.0), stripeMat);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(x, 0.045, 1.3);
      target.add(stripe);

      const stripeSouth = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 1.8), stripeMat);
      stripeSouth.rotation.x = -Math.PI / 2;
      stripeSouth.position.set(x, 0.045, 8.6);
      target.add(stripeSouth);
    }
    // West & East zebra crossings across the horizontal cross-street
    for (let z = 3.6; z <= 6.81; z += 0.8) {
      const sWest = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.42), stripeMat);
      sWest.rotation.x = -Math.PI / 2;
      sWest.position.set(-4.2, 0.045, z);
      target.add(sWest);

      const sEast = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.42), stripeMat);
      sEast.rotation.x = -Math.PI / 2;
      sEast.position.set(4.2, 0.045, z);
      target.add(sEast);
    }

    const curbMat = new THREE.MeshStandardMaterial({ color: '#b5ac9b', roughness: 0.9 });
    for (const cx of [-2.9, 2.9]) {
      const curbN = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 15.8), curbMat);
      curbN.position.set(cx, 0.02, -5.0);
      curbN.receiveShadow = true;
      target.add(curbN);

      const curbS = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 7.6), curbMat);
      curbS.position.set(cx, 0.02, 11.4);
      curbS.receiveShadow = true;
      target.add(curbS);
    }
  }

  private addStreetlamps(target: THREE.Group, coords: Array<[number, number]>, goldAccent = false): void {
    const lampMat = new THREE.MeshStandardMaterial({ color: '#242933', roughness: 0.5, metalness: 0.45 });
    const trimMat = new THREE.MeshStandardMaterial({
      color: goldAccent ? '#d9b14a' : '#242933',
      roughness: 0.4,
      metalness: 0.6,
    });

    for (const [lx, lz] of coords) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.42, 8), lampMat);
      base.position.set(lx, 0.21, lz);
      base.castShadow = true;
      target.add(base);

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, 2.95, 8), lampMat);
      pole.position.set(lx, 1.5, lz);
      pole.castShadow = true;
      target.add(pole);

      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.18, 4), trimMat);
      cap.position.set(lx, 3.2, lz);
      cap.rotation.y = Math.PI / 4;
      target.add(cap);

      const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.32, 0.26), this.streetlampBulbMat);
      lantern.position.set(lx, 2.98, lz);
      target.add(lantern);
    }

    if (coords.length > 0) {
      const glow = new THREE.PointLight('#ffd27d', 0, 12, 1.5);
      glow.position.set(0, 3.1, -0.5);
      target.add(glow);
      this.streetlampLights.push(glow);
    }
  }

  private addTree(
    target: THREE.Group,
    x: number,
    z: number,
    scale: number,
    variant: 'summer' | 'autumn',
    shadowY = 0.03
  ): void {
    const mat = new THREE.SpriteMaterial({
      map: variant === 'summer' ? this.summerTreeTex : this.autumnTreeTex,
      transparent: true,
      alphaTest: 0.2,
    });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(scale * 0.8, scale, 1);
    sp.position.set(x, scale * 0.46, z);
    target.add(sp);

    const sh = new THREE.Mesh(
      new THREE.CircleGeometry(scale * 0.28, 14),
      new THREE.MeshBasicMaterial({ color: '#1b2619', transparent: true, opacity: 0.24, depthWrite: false })
    );
    sh.rotation.x = -Math.PI / 2;
    sh.position.set(x + 0.3, shadowY, z + 0.22);
    target.add(sh);
  }

  private buildAllNeighborhoods(): void {
    this.registerNeighborhood('central-park', this.buildCentralParkLayout());
    this.registerNeighborhood('market', this.buildUnionSquareMarketLayout());
    this.registerNeighborhood('columbia', this.buildColumbiaQuadLayout());
    this.registerNeighborhood('broadway', this.buildBroadwayTheaterLayout());
    this.registerNeighborhood('west-village', this.buildWestVillageLayout());
    this.registerNeighborhood('fidi', this.buildFiDiSkyscraperLayout());
    this.registerNeighborhood('fifth-ave', this.buildFifthAveLuxuryLayout());
  }

  private registerNeighborhood(id: NeighborhoodId, grp: THREE.Group): void {
    grp.visible = id === 'central-park';
    this.neighborhoodGroups.set(id, grp);
    this.scene.add(grp);
  }

  // 1. CENTRAL PARK WEST: Avenue + brownstones on left + Central Park wall/fence/trees on right
  private buildCentralParkLayout(): THREE.Group {
    const g = new THREE.Group();
    this.addAvenueAndCrosswalks(g);

    const brownstoneStyles = [
      { x: -5.4, base: '#a6543a', dark: '#7c3b27', trim: '#d7c6ab', awning: '#2f6d52', h: 6.4 },
      { x: -9.8, base: '#8f4739', dark: '#6b3228', trim: '#d8ccb8', awning: '#8c3333', h: 7.2 },
      { x: -14.2, base: '#b56e45', dark: '#8c5130', trim: '#e0d3bd', awning: '#2e5578', h: 6.6 },
    ];
    const roofMat = new THREE.MeshStandardMaterial({ color: '#4c4946', roughness: 0.95 });
    const sideBrickMat = new THREE.MeshStandardMaterial({ color: '#783d2c', roughness: 0.92 });
    const stoopMat = new THREE.MeshStandardMaterial({ color: '#c4b59d', roughness: 0.9 });

    for (const b of brownstoneStyles) {
      const frontMat = new THREE.MeshStandardMaterial({
        map: createBrownstoneFacadeTexture(b.base, b.dark, b.trim, b.awning),
        roughness: 0.88,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(4.3, b.h, 4.4), [
        sideBrickMat,
        sideBrickMat,
        roofMat,
        roofMat,
        frontMat,
        sideBrickMat,
      ]);
      mesh.position.set(b.x, b.h / 2, -6.5);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);

      const stoop = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.35, 0.8), stoopMat);
      stoop.position.set(b.x + 1.15, 0.17, -3.95);
      stoop.castShadow = true;
      g.add(stoop);
    }

    // Central Park lawn + sunlit gravel path + granite wall + iron fence
    const parkGrass = new THREE.Mesh(
      new THREE.BoxGeometry(14, 0.28, 12),
      new THREE.MeshStandardMaterial({ map: createGrassTexture(7, 6), roughness: 0.96 })
    );
    parkGrass.position.set(10.0, 0.04, -9.2);
    parkGrass.receiveShadow = true;
    g.add(parkGrass);

    const parkPath = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 11.5),
      new THREE.MeshStandardMaterial({ map: createParkPathTexture(2, 6), roughness: 0.95 })
    );
    parkPath.rotation.x = -Math.PI / 2;
    parkPath.position.set(9.2, 0.2, -9.2);
    parkPath.receiveShadow = true;
    g.add(parkPath);

    const wallMat = new THREE.MeshStandardMaterial({ map: createStoneWallTexture(4, 1), roughness: 0.92 });
    const fenceMat = new THREE.MeshStandardMaterial({
      map: createIronFenceTexture(6),
      transparent: true,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.6,
    });
    for (const seg of [
      { x: 5.5, w: 4.8 },
      { x: 13.4, w: 6.0 },
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(seg.w, 0.55, 0.42), wallMat);
      wall.position.set(seg.x, 0.275, -3.3);
      wall.castShadow = true;
      wall.receiveShadow = true;
      g.add(wall);

      const fence = new THREE.Mesh(new THREE.PlaneGeometry(seg.w, 0.85), fenceMat);
      fence.position.set(seg.x, 0.95, -3.3);
      fence.castShadow = true;
      g.add(fence);
    }

    const pillarMat = new THREE.MeshStandardMaterial({ color: '#aba498', roughness: 0.9 });
    const pillarCapMat = new THREE.MeshStandardMaterial({ color: '#c4bdb0', roughness: 0.85 });
    for (const px of [7.95, 10.45]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.45, 0.58), pillarMat);
      pillar.position.set(px, 0.72, -3.3);
      pillar.castShadow = true;
      g.add(pillar);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.14, 0.68), pillarCapMat);
      cap.position.set(px, 1.5, -3.3);
      g.add(cap);
    }

    this.buildParkBench(g, 7.15, -5.05, Math.PI * 0.5, 0.18);
    this.buildParkBench(g, 11.15, -6.35, -Math.PI * 0.5, 0.18);
    this.buildParkBench(g, 7.15, -8.35, Math.PI * 0.5, 0.18);

    const trees: Array<[number, number, number, 'summer' | 'autumn', number]> = [
      [4.4, -4.8, 3.4, 'summer', 0.21],
      [6.5, -6.7, 3.9, 'summer', 0.21],
      [5.1, -9.2, 4.1, 'autumn', 0.21],
      [11.9, -5.1, 3.6, 'summer', 0.21],
      [13.8, -7.5, 4.2, 'autumn', 0.21],
      [10.8, -10.2, 3.8, 'summer', 0.21],
      [7.4, -11.0, 4.0, 'summer', 0.21],
      [-3.7, -4.1, 2.8, 'summer', 0.03],
      [-11.6, -3.7, 3.0, 'autumn', 0.03],
    ];
    for (const [tx, tz, sc, v, sy] of trees) {
      this.addTree(g, tx, tz, sc, v, sy);
    }

    this.addStreetlamps(g, [
      [-3.3, 2.3],
      [3.3, 2.3],
      [3.3, -2.6],
      [-3.3, -2.6],
    ]);
    this.buildTrashCan(g, 7.25, -2.8);
    this.buildTrashCan(g, -3.45, 1.75);

    const hydrant = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.16, 0.54, 8),
      new THREE.MeshStandardMaterial({ color: '#c4362c', roughness: 0.55 })
    );
    hydrant.position.set(3.38, 0.27, 0.55);
    hydrant.castShadow = true;
    g.add(hydrant);

    return g;
  }

  // 2. UNION SQUARE SUPPLY MARKET: Pedestrian-only cobblestone farmers market plaza (NO road, NO taxi, NO Central Park grass)
  private buildUnionSquareMarketLayout(): THREE.Group {
    const g = new THREE.Group();

    // Full pedestrian cobblestone plaza
    const cobbleGround = new THREE.Mesh(
      new THREE.BoxGeometry(36, 0.2, 26),
      new THREE.MeshStandardMaterial({ map: createCobblestoneTexture(16, 12), roughness: 0.92 })
    );
    cobbleGround.position.set(0, -0.1, -2);
    cobbleGround.receiveShadow = true;
    g.add(cobbleGround);

    // Decorative brick plaza apron around center (moved back to z = -5.8 to leave cozy 3-stall front row at z = -1.3)
    const centerRing = new THREE.Mesh(
      new THREE.CylinderGeometry(3.2, 3.3, 0.06, 20),
      new THREE.MeshStandardMaterial({ color: '#c9a679', roughness: 0.9 })
    );
    centerRing.position.set(0, 0.03, -5.8);
    centerRing.receiveShadow = true;
    g.add(centerRing);

    // Central stone market fountain & floral planter
    const stoneMat = new THREE.MeshStandardMaterial({ map: createStoneWallTexture(3, 1), roughness: 0.88 });
    const fountainRim = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.9, 0.58, 16), stoneMat);
    fountainRim.position.set(0, 0.29, -5.8);
    fountainRim.castShadow = true;
    fountainRim.receiveShadow = true;
    g.add(fountainRim);

    const waterDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.48, 1.48, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: '#4cb7d8', roughness: 0.2, metalness: 0.15 })
    );
    waterDisc.position.set(0, 0.56, -5.8);
    g.add(waterDisc);

    const spoutPedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 1.15, 10), stoneMat);
    spoutPedestal.position.set(0, 0.95, -5.8);
    spoutPedestal.castShadow = true;
    g.add(spoutPedestal);

    const spoutBowl = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.25, 0.22, 12), stoneMat);
    spoutBowl.position.set(0, 1.52, -5.8);
    g.add(spoutBowl);

    const waterCrown = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 8, 6),
      this.registerGlow(new THREE.MeshBasicMaterial({ color: '#a8ecff' }), 1.6, 2.0)
    );
    waterCrown.position.set(0, 1.72, -5.8);
    g.add(waterCrown);

    // Clusters of wooden crates & oak barrels around the market square
    const barrelMat = new THREE.MeshStandardMaterial({ color: '#7d4d25', roughness: 0.85 });
    const hoopMat = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.5, metalness: 0.6 });
    for (const [bx, bz] of [
      [-3.2, -4.6],
      [-2.7, -5.0],
      [3.2, -4.6],
      [9.4, -3.8],
      [-9.4, -3.8],
    ]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.25, 0.72, 10), barrelMat);
      barrel.position.set(bx, 0.36, bz);
      barrel.castShadow = true;
      g.add(barrel);
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.275, 0.02, 6, 12), hoopMat);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(bx, 0.52, bz);
      g.add(hoop);
    }

    // Extra lemon & produce crate clusters in the market background
    g.add(this.buildLemonCrate(3.8, 0, -4.8, 0.3, true));
    g.add(this.buildLemonCrate(4.25, 0, -4.9, -0.18, true));
    g.add(this.buildLemonCrate(4.0, 0.34, -4.85, 0.1, true));
    g.add(this.buildLemonCrate(-3.9, 0, -4.9, -0.25, true));
    g.add(this.buildLemonCrate(9.9, 0, -3.5, 0.14, true));
    g.add(this.buildLemonCrate(-9.8, 0, -3.5, -0.2, true));

    // Festive wooden string-light poles + warm bulbs + colorful bunting flags
    const poleMat = new THREE.MeshStandardMaterial({ color: '#5c381c', roughness: 0.88 });
    const poleXs = [-10.5, -5.5, 0, 5.5, 10.5];
    for (const px of poleXs) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.6, 8), poleMat);
      pole.position.set(px, 1.8, -4.2);
      pole.castShadow = true;
      g.add(pole);
    }

    const flagColors = ['#e84a3c', '#f5c531', '#38a354', '#2f78c4', '#f28b30'];
    const bulbMat = this.registerGlow(new THREE.MeshBasicMaterial({ color: '#fff2b5' }), 1.0, 3.0);
    const wireMat = new THREE.MeshBasicMaterial({ color: '#2a2420' });

    for (let s = 0; s < poleXs.length - 1; s++) {
      const x1 = poleXs[s];
      const x2 = poleXs[s + 1];
      const span = x2 - x1;
      const wire = new THREE.Mesh(new THREE.BoxGeometry(span, 0.03, 0.03), wireMat);
      wire.position.set((x1 + x2) / 2, 3.35, -4.2);
      g.add(wire);

      for (let i = 1; i <= 5; i++) {
        const t = i / 6;
        const bx = x1 + span * t;
        const sag = Math.sin(t * Math.PI) * 0.22;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 6), bulbMat);
        bulb.position.set(bx, 3.32 - sag, -4.2);
        g.add(bulb);

        const flag = new THREE.Mesh(
          new THREE.ConeGeometry(0.14, 0.24, 3),
          new THREE.MeshBasicMaterial({ color: flagColors[(s * 5 + i) % flagColors.length] })
        );
        flag.rotation.x = Math.PI;
        flag.position.set(bx, 3.12 - sag, -4.2);
        g.add(flag);
      }
    }

    // Warm market string-light glow
    const marketGlow = new THREE.PointLight('#ffd27d', 0.9, 14, 1.6);
    marketGlow.position.set(0, 3.4, -3.8);
    g.add(marketGlow);

    // Background Union Square perimeter trees & low brick wall
    const wallMat = new THREE.MeshStandardMaterial({ color: '#8f4c36', roughness: 0.9 });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(28, 0.7, 0.5), wallMat);
    backWall.position.set(0, 0.35, -8.8);
    backWall.castShadow = true;
    g.add(backWall);

    for (const [tx, tz, sc, v] of [
      [-11.5, -7.2, 3.8, 'summer'] as const,
      [-6.5, -8.0, 4.0, 'autumn'] as const,
      [6.5, -8.0, 3.9, 'summer'] as const,
      [11.5, -7.2, 4.1, 'autumn'] as const,
    ]) {
      this.addTree(g, tx, tz, sc, v, 0.03);
    }

    this.buildParkBench(g, -2.5, -6.5, 0, 0.02);
    this.buildParkBench(g, 2.5, -6.5, 0, 0.02);

    return g;
  }

  private createTriangularPediment(
    width: number,
    height: number,
    depth: number,
    mat: THREE.Material
  ): THREE.Mesh {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, 0);
    shape.lineTo(width / 2, 0);
    shape.lineTo(0, height);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geo.translate(0, 0, -depth / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // 3. COLUMBIA UNIVERSITY: Low Memorial Library (8 Ionic columns + pediment + dome), Low Steps, Alma Mater & College Walk
  private buildColumbiaQuadLayout(): THREE.Group {
    const g = new THREE.Group();

    // Red-brick College Walk promenade ground (no car avenue)
    const plaza = new THREE.Mesh(
      new THREE.BoxGeometry(36, 0.2, 26),
      new THREE.MeshStandardMaterial({ map: createCobblestoneTexture(16, 12), color: '#c8836b', roughness: 0.92 })
    );
    plaza.position.set(0, -0.1, -2);
    plaza.receiveShadow = true;
    g.add(plaza);

    // Granite College Walk border strips
    const graniteWalk = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 3.6),
      new THREE.MeshStandardMaterial({ map: createSidewalkTexture(16, 2), color: '#e6dfd1', roughness: 0.9 })
    );
    graniteWalk.rotation.x = -Math.PI / 2;
    graniteWalk.position.set(0, 0.015, 0.6);
    graniteWalk.receiveShadow = true;
    g.add(graniteWalk);

    // Symmetrical green South Lawn patches flanking Low Steps
    const grassMat = new THREE.MeshStandardMaterial({ map: createGrassTexture(5, 4), roughness: 0.95 });
    for (const lx of [-10.2, 10.2]) {
      const lawn = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.12, 6.2), grassMat);
      lawn.position.set(lx, 0.06, -5.8);
      lawn.receiveShadow = true;
      g.add(lawn);
    }

    const limestoneMat = new THREE.MeshStandardMaterial({ color: '#e5dfd2', roughness: 0.82 });
    const limestoneDarkMat = new THREE.MeshStandardMaterial({ color: '#ccc4b4', roughness: 0.86 });
    const domeMat = new THREE.MeshStandardMaterial({ color: '#aeb8ad', roughness: 0.72 });

    // Wide sweeping terraced Low Steps (z = -3.4 to -6.5)
    for (let i = 0; i < 6; i++) {
      const stepW = 13.6 - i * 0.2;
      const step = new THREE.Mesh(new THREE.BoxGeometry(stepW, 0.24, 0.62), limestoneMat);
      step.position.set(0, 0.12 + i * 0.24, -3.5 - i * 0.52);
      step.castShadow = true;
      step.receiveShadow = true;
      g.add(step);
    }

    // Flanking stone step cheek walls / balustrades
    for (const sx of [-6.95, 6.95]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.55, 3.6), limestoneDarkMat);
      wall.position.set(sx, 0.78, -5.0);
      wall.castShadow = true;
      g.add(wall);
    }

    // Bronze Alma Mater statue on stone pedestal right in the center of Low Steps
    const almaGroup = new THREE.Group();
    almaGroup.position.set(0, 0.72, -4.55);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.92, 0.95), limestoneDarkMat);
    pedestal.position.y = 0.46;
    pedestal.castShadow = true;
    almaGroup.add(pedestal);

    const bronzeMat = new THREE.MeshStandardMaterial({ color: '#7a5f37', roughness: 0.38, metalness: 0.72 });
    const throne = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.62, 0.58), bronzeMat);
    throne.position.y = 1.22;
    throne.castShadow = true;
    almaGroup.add(throne);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 0.56, 8), bronzeMat);
    torso.position.y = 1.62;
    almaGroup.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), bronzeMat);
    head.position.y = 2.02;
    almaGroup.add(head);

    // Outstretched welcoming arms
    const arms = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.16), bronzeMat);
    arms.position.set(0, 1.72, 0.12);
    almaGroup.add(arms);
    g.add(almaGroup);

    // CENTERPIECE: Low Memorial Library (neoclassical portico + 8 Ionic columns + pediment + iconic dome)
    const lowLib = new THREE.Group();
    lowLib.position.set(0, 1.44, -9.4);

    // Main limestone hall body
    const hallBody = new THREE.Mesh(new THREE.BoxGeometry(12.4, 5.2, 4.6), limestoneMat);
    hallBody.position.set(0, 2.6, -0.4);
    hallBody.castShadow = true;
    hallBody.receiveShadow = true;
    lowLib.add(hallBody);

    // Recessed bronze entrance portal
    const portal = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 2.9, 0.25),
      new THREE.MeshStandardMaterial({ color: '#3b3228', roughness: 0.65 })
    );
    portal.position.set(0, 1.45, 1.9);
    lowLib.add(portal);

    // 8 tall cylindrical Ionic columns across the portico
    for (let i = 0; i < 8; i++) {
      const cx = -4.9 + i * 1.4;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 4.35, 12), limestoneMat);
      col.position.set(cx, 2.25, 2.45);
      col.castShadow = true;
      lowLib.add(col);

      const base = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.56), limestoneDarkMat);
      base.position.set(cx, 0.11, 2.45);
      lowLib.add(base);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.52), limestoneDarkMat);
      cap.position.set(cx, 4.5, 2.45);
      lowLib.add(cap);
    }

    // Entablature beam + triangular pediment
    const entablature = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.62, 1.15), limestoneDarkMat);
    entablature.position.set(0, 4.92, 2.35);
    entablature.castShadow = true;
    lowLib.add(entablature);

    const pediment = this.createTriangularPediment(11.8, 1.75, 1.1, limestoneMat);
    pediment.position.set(0, 5.22, 2.35);
    lowLib.add(pediment);

    // Iconic stepped limestone drum & gray-green dome rising above Low Library
    const drumBase = new THREE.Mesh(new THREE.BoxGeometry(7.8, 1.3, 4.8), limestoneDarkMat);
    drumBase.position.set(0, 5.75, -0.5);
    lowLib.add(drumBase);

    const drum = new THREE.Mesh(new THREE.CylinderGeometry(3.45, 3.65, 1.5, 20), limestoneMat);
    drum.position.set(0, 6.85, -0.6);
    drum.castShadow = true;
    lowLib.add(drum);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(3.3, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      domeMat
    );
    dome.position.set(0, 7.55, -0.6);
    dome.castShadow = true;
    lowLib.add(dome);

    const oculus = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.45, 12), limestoneMat);
    oculus.position.set(0, 10.85, -0.6);
    lowLib.add(oculus);

    g.add(lowLib);

    // Flanking Columbia red-brick academic halls
    const campusFrontMat = new THREE.MeshStandardMaterial({ map: createCampusBrickFacadeTexture(), roughness: 0.86 });
    const brickSideMat = new THREE.MeshStandardMaterial({ color: '#7d342b', roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#4c5752', roughness: 0.9 });
    for (const bx of [-11.6, 11.6]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(6.8, 7.4, 4.6), [
        brickSideMat,
        brickSideMat,
        roofMat,
        roofMat,
        campusFrontMat,
        brickSideMat,
      ]);
      wing.position.set(bx, 3.7, -9.2);
      wing.castShadow = true;
      wing.receiveShadow = true;
      g.add(wing);
    }

    // Columbia Light Blue (#9BDDFF) campus banners on quad lampposts
    const lampCoords: Array<[number, number]> = [
      [-4.2, -2.9],
      [4.2, -2.9],
      [-4.2, 2.2],
      [4.2, 2.2],
    ];
    this.addStreetlamps(g, lampCoords);

    const bannerMat = new THREE.MeshStandardMaterial({ color: '#9BDDFF', roughness: 0.65, side: THREE.DoubleSide });
    for (const [lx, lz] of lampCoords) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 1.05), bannerMat);
      banner.position.set(lx + (lx < 0 ? 0.3 : -0.3), 2.1, lz);
      g.add(banner);
    }

    for (const [tx, tz, sc, v] of [
      [-11.8, -4.4, 3.6, 'autumn'] as const,
      [-8.0, -4.6, 3.1, 'summer'] as const,
      [8.0, -4.6, 3.1, 'summer'] as const,
      [11.8, -4.4, 3.7, 'autumn'] as const,
    ]) {
      this.addTree(g, tx, tz, sc, v, 0.14);
    }

    return g;
  }

  // 4. BROADWAY: Glowing Red TKTS Steps + Stacked Neon Billboards + Theater Marquees + Yellow Cab
  private buildBroadwayTheaterLayout(): THREE.Group {
    const g = new THREE.Group();
    this.addAvenueAndCrosswalks(g, '#b8b6c2');

    // Centerpiece: Glowing crimson stepped TKTS bleachers at center-back
    const tktsGroup = new THREE.Group();
    tktsGroup.position.set(0, 0, -5.6);
    // Standard-material glow gains are absolute emissiveIntensity (was 0.72).
    const tktsRedMat = this.registerGlow(
      new THREE.MeshStandardMaterial({
        color: '#e62236',
        emissive: new THREE.Color('#ff223a'),
        emissiveIntensity: 0.72,
        roughness: 0.3,
      }),
      1.2,
      1.8
    );
    const tktsTrimMat = this.registerGlow(new THREE.MeshBasicMaterial({ color: '#ff8a96' }), 2.2, 3.2);
    for (let i = 0; i < 7; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.34, 0.56), tktsRedMat);
      step.position.set(0, 0.17 + i * 0.34, 1.6 - i * 0.52);
      tktsGroup.add(step);

      const strip = new THREE.Mesh(new THREE.BoxGeometry(4.44, 0.05, 0.06), tktsTrimMat);
      strip.position.set(0, 0.32 + i * 0.34, 1.88 - i * 0.52);
      tktsGroup.add(strip);
    }
    const tktsGlow = new THREE.PointLight('#ff3b4f', 2.2, 10, 1.5);
    tktsGlow.position.set(0, 2.2, 0.4);
    tktsGroup.add(tktsGlow);
    g.add(tktsGroup);

    const theaterTex = createTheaterMarqueeFacadeTexture();
    const theaterFrontMat = new THREE.MeshStandardMaterial({
      map: theaterTex,
      roughness: 0.72,
      emissive: new THREE.Color('#3a2614'),
      emissiveIntensity: 0.45,
    });
    const sideMat = new THREE.MeshStandardMaterial({ color: '#2b2433', roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#1e1b24', roughness: 0.95 });
    const marqueeBoxMat = this.registerGlow(
      new THREE.MeshStandardMaterial({
        color: '#d43535',
        emissive: new THREE.Color('#ff5533'),
        emissiveIntensity: 0.45,
        roughness: 0.4,
      }),
      1.1,
      1.6
    );
    const marqueeTrimMat = this.registerGlow(new THREE.MeshBasicMaterial({ color: '#ffe57f' }), 1.8, 3.0);
    const neonColors = ['#38e8ff', '#ff45b5', '#ffd633', '#3dff8b'];

    const theaterXs = [-13.6, -9.0, -4.8, 4.8, 9.2, 13.6];
    for (let i = 0; i < theaterXs.length; i++) {
      const bx = theaterXs[i];
      const bh = 8.4 + (i % 2) * 1.6;
      const bldg = new THREE.Mesh(new THREE.BoxGeometry(4.2, bh, 4.6), [
        sideMat,
        sideMat,
        roofMat,
        roofMat,
        theaterFrontMat,
        sideMat,
      ]);
      bldg.position.set(bx, bh / 2, -6.5);
      bldg.castShadow = true;
      bldg.receiveShadow = true;
      g.add(bldg);

      // 3D jutting illuminated Broadway marquee canopy
      const marquee = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.65, 1.25), marqueeBoxMat);
      marquee.position.set(bx, 3.05, -3.85);
      g.add(marquee);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(3.52, 0.14, 1.32), marqueeTrimMat);
      trim.position.set(bx, 3.4, -3.85);
      g.add(trim);

      // Stacked glowing neon Times Square billboards above the marquee
      for (let stack = 0; stack < 2; stack++) {
        const col = neonColors[(i * 2 + stack) % neonColors.length];
        const board = new THREE.Mesh(
          new THREE.BoxGeometry(3.5, 1.65, 0.22),
          this.registerGlow(
            new THREE.MeshStandardMaterial({
              color: col,
              emissive: new THREE.Color(col),
              emissiveIntensity: 0.8,
              roughness: 0.25,
            }),
            2.2,
            2.8
          )
        );
        board.position.set(bx, 5.15 + stack * 1.95, -4.12);
        g.add(board);
      }
    }

    for (const lx of [-6.8, 6.8]) {
      const glow = new THREE.PointLight('#ffbe55', 2.0, 13, 1.5);
      glow.position.set(lx, 3.2, -2.5);
      g.add(glow);
    }

    this.addStreetlamps(g, [
      [-3.3, 2.3],
      [3.3, 2.3],
      [3.3, -2.6],
      [-3.3, -2.6],
    ]);

    return g;
  }

  // 5. WEST VILLAGE: Iconic white-marble Washington Square Arch + cobblestone plaza + brownstones + cafe tables + autumn trees
  private buildWestVillageLayout(): THREE.Group {
    const g = new THREE.Group();

    const sidewalk = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.2, 24),
      new THREE.MeshStandardMaterial({ map: createSidewalkTexture(18, 12), color: '#e6d4be', roughness: 0.92 })
    );
    sidewalk.position.set(0, -0.1, -2);
    sidewalk.receiveShadow = true;
    g.add(sidewalk);

    const cobbleStreet = new THREE.Mesh(
      new THREE.BoxGeometry(7.4, 0.14, 26),
      new THREE.MeshStandardMaterial({ map: createCobblestoneTexture(4, 12), roughness: 0.94 })
    );
    cobbleStreet.position.set(0, -0.04, -2);
    cobbleStreet.receiveShadow = true;
    g.add(cobbleStreet);

    // CENTERPIECE: White-marble Washington Square Triumphal Arch
    const archGroup = new THREE.Group();
    archGroup.position.set(0, 0, -6.2);
    const marbleMat = new THREE.MeshStandardMaterial({ color: '#f0ece3', roughness: 0.72 });
    const marbleTrimMat = new THREE.MeshStandardMaterial({ color: '#d8d2c5', roughness: 0.78 });

    // Left & right monumental piers
    for (const px of [-2.15, 2.15]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.65, 1.9), marbleTrimMat);
      base.position.set(px, 0.325, 0);
      base.castShadow = true;
      archGroup.add(base);

      const pier = new THREE.Mesh(new THREE.BoxGeometry(1.6, 4.9, 1.6), marbleMat);
      pier.position.set(px, 2.95, 0);
      pier.castShadow = true;
      pier.receiveShadow = true;
      archGroup.add(pier);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.24, 1.82), marbleTrimMat);
      cap.position.set(px, 5.45, 0);
      archGroup.add(cap);
    }

    // Semicircular arch curve spanning between piers
    const archRing = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.28, 8, 20, Math.PI), marbleTrimMat);
    archRing.position.set(0, 4.15, 0);
    archGroup.add(archRing);

    // Upper attic entablature & cornice
    const attic = new THREE.Mesh(new THREE.BoxGeometry(6.1, 1.75, 1.7), marbleMat);
    attic.position.set(0, 6.45, 0);
    attic.castShadow = true;
    archGroup.add(attic);

    const cornice = new THREE.Mesh(new THREE.BoxGeometry(6.55, 0.3, 1.95), marbleTrimMat);
    cornice.position.set(0, 7.42, 0);
    cornice.castShadow = true;
    archGroup.add(cornice);

    const frieze = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.35, 1.75), marbleTrimMat);
    frieze.position.set(0, 6.35, 0);
    archGroup.add(frieze);

    g.add(archGroup);

    // Cozy warm brownstones flanking Washington Square Arch
    const styles = [
      { x: -13.6, base: '#a8523b', dark: '#7c3926', trim: '#e2d2b8', awning: '#2f6d52', h: 6.2 },
      { x: -9.2, base: '#b8764a', dark: '#8c5530', trim: '#e8dcc6', awning: '#8c3333', h: 6.8 },
      { x: -5.4, base: '#8e4a3d', dark: '#663127', trim: '#dfd0ba', awning: '#355c7d', h: 6.4 },
      { x: 5.4, base: '#a65c42', dark: '#7a412c', trim: '#e6d8c0', awning: '#7a3548', h: 6.5 },
      { x: 9.2, base: '#96543c', dark: '#6d3927', trim: '#ddd0bc', awning: '#2e6b54', h: 7.0 },
      { x: 13.6, base: '#b57249', dark: '#875132', trim: '#e5d6be', awning: '#3e5778', h: 6.3 },
    ];
    const roofMat = new THREE.MeshStandardMaterial({ color: '#4c4643', roughness: 0.95 });
    const sideMat = new THREE.MeshStandardMaterial({ color: '#783d2c', roughness: 0.92 });
    const stoopMat = new THREE.MeshStandardMaterial({ color: '#c4b59d', roughness: 0.9 });

    for (const b of styles) {
      const frontMat = new THREE.MeshStandardMaterial({
        map: createBrownstoneFacadeTexture(b.base, b.dark, b.trim, b.awning),
        roughness: 0.88,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(3.9, b.h, 4.4), [
        sideMat,
        sideMat,
        roofMat,
        roofMat,
        frontMat,
        sideMat,
      ]);
      mesh.position.set(b.x, b.h / 2, -6.5);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);

      const stoop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.34, 0.78), stoopMat);
      stoop.position.set(b.x + 1.0, 0.17, -3.95);
      g.add(stoop);
    }

    const tableClothMat = new THREE.MeshStandardMaterial({ color: '#fff8ec', roughness: 0.7 });
    const ironMat = new THREE.MeshStandardMaterial({ color: '#242930', roughness: 0.5, metalness: 0.5 });
    for (const [cx, cz] of [
      [-9.2, -3.1],
      [-7.8, -3.1],
      [9.2, -3.1],
      [10.6, -3.1],
    ]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.14, 0.68, 8), ironMat);
      leg.position.set(cx, 0.34, cz);
      g.add(leg);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12), tableClothMat);
      top.position.set(cx, 0.7, cz);
      top.castShadow = true;
      g.add(top);
    }

    for (const [tx, tz, sc] of [
      [-3.7, -4.4, 3.2],
      [3.7, -4.4, 3.3],
      [-11.4, -3.4, 3.4],
      [11.8, -3.4, 3.5],
      [0, -9.8, 3.9],
    ]) {
      this.addTree(g, tx, tz, sc, 'autumn', 0.03);
    }

    this.addStreetlamps(g, [
      [-3.5, 2.3],
      [3.5, 2.3],
    ]);

    return g;
  }

  // 6. FINANCIAL DISTRICT: Wall Street Glass Skyscraper Canyon + Bronze Charging Bull + NYC Subway (no neoclassical columns)
  private buildFiDiSkyscraperLayout(): THREE.Group {
    const g = new THREE.Group();
    this.addAvenueAndCrosswalks(g, '#848b96');

    // Wall Street Glass Skyscraper Canyon (towering glass-and-steel curtain walls on both sides + deep canyon backdrop)
    const glassTex = createGlassTowerFacadeTexture();
    const glassMat = new THREE.MeshStandardMaterial({
      map: glassTex,
      roughness: 0.26,
      metalness: 0.38,
    });
    const steelSideMat = new THREE.MeshStandardMaterial({ color: '#344152', roughness: 0.42, metalness: 0.55 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#262d38', roughness: 0.8 });

    const towers: Array<[number, number, number, number]> = [
      [-14.2, 16.4, 4.4, -6.6],
      [-9.6, 18.4, 4.4, -6.6],
      [-5.1, 15.2, 4.1, -6.6],
      [0.0, 19.2, 5.2, -10.6],
      [5.1, 15.6, 4.1, -6.6],
      [9.6, 18.0, 4.4, -6.6],
      [14.2, 16.0, 4.4, -6.6],
    ];
    for (const [tx, th, tw, tz] of towers) {
      const tower = new THREE.Mesh(new THREE.BoxGeometry(tw, th, 4.8), [
        steelSideMat,
        steelSideMat,
        roofMat,
        roofMat,
        glassMat,
        steelSideMat,
      ]);
      tower.position.set(tx, th / 2, tz);
      tower.castShadow = true;
      tower.receiveShadow = true;
      g.add(tower);
    }

    // CENTERPIECE: Iconic Wall Street Bronze Charging Bull sculpture on dark polished granite plinth
    const bullGroup = new THREE.Group();
    bullGroup.position.set(3.95, 0, -3.55);
    bullGroup.rotation.y = -0.28;

    const granitePlinthMat = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.35, metalness: 0.25 });
    const graniteTrimMat = new THREE.MeshStandardMaterial({ color: '#464e59', roughness: 0.4 });
    const bronzeBullMat = new THREE.MeshStandardMaterial({
      color: '#9e7035',
      roughness: 0.3,
      metalness: 0.78,
    });
    const hornMat = new THREE.MeshStandardMaterial({ color: '#d4b475', roughness: 0.28, metalness: 0.65 });

    const plinthBase = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.32, 1.35), granitePlinthMat);
    plinthBase.position.y = 0.16;
    plinthBase.castShadow = true;
    plinthBase.receiveShadow = true;
    bullGroup.add(plinthBase);

    const plinthCap = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.2), graniteTrimMat);
    plinthCap.position.y = 0.34;
    bullGroup.add(plinthCap);

    // Muscular front shoulders & chest (charging low)
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.46, 12, 10), bronzeBullMat);
    shoulders.scale.set(1.25, 0.96, 0.88);
    shoulders.position.set(-0.34, 0.92, 0);
    shoulders.castShadow = true;
    bullGroup.add(shoulders);

    // Barrel torso & hindquarters (angled dynamically upward)
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), bronzeBullMat);
    torso.scale.set(1.45, 0.88, 0.82);
    torso.position.set(0.24, 0.96, 0.04);
    torso.castShadow = true;
    bullGroup.add(torso);

    // Lowered charging head & snout
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.34, 0.34), bronzeBullMat);
    head.position.set(-0.82, 0.76, -0.04);
    head.rotation.z = 0.28;
    head.rotation.y = 0.15;
    head.castShadow = true;
    bullGroup.add(head);

    // Curved charging horns
    for (const hz of [-0.22, 0.18]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.36, 7), hornMat);
      horn.position.set(-0.92, 0.95, hz);
      horn.rotation.z = 0.55;
      horn.rotation.x = hz < 0 ? -0.35 : 0.35;
      bullGroup.add(horn);
    }

    // 4 dynamic charging legs
    for (const [lx, lz, rotZ] of [
      [-0.55, -0.22, 0.22],
      [-0.42, 0.22, -0.15],
      [0.52, -0.2, -0.18],
      [0.64, 0.2, 0.24],
    ]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.06, 0.56, 8), bronzeBullMat);
      leg.position.set(lx, 0.58, lz);
      leg.rotation.z = rotZ;
      leg.castShadow = true;
      bullGroup.add(leg);
    }

    // Sweeping bronze tail
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.55, 6), bronzeBullMat);
    tail.position.set(0.84, 1.08, 0.08);
    tail.rotation.z = -0.65;
    bullGroup.add(tail);

    g.add(bullGroup);

    // Classic green NYC Subway Entrance railing + iconic green globe lamp
    const subway = new THREE.Group();
    subway.position.set(9.4, 0, -2.5);
    const railMat = new THREE.MeshStandardMaterial({ color: '#1b6b42', roughness: 0.5, metalness: 0.35 });
    const stairPit = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.08, 1.3),
      new THREE.MeshStandardMaterial({ color: '#1c2129', roughness: 0.9 })
    );
    stairPit.position.y = 0.04;
    subway.add(stairPit);

    const backRail = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.85, 0.08), railMat);
    backRail.position.set(0, 0.45, -0.68);
    subway.add(backRail);
    for (const sx of [-1.12, 1.12]) {
      const sideRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 1.4), railMat);
      sideRail.position.set(sx, 0.45, 0);
      subway.add(sideRail);
    }
    const globePole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 8), railMat);
    globePole.position.set(-1.12, 1.1, 0.68);
    subway.add(globePole);
    const greenGlobe = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8),
      this.registerGlow(new THREE.MeshBasicMaterial({ color: '#4ce68a' }), 2.2, 3.0)
    );
    greenGlobe.position.set(-1.12, 2.26, 0.68);
    subway.add(greenGlobe);
    g.add(subway);

    this.addStreetlamps(g, [
      [-3.3, 2.3],
      [3.3, 2.3],
      [3.3, -2.6],
      [-3.3, -2.6],
    ]);

    return g;
  }

  // 7. FIFTH AVENUE: Iconic translucent Glass Flagship Cube + Beaux-Arts cream limestone boutiques + gold topiary planters
  private buildFifthAveLuxuryLayout(): THREE.Group {
    const g = new THREE.Group();
    this.addAvenueAndCrosswalks(g, '#f2ecdf');

    // CENTERPIECE: Gleaming translucent Fifth Avenue Glass Flagship Cube on travertine plaza
    const cubeGroup = new THREE.Group();
    cubeGroup.position.set(5.9, 0, -5.6);

    const plazaBase = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.14, 5.0),
      new THREE.MeshStandardMaterial({ color: '#ece6da', roughness: 0.72 })
    );
    plazaBase.position.y = 0.07;
    plazaBase.receiveShadow = true;
    cubeGroup.add(plazaBase);

    const glassCube = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 3.6, 3.6),
      new THREE.MeshPhysicalMaterial({
        color: '#d9f0ff',
        transparent: true,
        opacity: 0.42,
        roughness: 0.08,
        metalness: 0.12,
        reflectivity: 0.9,
      })
    );
    glassCube.position.y = 1.94;
    cubeGroup.add(glassCube);

    // Crisp brushed-steel structural cube wireframe mullions
    const mullionMat = new THREE.MeshStandardMaterial({ color: '#cfd8e3', roughness: 0.25, metalness: 0.8 });
    for (const sx of [-1.8, 1.8]) {
      for (const sz of [-1.8, 1.8]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.64, 0.08), mullionMat);
        post.position.set(sx, 1.94, sz);
        cubeGroup.add(post);
      }
    }
    for (const sy of [0.16, 3.74]) {
      for (const sz of [-1.8, 1.8]) {
        const barX = new THREE.Mesh(new THREE.BoxGeometry(3.68, 0.08, 0.08), mullionMat);
        barX.position.set(0, sy, sz);
        cubeGroup.add(barX);
      }
      for (const sx of [-1.8, 1.8]) {
        const barZ = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.68), mullionMat);
        barZ.position.set(sx, sy, 0);
        cubeGroup.add(barZ);
      }
    }

    // Glowing floating glass-cube centerpiece emblem + warm internal glow
    const emblem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42, 0),
      this.registerGlow(new THREE.MeshBasicMaterial({ color: '#ffffff' }), 2.0, 2.6)
    );
    emblem.position.set(0, 2.25, 0);
    cubeGroup.add(emblem);

    const cubeGlow = new THREE.PointLight('#eef7ff', 1.4, 8, 1.6);
    cubeGlow.position.set(0, 2.3, 0);
    cubeGroup.add(cubeGlow);
    g.add(cubeGroup);

    // Beaux-Arts cream limestone luxury flagships flanking the boulevard & behind the cube
    const luxTex = createLimestoneLuxuryFacadeTexture();
    const luxFrontMat = new THREE.MeshStandardMaterial({ map: luxTex, roughness: 0.78 });
    const stoneSideMat = new THREE.MeshStandardMaterial({ color: '#d8ceb9', roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#5c5850', roughness: 0.9 });

    for (const [bx, bh, bz] of [
      [-13.8, 8.6, -6.5],
      [-9.2, 9.4, -6.5],
      [-4.9, 8.2, -6.5],
      [10.8, 9.2, -6.5],
      [15.2, 8.6, -6.5],
      [5.9, 10.6, -10.8],
    ]) {
      const flagship = new THREE.Mesh(new THREE.BoxGeometry(4.2, bh, 4.6), [
        stoneSideMat,
        stoneSideMat,
        roofMat,
        roofMat,
        luxFrontMat,
        stoneSideMat,
      ]);
      flagship.position.set(bx, bh / 2, bz);
      flagship.castShadow = true;
      flagship.receiveShadow = true;
      g.add(flagship);
    }

    // Gold-trimmed stone planters with sculpted boxwood topiaries
    const planterMat = new THREE.MeshStandardMaterial({ color: '#e6dfd0', roughness: 0.8 });
    const goldMat = new THREE.MeshStandardMaterial({ color: '#d9b14a', roughness: 0.35, metalness: 0.65 });
    const bushMat = new THREE.MeshStandardMaterial({ color: '#2f6e3a', roughness: 0.85 });

    for (const [px, pz] of [
      [-3.55, -3.5],
      [3.55, -3.5],
      [8.9, -3.5],
      [-9.2, -3.5],
    ]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.56, 0.74), planterMat);
      box.position.set(px, 0.28, pz);
      box.castShadow = true;
      g.add(box);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.78), goldMat);
      trim.position.set(px, 0.54, pz);
      g.add(trim);

      const topiary = new THREE.Mesh(new THREE.SphereGeometry(0.36, 10, 8), bushMat);
      topiary.position.set(px, 0.88, pz);
      topiary.castShadow = true;
      g.add(topiary);
    }

    this.addStreetlamps(
      g,
      [
        [-3.3, 2.3],
        [3.3, 2.3],
        [3.3, -2.6],
        [-3.3, -2.6],
      ],
      true
    );

    return g;
  }

  private buildParkBench(target: THREE.Group, x: number, z: number, rotY = 0, y = 0.18): void {
    const bench = new THREE.Group();
    bench.position.set(x, y, z);
    bench.rotation.y = rotY;

    const benchTex = createParkBenchTexture();
    const woodMat = new THREE.MeshStandardMaterial({ map: benchTex, roughness: 0.86 });
    const slatDarkMat = new THREE.MeshStandardMaterial({ map: benchTex, color: '#e6d7c8', roughness: 0.88 });
    const ironMat = new THREE.MeshStandardMaterial({ color: '#222830', roughness: 0.5, metalness: 0.5 });

    for (const sz of [-0.14, 0, 0.14]) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.055, 0.11), woodMat);
      slat.position.set(0, 0.42, sz);
      slat.castShadow = true;
      slat.receiveShadow = true;
      bench.add(slat);
    }
    for (const [by, bz] of [
      [0.64, -0.22],
      [0.8, -0.27],
    ]) {
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.12, 0.055), slatDarkMat);
      back.position.set(0, by, bz);
      back.rotation.x = -0.22;
      back.castShadow = true;
      bench.add(back);
    }
    for (const lx of [-0.58, 0.58]) {
      const frontLeg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.07), ironMat);
      frontLeg.position.set(lx, 0.22, 0.16);
      bench.add(frontLeg);
      const backLeg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.86, 0.07), ironMat);
      backLeg.position.set(lx, 0.43, -0.21);
      bench.add(backLeg);
      const armrest = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.44), ironMat);
      armrest.position.set(lx, 0.56, -0.02);
      bench.add(armrest);
    }

    target.add(bench);
  }

  private buildTrashCan(target: THREE.Group, x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.19, 0.64, 12),
      new THREE.MeshStandardMaterial({ color: '#2b4738', roughness: 0.65, metalness: 0.35 })
    );
    body.position.y = 0.32;
    body.castShadow = true;
    group.add(body);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.025, 6, 14),
      new THREE.MeshStandardMaterial({ color: '#1d3026', roughness: 0.5, metalness: 0.5 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.64;
    group.add(rim);

    group.add(this.createContactShadowMesh(0.32, 0.24));
    target.add(group);
  }

  private buildLemonCrate(x: number, y: number, z: number, rotY = 0, withLemons = true): THREE.Group {
    const crate = new THREE.Group();
    crate.position.set(x, y, z);
    crate.rotation.y = rotY;

    const crateWood = new THREE.MeshStandardMaterial({ map: createLemonCrateTexture(), roughness: 0.86 });
    const crateTrim = new THREE.MeshStandardMaterial({ color: '#7d4c23', roughness: 0.9 });

    const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.34, 0.4), crateWood);
    box.position.y = 0.17;
    box.castShadow = true;
    box.receiveShadow = true;
    crate.add(box);

    for (const sy of [0.06, 0.28]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.055, 0.42), crateTrim);
      band.position.y = sy;
      crate.add(band);
    }

    if (withLemons) {
      const lemonMat = new THREE.MeshStandardMaterial({ color: '#f7d136', roughness: 0.45 });
      const lemonGeo = new THREE.SphereGeometry(0.068, 7, 6);
      const positions = [
        [-0.12, 0.35, -0.07],
        [0.01, 0.36, -0.08],
        [0.13, 0.35, -0.06],
        [-0.08, 0.36, 0.07],
        [0.07, 0.36, 0.08],
        [0.0, 0.41, 0.0],
      ];
      for (const [lx, ly, lz] of positions) {
        const lemon = new THREE.Mesh(lemonGeo, lemonMat);
        lemon.scale.set(1.22, 0.88, 0.88);
        lemon.position.set(lx, ly, lz);
        lemon.castShadow = true;
        crate.add(lemon);
      }
    }

    return crate;
  }

  private buildCupStack(x: number, y: number, z: number, accentHex: string): THREE.Group {
    const stack = new THREE.Group();
    stack.position.set(x, y, z);

    const cupMat = new THREE.MeshStandardMaterial({ color: '#fff8ea', roughness: 0.65 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: accentHex, roughness: 0.6 });

    for (let i = 0; i < 4; i++) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.044, 0.13, 10), cupMat);
      cup.position.y = 0.065 + i * 0.036;
      cup.castShadow = true;
      stack.add(cup);

      if (i === 3) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.059, 0.055, 0.028, 10), stripeMat);
        band.position.y = 0.095 + i * 0.036;
        stack.add(band);
      }
    }

    return stack;
  }

  // Clean OPEN-TOP wooden counter booth (NO overhead canopy blocking characters!)
  private buildStandStructure(pos: THREE.Vector3, opts: StandStyleOptions): void {
    const {
      accentHex,
      secondaryHex,
      label,
      signTopText,
      signSubText,
      includePitchers,
      isSeller = false,
      marketKind,
      parentGroup,
    } = opts;

    const group = new THREE.Group();
    group.position.copy(pos);

    const woodDarkMat = new THREE.MeshStandardMaterial({ color: '#61391c', roughness: 0.9 });
    const woodMidMat = new THREE.MeshStandardMaterial({ color: '#875329', roughness: 0.86 });
    const counterTopMat = new THREE.MeshStandardMaterial({ color: '#d49a5c', roughness: 0.78 });
    const counterBevelMat = new THREE.MeshStandardMaterial({ color: '#ba7e42', roughness: 0.82 });
    const frontMat = new THREE.MeshStandardMaterial({
      map: createLemonadeStandFrontTexture(accentHex, label),
      roughness: 0.84,
    });

    // Ground contact shadow under booth
    const standShadow = this.createContactShadowMesh(1.42, 0.76);
    standShadow.position.set(0, 0.02, 0.04);
    group.add(standShadow);

    // Base kickplate plinth (low y=0.68 counter so characters behind it sit cleanly above props)
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.06, 0.96), woodDarkMat);
    plinth.position.set(0, 0.03, 0);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    group.add(plinth);

    // Main counter body with pixel-art front panel
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.54, 0.88), [
      woodMidMat,
      woodMidMat,
      counterTopMat,
      woodDarkMat,
      frontMat,
      woodMidMat,
    ]);
    counter.position.set(0, 0.33, 0);
    counter.castShadow = true;
    counter.receiveShadow = true;
    group.add(counter);

    // Vertical wooden corner trim moldings
    for (const cx of [-1.01, 1.01]) {
      for (const cz of [-0.43, 0.43]) {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.56, 0.08), woodDarkMat);
        trim.position.set(cx, 0.33, cz);
        trim.castShadow = true;
        group.add(trim);
      }
    }

    // Beveled overhanging two-tier oak countertop (y = 0.63..0.68)
    const counterLip = new THREE.Mesh(new THREE.BoxGeometry(2.22, 0.045, 1.04), counterBevelMat);
    counterLip.position.set(0, 0.625, 0.03);
    counterLip.castShadow = true;
    counterLip.receiveShadow = true;
    group.add(counterLip);

    const counterTop = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.035, 0.96), counterTopMat);
    counterTop.position.set(0, 0.665, 0.03);
    counterTop.castShadow = true;
    counterTop.receiveShadow = true;
    group.add(counterTop);

    // Raised wooden step-stool / floor platform behind the counter so vendors & player stand tall above the counter
    const stepStool = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.24, 0.54), woodMidMat);
    stepStool.position.set(0, 0.12, -0.62);
    stepStool.castShadow = true;
    stepStool.receiveShadow = true;
    group.add(stepStool);

    const stepStoolTop = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.03, 0.58), counterTopMat);
    stepStoolTop.position.set(0, 0.245, -0.62);
    stepStoolTop.receiveShadow = true;
    group.add(stepStoolTop);

    // Side standing sign post + warm lantern (positioned OFF TO THE SIDE so it NEVER blocks the character!)
    const signSide = isSeller || marketKind === 'pitchers' ? 1.48 : -1.48;
    const armDir = signSide > 0 ? 1 : -1;
    const signPost = new THREE.Group();
    signPost.position.set(signSide, 0, 0.16);

    const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.72, 0.09), woodDarkMat);
    post.position.y = 0.86;
    post.castShadow = true;
    signPost.add(post);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.065, 0.065), woodDarkMat);
    arm.position.set(armDir * 0.28, 1.56, 0);
    arm.castShadow = true;
    signPost.add(arm);

    const signTex = this.createStandPlaqueTexture(signTopText, signSubText, accentHex, secondaryHex);
    const signFace = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.55 });
    const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.38, 0.045), [
      woodDarkMat,
      woodDarkMat,
      woodDarkMat,
      woodDarkMat,
      signFace,
      signFace,
    ]);
    plaque.position.set(armDir * 0.3, 1.29, 0);
    plaque.castShadow = true;
    signPost.add(plaque);

    // Cozy glowing lantern atop the side sign post
    const lanternBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.095, 8, 6),
      this.registerGlow(new THREE.MeshBasicMaterial({ color: '#fff3be' }), 1.0, 3.0)
    );
    lanternBulb.position.y = 1.8;
    signPost.add(lanternBulb);

    const postGlow = new THREE.PointLight('#ffd480', 0.65, 4.2, 1.8);
    postGlow.position.set(0, 1.85, 0.2);
    signPost.add(postGlow);

    group.add(signPost);

    // Props on & beside the counter (low profile so vendor face & torso stay 100% clear)
    const counterY = 0.682;
    if (marketKind === 'stalls') {
      // Carpentry & Stall Kits vendor: stacked wooden planks/beams + miniature stall frame on counter + timber stack beside stall
      const plankMat = new THREE.MeshStandardMaterial({ color: '#c88c4b', roughness: 0.82 });
      const beamMat = new THREE.MeshStandardMaterial({ color: '#8f582a', roughness: 0.86 });

      for (let row = 0; row < 3; row++) {
        for (const pz of [0.14, 0.27]) {
          const plank = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.05, 0.11), row % 2 === 0 ? plankMat : beamMat);
          plank.position.set(-0.42, counterY + 0.03 + row * 0.055, pz);
          plank.rotation.y = (row - 1) * 0.05;
          plank.castShadow = true;
          group.add(plank);
        }
      }

      // Miniature wooden stall kit model on right side of counter
      const miniStall = new THREE.Group();
      miniStall.position.set(0.45, counterY, 0.2);
      const miniBase = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.34), beamMat);
      miniBase.position.y = 0.11;
      miniBase.castShadow = true;
      miniStall.add(miniBase);
      const miniTop = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.035, 0.38), plankMat);
      miniTop.position.y = 0.23;
      miniStall.add(miniTop);
      group.add(miniStall);

      // Stacked lumber beams beside the stall
      for (let i = 0; i < 3; i++) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.72), i % 2 === 0 ? plankMat : beamMat);
        beam.position.set(-1.35, 0.07 + i * 0.145, 0.04);
        beam.rotation.y = (i - 1) * 0.08;
        beam.castShadow = true;
        group.add(beam);
      }
    } else if (marketKind === 'lemons') {
      group.add(this.buildLemonCrate(1.36, 0, 0.08, -0.14, true));
      group.add(this.buildLemonCrate(1.4, 0.34, -0.02, 0.18, true));

      const lemonMat = new THREE.MeshStandardMaterial({ color: '#f7d136', roughness: 0.42 });
      const lemonGeo = new THREE.SphereGeometry(0.068, 8, 6);
      const pyramidCoords: Array<[number, number, number]> = [
        [-0.52, counterY + 0.05, 0.22],
        [-0.32, counterY + 0.05, 0.22],
        [-0.12, counterY + 0.05, 0.22],
        [0.08, counterY + 0.05, 0.22],
        [0.28, counterY + 0.05, 0.22],
        [0.48, counterY + 0.05, 0.22],
        [-0.42, counterY + 0.14, 0.2],
        [-0.22, counterY + 0.14, 0.2],
        [-0.02, counterY + 0.14, 0.2],
        [0.18, counterY + 0.14, 0.2],
        [0.38, counterY + 0.14, 0.2],
      ];
      for (const [lx, ly, lz] of pyramidCoords) {
        const lm = new THREE.Mesh(lemonGeo, lemonMat);
        lm.scale.set(1.22, 0.88, 0.88);
        lm.position.set(lx, ly, lz);
        lm.castShadow = true;
        group.add(lm);
      }
    } else if (marketKind === 'pitchers') {
      const pTex = createPitcherTexture();
      for (const ox of [-0.66, -0.33, 0, 0.33, 0.66]) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pTex, transparent: true }));
        sp.scale.set(0.38, 0.46, 1);
        sp.position.set(ox, counterY + 0.23, 0.18);
        group.add(sp);
      }
      group.add(this.buildCupStack(-0.86, counterY, 0.26, accentHex));
      group.add(this.buildCupStack(0.86, counterY, 0.26, accentHex));
    } else {
      const crateSide = isSeller ? -1.36 : 1.36;
      group.add(this.buildLemonCrate(crateSide, 0, 0.08, isSeller ? 0.18 : -0.14, true));
      group.add(
        this.buildLemonCrate(crateSide + (isSeller ? -0.04 : 0.05), 0.34, -0.04, isSeller ? -0.12 : 0.22, !isSeller)
      );

      group.add(this.buildCupStack(isSeller ? 0.74 : -0.78, counterY, 0.24, accentHex));
      group.add(this.buildCupStack(isSeller ? 0.58 : -0.62, counterY, 0.31, accentHex));
    }

    if (includePitchers) {
      const pTex = createPitcherTexture();
      const offsets = [-0.26, 0.22, 0.7];
      for (const ox of offsets) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pTex, transparent: true }));
        sp.scale.set(0.42, 0.5, 1);
        sp.position.set(ox, counterY + 0.24, 0.18);
        group.add(sp);
        this.pitcherSprites.push(sp);
      }
      this.setPitcherCount(1);
    } else if (isSeller) {
      const pTex = createPitcherTexture();
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: pTex, transparent: true }));
      sp.scale.set(0.38, 0.46, 1);
      sp.position.set(-0.52, counterY + 0.22, 0.2);
      group.add(sp);

      const ledger = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.05, 0.26),
        new THREE.MeshStandardMaterial({ color: '#274d4a', roughness: 0.7 })
      );
      ledger.position.set(0.05, counterY + 0.025, 0.22);
      ledger.rotation.y = 0.22;
      ledger.castShadow = true;
      group.add(ledger);
    }

    parentGroup.add(group);
  }

  private buildPlotMarkings(): void {
    const buildPaintedPlot = (
      target: THREE.Group,
      borderHex: string,
      fillHex: string,
      signTop: string,
      signSub: string
    ) => {
      target.position.copy(OWN_STAND_POS);

      const padMat = new THREE.MeshBasicMaterial({
        color: fillHex,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      });
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 1.45), padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(0, 0.024, -0.05);
      target.add(pad);

      const dashMat = new THREE.MeshBasicMaterial({ color: borderHex, depthWrite: false });
      // Front & back dashed edges
      for (const ez of [-0.76, 0.66]) {
        for (let dx = -1.08; dx <= 1.09; dx += 0.36) {
          const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.07), dashMat);
          dash.rotation.x = -Math.PI / 2;
          dash.position.set(dx, 0.028, ez);
          target.add(dash);
        }
      }
      // Left & right dashed edges
      for (const ex of [-1.26, 1.26]) {
        for (let dz = -0.58; dz <= 0.5; dz += 0.36) {
          const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.22), dashMat);
          dash.rotation.x = -Math.PI / 2;
          dash.position.set(ex, 0.028, dz);
          target.add(dash);
        }
      }

      // Small side sign stake
      const woodMat = new THREE.MeshStandardMaterial({ color: '#61391c', roughness: 0.9 });
      const stake = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.12, 0.07), woodMat);
      stake.position.set(1.42, 0.56, 0.14);
      stake.castShadow = true;
      target.add(stake);

      const plaqueTex = this.createStandPlaqueTexture(signTop, signSub, borderHex, '#fffaf0');
      const plaqueFace = new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.55 });
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.38, 0.045), [
        woodMat,
        woodMat,
        woodMat,
        woodMat,
        plaqueFace,
        plaqueFace,
      ]);
      plaque.position.set(1.42, 1.08, 0.14);
      plaque.castShadow = true;
      target.add(plaque);
    };

    buildPaintedPlot(this.emptyPlotGroup, '#f0b829', '#ffe885', 'FOR LEASE', 'PRESS [E]');
    buildPaintedPlot(this.leasedPlotGroup, '#2fb862', '#7ef2a6', 'LEASED', 'BUILD STAND');
  }

  private buildOwnStand(): void {
    this.buildStandStructure(OWN_STAND_POS, {
      accentHex: '#e0a512',
      secondaryHex: '#fff9e6',
      label: 'LEMONADE',
      signTopText: 'LEMONADE',
      signSubText: 'FRESH SQUEEZED',
      includePitchers: true,
      parentGroup: this.ownStandGroup,
    });
  }

  private buildSellerStand(): void {
    this.buildStandStructure(SELLER_STAND_POS, {
      accentHex: '#257d72',
      secondaryHex: '#f6eedc',
      label: 'FOR SALE',
      signTopText: 'FOR SALE',
      signSubText: 'INQUIRE WITHIN',
      includePitchers: false,
      isSeller: true,
      parentGroup: this.businessStandsGroup,
    });

    const sellerTex = createMascotSpriteTexture('shiba', 0, 'down', 'vest');
    const sellerSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: sellerTex, transparent: true, alphaTest: 0.2 })
    );
    sellerSprite.scale.set(PLAYER_SPRITE_W, PLAYER_SPRITE_H, 1);
    sellerSprite.position.set(
      SELLER_STAND_POS.x,
      PLAYER_SPRITE_H * 0.48 + BEHIND_COUNTER_LIFT,
      SELLER_STAND_POS.z - 0.62
    );
    this.businessStandsGroup.add(sellerSprite);

    const sellerShadow = this.createContactShadowMesh(0.4, 0.26);
    sellerShadow.position.set(SELLER_STAND_POS.x, 0.265, SELLER_STAND_POS.z - 0.6);
    this.businessStandsGroup.add(sellerShadow);
  }

  private buildMarketStands(): void {
    // 1. Left Stall (x = -4.3, z = -1.3): Carpentry & Stall Kits Vendor ('market-stalls')
    this.buildStandStructure(MARKET_STALLS_POS, {
      accentHex: '#b36b2c',
      secondaryHex: '#fff5e0',
      label: 'STALL KITS',
      signTopText: 'STALL KITS',
      signSubText: 'CARPENTRY $12',
      includePitchers: false,
      marketKind: 'stalls',
      parentGroup: this.marketStandsGroup,
    });

    const stallVendorTex = createMascotSpriteTexture('bunny', 0, 'down', 'vest');
    const stallVendor = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: stallVendorTex, transparent: true, alphaTest: 0.2 })
    );
    stallVendor.scale.set(PLAYER_SPRITE_W, PLAYER_SPRITE_H, 1);
    stallVendor.position.set(
      MARKET_STALLS_POS.x,
      PLAYER_SPRITE_H * 0.48 + BEHIND_COUNTER_LIFT,
      MARKET_STALLS_POS.z - 0.62
    );
    this.marketStandsGroup.add(stallVendor);

    const stallVendorShadow = this.createContactShadowMesh(0.4, 0.26);
    stallVendorShadow.position.set(MARKET_STALLS_POS.x, 0.265, MARKET_STALLS_POS.z - 0.6);
    this.marketStandsGroup.add(stallVendorShadow);

    // 2. Center Stall (x = 0.0, z = -1.3): Glassware & Pitchers Vendor ('market-pitchers')
    this.buildStandStructure(MARKET_PITCHERS_POS, {
      accentHex: '#2661a6',
      secondaryHex: '#f2f7ff',
      label: 'PITCHERS',
      signTopText: 'PITCHERS',
      signSubText: 'GLASS GEAR $10',
      includePitchers: false,
      marketKind: 'pitchers',
      parentGroup: this.marketStandsGroup,
    });

    const pitcherVendorTex = createMascotSpriteTexture('penguin', 0, 'down', 'vest');
    const pitcherVendor = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: pitcherVendorTex, transparent: true, alphaTest: 0.2 })
    );
    pitcherVendor.scale.set(PLAYER_SPRITE_W, PLAYER_SPRITE_H, 1);
    pitcherVendor.position.set(
      MARKET_PITCHERS_POS.x,
      PLAYER_SPRITE_H * 0.48 + BEHIND_COUNTER_LIFT,
      MARKET_PITCHERS_POS.z - 0.62
    );
    this.marketStandsGroup.add(pitcherVendor);

    const pitcherVendorShadow = this.createContactShadowMesh(0.4, 0.26);
    pitcherVendorShadow.position.set(MARKET_PITCHERS_POS.x, 0.265, MARKET_PITCHERS_POS.z - 0.6);
    this.marketStandsGroup.add(pitcherVendorShadow);

    // 3. Right Stall (x = +4.3, z = -1.3): Fresh Lemon Vendor ('market-lemons')
    this.buildStandStructure(MARKET_LEMONS_POS, {
      accentHex: '#2e8f40',
      secondaryHex: '#fff9db',
      label: 'LEMONS',
      signTopText: 'LEMONS',
      signSubText: 'WHOLESALE $5',
      includePitchers: false,
      marketKind: 'lemons',
      parentGroup: this.marketStandsGroup,
    });

    const lemonVendorTex = createMascotSpriteTexture('panda', 0, 'down', 'apron');
    const lemonVendor = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: lemonVendorTex, transparent: true, alphaTest: 0.2 })
    );
    lemonVendor.scale.set(PLAYER_SPRITE_W, PLAYER_SPRITE_H, 1);
    lemonVendor.position.set(
      MARKET_LEMONS_POS.x,
      PLAYER_SPRITE_H * 0.48 + BEHIND_COUNTER_LIFT,
      MARKET_LEMONS_POS.z - 0.62
    );
    this.marketStandsGroup.add(lemonVendor);

    const lemonVendorShadow = this.createContactShadowMesh(0.4, 0.26);
    lemonVendorShadow.position.set(MARKET_LEMONS_POS.x, 0.265, MARKET_LEMONS_POS.z - 0.6);
    this.marketStandsGroup.add(lemonVendorShadow);
  }

  private createVehicleMesh(kind: 'taxi' | 'sedan' | 'van'): THREE.Group {
    const car = new THREE.Group();
    const glassMat = new THREE.MeshStandardMaterial({ color: '#2b394a', roughness: 0.25 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.9 });

    if (kind === 'van') {
      const vanWhite = new THREE.MeshStandardMaterial({ color: '#f2f5f8', roughness: 0.45 });
      const vanStripe = new THREE.MeshStandardMaterial({ color: '#2b6cb0', roughness: 0.5 });

      const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.58, 1.05, 3.2), vanWhite);
      cargo.position.set(0, 0.68, -0.15);
      cargo.castShadow = true;
      car.add(cargo);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 3.22), vanStripe);
      stripe.position.set(0, 0.62, -0.15);
      car.add(stripe);

      const nose = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.55, 0.7), vanWhite);
      nose.position.set(0, 0.44, 1.65);
      nose.castShadow = true;
      car.add(nose);

      const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.42, 0.5), glassMat);
      windshield.position.set(0, 0.88, 1.35);
      car.add(windshield);
    } else {
      const bodyMat = new THREE.MeshStandardMaterial({
        color: kind === 'taxi' ? '#f5be26' : '#263242',
        roughness: 0.4,
        metalness: kind === 'sedan' ? 0.35 : 0.1,
      });

      const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.52, 2.9), bodyMat);
      body.position.y = 0.42;
      body.castShadow = true;
      car.add(body);

      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.42, 1.55), glassMat);
      cabin.position.set(0, 0.85, -0.1);
      cabin.castShadow = true;
      car.add(cabin);

      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.1, 1.5), bodyMat);
      roof.position.set(0, 1.08, -0.1);
      car.add(roof);

      if (kind === 'taxi') {
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.18, 0.24),
          this.registerGlow(new THREE.MeshBasicMaterial({ color: '#fff4c2' }), 1.0, 2.6)
        );
        sign.position.set(0, 1.2, -0.1);
        car.add(sign);
      }
    }

    for (const [wx, wz] of [
      [-0.75, 0.85],
      [0.75, 0.85],
      [-0.75, -0.85],
      [0.75, -0.85],
    ]) {
      const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.44), wheelMat);
      wheel.position.set(wx, 0.2, wz);
      car.add(wheel);
    }

    return car;
  }

  private buildTaxi(): void {
    this.taxiGroup = new THREE.Group();
    this.scene.add(this.taxiGroup);

    // 1. Southbound avenue (x = -1.35, z: -16 -> +16) — Yellow NYC Cab
    const sbCab = this.createVehicleMesh('taxi');
    sbCab.position.set(-1.35, 0, -11);
    this.taxiGroup.add(sbCab);
    this.vehicles.push({
      group: sbCab,
      axis: 'z',
      dir: 1,
      speed: 5.2,
      minBound: -16,
      maxBound: 16,
      halfX: 1.0,
      halfZ: 1.65,
    });

    // 2. Northbound avenue (x = +1.35, z: +16 -> -16) — Dark Town Car / Sedan
    const nbSedan = this.createVehicleMesh('sedan');
    nbSedan.rotation.y = Math.PI;
    nbSedan.position.set(1.35, 0, 11);
    this.taxiGroup.add(nbSedan);
    this.vehicles.push({
      group: nbSedan,
      axis: 'z',
      dir: -1,
      speed: 4.8,
      minBound: -16,
      maxBound: 16,
      halfX: 1.0,
      halfZ: 1.65,
    });

    // 3. Eastbound cross-street (z = +5.9, x: -18 -> +18) — White NYC Delivery Van
    const ebVan = this.createVehicleMesh('van');
    ebVan.rotation.y = Math.PI / 2;
    ebVan.position.set(-13, 0, 5.9);
    this.taxiGroup.add(ebVan);
    this.vehicles.push({
      group: ebVan,
      axis: 'x',
      dir: 1,
      speed: 4.5,
      minBound: -18,
      maxBound: 18,
      halfX: 1.75,
      halfZ: 1.0,
    });

    // 4. Westbound cross-street (z = +4.4, x: +18 -> -18) — Yellow NYC Cab
    const wbCab = this.createVehicleMesh('taxi');
    wbCab.rotation.y = -Math.PI / 2;
    wbCab.position.set(13, 0, 4.4);
    this.taxiGroup.add(wbCab);
    this.vehicles.push({
      group: wbCab,
      axis: 'x',
      dir: -1,
      speed: 5.0,
      minBound: -18,
      maxBound: 18,
      halfX: 1.65,
      halfZ: 1.0,
    });
  }

  private buildPlayer(): void {
    this.playerFrames = this.buildPlayerFrames(this.playerSpecies);
    this.playerKoTex = createKnockedOutSpriteTexture(this.playerSpecies);

    const mat = new THREE.SpriteMaterial({
      map: this.playerFrames.down[0],
      transparent: true,
      alphaTest: 0.2,
    });
    this.playerSprite = new THREE.Sprite(mat);
    this.playerSprite.scale.set(PLAYER_SPRITE_W, PLAYER_SPRITE_H, 1);
    this.playerSprite.position.set(this.playerPos.x, PLAYER_SPRITE_H * 0.48, this.playerPos.z);
    this.scene.add(this.playerSprite);

    this.playerShadow = this.createContactShadowMesh(0.42, 0.28);
    this.playerShadow.position.set(this.playerPos.x, 0.022, this.playerPos.z + 0.04);
    this.scene.add(this.playerShadow);

    // Floating translucent pixel soul wisp for taxi KO animation
    const soulMat = new THREE.SpriteMaterial({
      map: createSoulSpriteTexture(),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.soulSprite = new THREE.Sprite(soulMat);
    this.soulSprite.scale.set(0.76, 0.92, 1);
    this.soulSprite.visible = false;
    this.soulSprite.renderOrder = 10;
    this.scene.add(this.soulSprite);
  }

  private buildPedestrians(): void {
    this.pedKoTex = createKnockedOutSpriteTexture('penguin');
    const sharedSoulTex = createSoulSpriteTexture();
    const allKinds: DistrictPedestrianKind[] = [
      'park-dog-walker',
      'park-jogger',
      'columbia-student',
      'fidi-suit',
      'broadway-theater',
      'fifth-shopper',
      'village-artist',
    ];
    this.pedSpriteBank = {} as Record<
      DistrictPedestrianKind,
      Record<'down' | 'up' | 'left' | 'right', [THREE.CanvasTexture, THREE.CanvasTexture, THREE.CanvasTexture]>
    >;
    for (const kind of allKinds) {
      this.pedSpriteBank[kind] = {
        down: [
          createDistrictPedestrianTexture(kind, 0, 'down'),
          createDistrictPedestrianTexture(kind, 1, 'down'),
          createDistrictPedestrianTexture(kind, 2, 'down'),
        ],
        up: [
          createDistrictPedestrianTexture(kind, 0, 'up'),
          createDistrictPedestrianTexture(kind, 1, 'up'),
          createDistrictPedestrianTexture(kind, 2, 'up'),
        ],
        left: [
          createDistrictPedestrianTexture(kind, 0, 'left'),
          createDistrictPedestrianTexture(kind, 1, 'left'),
          createDistrictPedestrianTexture(kind, 2, 'left'),
        ],
        right: [
          createDistrictPedestrianTexture(kind, 0, 'right'),
          createDistrictPedestrianTexture(kind, 1, 'right'),
          createDistrictPedestrianTexture(kind, 2, 'right'),
        ],
      };
    }

    const initialKinds = DISTRICT_PEDESTRIANS[this.currentNeighborhood];
    const initialSpawns: Array<{ x: number; z: number; dir: 1 | -1; speed: number }> = [
      { x: 8.6, z: 0.45, dir: -1, speed: 1.75 },
      { x: 2.4, z: 0.9, dir: 1, speed: 1.6 },
      { x: 12.8, z: 1.35, dir: -1, speed: 1.45 },
      { x: -4.2, z: 0.65, dir: 1, speed: 1.55 },
      { x: -11.5, z: 1.55, dir: 1, speed: 1.65 },
      { x: 15.5, z: 0.75, dir: -1, speed: 1.75 },
      { x: -15.8, z: 1.15, dir: 1, speed: 1.5 },
    ];

    initialSpawns.forEach((a, idx) => {
      const kind = initialKinds[idx % initialKinds.length];
      const frames = this.pedSpriteBank[kind];
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: frames.down[0], transparent: true, alphaTest: 0.2 })
      );
      sp.scale.set(PED_SPRITE_W, PED_SPRITE_H, 1);
      sp.position.set(a.x, PED_SPRITE_H * 0.48, a.z);
      this.scene.add(sp);

      const shadow = this.createContactShadowMesh(0.4, 0.25);
      shadow.position.set(a.x, 0.022, a.z + 0.04);
      this.scene.add(shadow);

      const pedSoul = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: sharedSoulTex,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        })
      );
      pedSoul.scale.set(0.58, 0.7, 1);
      pedSoul.visible = false;
      pedSoul.renderOrder = 9;
      this.scene.add(pedSoul);

      this.pedestrians.push({
        id: idx + 1,
        sprite: sp,
        shadow,
        soulSprite: pedSoul,
        frames,
        x: a.x,
        z: a.z,
        homeZ: a.z,
        vx: a.speed * a.dir,
        speed: a.speed,
        animTimer: this.rng.cosmetic() * 5,
        canBuy: true,
        boughtCooldown: idx === 0 ? 0.5 : 1.5 + idx * 0.7,
        state: 'strolling',
        queueSlot: -1,
        patience: QUEUE_MAX_PATIENCE,
        maxPatience: QUEUE_MAX_PATIENCE,
        careful: idx % 5 !== 0, // ~80% pause at curb for passing cabs, ~20% distracted
        koTimer: 0,
      });
    });
  }

  private refreshPedestriansForNeighborhood(id: NeighborhoodId): void {
    if (!this.pedSpriteBank || this.pedestrians.length === 0) return;
    const kinds = DISTRICT_PEDESTRIANS[id];
    this.pedestrians.forEach((ped, idx) => {
      const kind = kinds[idx % kinds.length];
      ped.frames = this.pedSpriteBank[kind];
      const dir = ped.state === 'queued' ? 'up' : ped.vx < 0 ? 'left' : 'right';
      const mat = ped.sprite.material as THREE.SpriteMaterial;
      mat.map = ped.frames[dir][0];
      mat.needsUpdate = true;
    });
  }

  private respawnPedestrianOffscreen(ped: Pedestrian): void {
    const kinds = DISTRICT_PEDESTRIANS[this.currentNeighborhood];
    const nextKind = kinds[Math.floor(this.rng.cosmetic() * kinds.length)];
    const fromLeft = this.rng.gameplay() > 0.5;
    ped.frames = this.pedSpriteBank[nextKind];
    ped.x = fromLeft ? -17.5 : 17.5;
    ped.homeZ = 0.4 + this.rng.cosmetic() * 1.45;
    ped.z = ped.homeZ;
    ped.speed = 1.4 + this.rng.gameplay() * 0.55;
    ped.vx = fromLeft ? ped.speed : -ped.speed;
    ped.state = 'strolling';
    ped.queueSlot = -1;
    ped.boughtCooldown = 1.2 + this.rng.gameplay() * 2.5;
    ped.careful = this.rng.cosmetic() < 0.8;
    ped.koTimer = 0;
    ped.soulSprite.visible = false;
  }

  private handleResize = (): void => {
    if (this.disposed) return;
    const w = this.container.clientWidth;
    const h = Math.max(this.container.clientHeight, 1);
    const dpr = Math.min(window.devicePixelRatio, 2);
    // Both the window event and the ResizeObserver can fire for one change;
    // skip redundant work (resizing reallocates every render target).
    const last = this.lastResize;
    if (last.w === w && last.h === h && last.dpr === dpr) return;
    this.lastResize = { w, h, dpr };
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      this.keys.add(k);
      this.playerTarget = null;
    } else if (k === 'e' || (k === ' ' && !this.workingAtStand)) {
      const nearby = this.getNearbyTarget();
      if (nearby) {
        this.callbacks.onInteract(nearby);
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase());
  };

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.workingAtStand || this.koTimer > 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      hit.x = THREE.MathUtils.clamp(hit.x, -12.5, 12.5);
      hit.z = THREE.MathUtils.clamp(hit.z, -2.68, 8.2);
      this.playerTarget = hit;
    }
  };

  private getNearbyTarget(): NearbyTarget {
    if (this.currentNeighborhood === 'market') {
      const candidates: Array<{ target: NearbyTarget; dist: number }> = [
        { target: 'market-stalls', dist: this.playerPos.distanceTo(MARKET_STALLS_POS) },
        { target: 'market-pitchers', dist: this.playerPos.distanceTo(MARKET_PITCHERS_POS) },
        { target: 'market-lemons', dist: this.playerPos.distanceTo(MARKET_LEMONS_POS) },
      ];
      candidates.sort((a, b) => a.dist - b.dist);
      if (candidates[0].dist < 2.25) return candidates[0].target;
      return null;
    }
    if (this.playerPos.distanceTo(OWN_STAND_POS) < 2.65) {
      return this.plotStatus === 'built' ? 'own-stand' : 'plot-lease';
    }
    if (this.playerPos.distanceTo(SELLER_STAND_POS) < 2.75) return 'seller-stand';
    return null;
  }

  private projectToScreen(pos: THREE.Vector3, yOffset = 2.1): { x: number; y: number } {
    const v = new THREE.Vector3(pos.x, pos.y + yOffset, pos.z);
    v.project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
    };
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsedTime += dt;

    // 1. Player KO animation, working behind counter, or normal movement
    const playerMat = this.playerSprite.material as THREE.SpriteMaterial;
    if (this.koTimer > 0) {
      this.koTimer -= dt;
      const progress = THREE.MathUtils.clamp(1 - this.koTimer / 1.4, 0, 1);
      const dizzyShake = Math.sin(this.elapsedTime * 36) * 0.035;

      playerMat.map = this.playerKoTex;
      playerMat.opacity = 1;
      this.playerSprite.position.set(this.playerPos.x + dizzyShake, PLAYER_SPRITE_H * 0.44, this.playerPos.z);
      this.playerShadow.position.set(this.playerPos.x, 0.022, this.playerPos.z + 0.04);

      // Float glowing soul wisp upward with gentle sine-wave sway and smooth fade-out
      this.soulSprite.visible = true;
      const soulMat = this.soulSprite.material as THREE.SpriteMaterial;
      soulMat.opacity = progress < 0.15 ? progress / 0.15 : Math.max(0, 1 - (progress - 0.15) / 0.85);
      this.soulSprite.position.set(
        this.playerPos.x + Math.sin(progress * Math.PI * 3.5) * 0.28,
        0.95 + progress * 2.15,
        this.playerPos.z + 0.12
      );

      if (this.koTimer <= 0) {
        this.koTimer = 0;
        this.soulSprite.visible = false;
        this.playerPos.x = this.playerPos.x < 0 ? -3.7 : 3.7;
        this.playerFacing = 'down';
        playerMat.map = this.playerFrames.down[0];
        this.playerSprite.position.set(this.playerPos.x, PLAYER_SPRITE_H * 0.48, this.playerPos.z);
        this.playerShadow.position.set(this.playerPos.x, 0.022, this.playerPos.z + 0.04);
        this.invulnTimer = 2.0;
      }
    } else if (this.workingAtStand) {
      this.playerAnimTimer += dt * 4.2;
      const workBob = Math.abs(Math.sin(this.playerAnimTimer * Math.PI)) * 0.05;
      const workFrame = Math.floor(this.playerAnimTimer) % 2 === 0 ? 0 : 1;
      playerMat.map = this.playerFrames.down[workFrame];
      playerMat.opacity = 1;
      this.playerSprite.position.set(
        OWN_STAND_POS.x,
        PLAYER_SPRITE_H * 0.48 + BEHIND_COUNTER_LIFT + workBob,
        OWN_STAND_POS.z - 0.62
      );
      const sScale = 1 - workBob * 1.1;
      this.playerShadow.scale.set(sScale, sScale, 1);
      this.playerShadow.position.set(OWN_STAND_POS.x, 0.265, OWN_STAND_POS.z - 0.58);
    } else {
      if (this.invulnTimer > 0) {
        this.invulnTimer = Math.max(0, this.invulnTimer - dt);
        playerMat.opacity = this.invulnTimer > 0 && Math.floor(this.elapsedTime * 14) % 2 === 0 ? 0.38 : 1;
      } else {
        playerMat.opacity = 1;
      }
      let dx = 0;
      let dz = 0;
      if (this.keys.has('w') || this.keys.has('arrowup')) dz -= 1;
      if (this.keys.has('s') || this.keys.has('arrowdown')) dz += 1;
      if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
      if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;

      if (dx === 0 && dz === 0 && this.playerTarget) {
        const diffX = this.playerTarget.x - this.playerPos.x;
        const diffZ = this.playerTarget.z - this.playerPos.z;
        const dist = Math.hypot(diffX, diffZ);
        if (dist > 0.15) {
          dx = diffX / dist;
          dz = diffZ / dist;
        } else {
          this.playerTarget = null;
        }
      }

      const moving = dx !== 0 || dz !== 0;
      if (moving) {
        const len = Math.hypot(dx, dz) || 1;
        const speed = 4.6;
        const nextX = THREE.MathUtils.clamp(this.playerPos.x + (dx / len) * speed * dt, -12.5, 12.5);
        const nextZ = THREE.MathUtils.clamp(this.playerPos.z + (dz / len) * speed * dt, -2.68, 8.2);

        let blocked = false;
        if (this.currentNeighborhood === 'market') {
          for (const stallPos of [MARKET_STALLS_POS, MARKET_PITCHERS_POS, MARKET_LEMONS_POS]) {
            if (Math.abs(nextX - stallPos.x) < 1.25 && Math.abs(nextZ - stallPos.z) < 0.5) {
              blocked = true;
              break;
            }
          }
        } else {
          const blockedOwn =
            this.plotStatus === 'built' &&
            Math.abs(nextX - (OWN_STAND_POS.x + 0.1)) < 1.3 &&
            Math.abs(nextZ - OWN_STAND_POS.z) < 0.5;
          const blockedSeller =
            Math.abs(nextX - (SELLER_STAND_POS.x - 0.1)) < 1.35 && Math.abs(nextZ - SELLER_STAND_POS.z) < 0.54;
          blocked = blockedOwn || blockedSeller;
        }

        if (!blocked) {
          this.playerPos.x = nextX;
          this.playerPos.z = nextZ;
        }

        if (Math.abs(dx) > Math.abs(dz)) {
          this.playerFacing = dx < 0 ? 'left' : 'right';
        } else {
          this.playerFacing = dz < 0 ? 'up' : 'down';
        }

        this.playerAnimTimer += dt * 7.8;
        const stepIdx = Math.floor(this.playerAnimTimer) % 2 === 0 ? 1 : 2;
        this.stepSoundCooldown -= dt;
        if (this.stepSoundCooldown <= 0) {
          this.stepSoundCooldown = 0.32;
          playStep();
        }
        (this.playerSprite.material as THREE.SpriteMaterial).map = this.playerFrames[this.playerFacing][stepIdx];
        const bounce = Math.abs(Math.sin(this.playerAnimTimer * Math.PI)) * 0.065;
        const shadowPulse = 1 - bounce * 1.4;
        this.playerSprite.position.set(this.playerPos.x, PLAYER_SPRITE_H * 0.48 + bounce, this.playerPos.z);
        this.playerShadow.scale.set(shadowPulse, shadowPulse, 1);
      } else {
        this.stepSoundCooldown = Math.max(0, this.stepSoundCooldown - dt);
        (this.playerSprite.material as THREE.SpriteMaterial).map = this.playerFrames[this.playerFacing][0];
        this.playerSprite.position.set(this.playerPos.x, PLAYER_SPRITE_H * 0.48, this.playerPos.z);
        this.playerShadow.scale.set(1, 1, 1);
      }
      this.playerShadow.position.set(this.playerPos.x, 0.022, this.playerPos.z + 0.04);
    }

    // 2. Smooth HD-2D camera follow (straight-on 3/4)
    const desiredCamX = THREE.MathUtils.clamp(this.playerPos.x * 0.78, -8.2, 8.2);
    const desiredCamZ = this.playerPos.z + 14.3;
    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, desiredCamX, 1 - Math.exp(-5 * dt));
    this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, desiredCamZ, 1 - Math.exp(-5 * dt));
    this.camera.lookAt(this.camera.position.x, 0.55, this.camera.position.z - 15.1);

    // 3. Celebratory golden/lemon pixel sparkle bursts above the stand
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const sp = this.sparkles[i];
      sp.life -= dt;
      if (sp.life <= 0) {
        this.scene.remove(sp.mesh);
        (sp.mesh.material as THREE.MeshBasicMaterial).dispose();
        this.sparkles.splice(i, 1);
        continue;
      }
      sp.vy -= 8.4 * dt;
      sp.mesh.position.x += sp.vx * dt;
      sp.mesh.position.y += sp.vy * dt;
      sp.mesh.position.z += sp.vz * dt;
      sp.mesh.rotation.x += 5.5 * dt;
      sp.mesh.rotation.y += 6.2 * dt;
      const ratio = sp.life / sp.maxLife;
      (sp.mesh.material as THREE.MeshBasicMaterial).opacity = ratio;
      sp.mesh.scale.setScalar(0.55 + ratio * 0.65);
    }

    // 4. 4-Direction NYC Traffic (with intersection yield logic + player KO collision check)
    if (this.taxiGroup.visible) {
      // Check if either North-South avenue vehicle is currently inside the cross-street intersection box (z in [1.4, 8.8])
      const avenueInIntersection = this.vehicles.some(
        (v) => v.axis === 'z' && v.group.position.z > 1.4 && v.group.position.z < 8.8
      );

      for (const v of this.vehicles) {
        let shouldYield = false;
        if (v.axis === 'x' && avenueInIntersection) {
          const vx = v.group.position.x;
          // Cross-street vehicles pause right before entering |x| < 3.4 while an avenue vehicle is crossing
          if ((v.dir === 1 && vx > -5.5 && vx < -2.6) || (v.dir === -1 && vx < 5.5 && vx > 2.6)) {
            shouldYield = true;
          }
        }

        if (!shouldYield) {
          if (v.axis === 'z') {
            v.group.position.z += v.dir * v.speed * dt;
            if (v.dir === 1 && v.group.position.z > v.maxBound) v.group.position.z = v.minBound;
            if (v.dir === -1 && v.group.position.z < v.minBound) v.group.position.z = v.maxBound;
          } else {
            v.group.position.x += v.dir * v.speed * dt;
            if (v.dir === 1 && v.group.position.x > v.maxBound) v.group.position.x = v.minBound;
            if (v.dir === -1 && v.group.position.x < v.minBound) v.group.position.x = v.maxBound;
          }
        }

        if (
          !this.workingAtStand &&
          this.koTimer <= 0 &&
          this.invulnTimer <= 0 &&
          Math.abs(this.playerPos.x - v.group.position.x) < v.halfX &&
          Math.abs(this.playerPos.z - v.group.position.z) < v.halfZ
        ) {
          this.koTimer = 1.4;
          this.playerTarget = null;
          this.soulSprite.visible = true;
          this.callbacks.onTaxiHit?.();
        }
      }
    }

    // 5. Pedestrians strolling, queuing in front of OWN_STAND_POS, and waiting with patience timers
    if (this.queueJoinCooldown > 0) this.queueJoinCooldown -= dt;

    let walkedOut = false;
    for (const ped of this.pedestrians) {
      if (ped.boughtCooldown > 0) ped.boughtCooldown -= dt;

      // Rare comedy taxi bonk recovery (1.2s X_X KO + floating soul -> pop onto nearest curb)
      if (ped.koTimer > 0) {
        ped.koTimer -= dt;
        const p = THREE.MathUtils.clamp(1 - ped.koTimer / 1.2, 0, 1);
        const shake = Math.sin(this.elapsedTime * 34 + ped.id) * 0.03;
        (ped.sprite.material as THREE.SpriteMaterial).map = this.pedKoTex;
        ped.sprite.position.set(ped.x + shake, PED_SPRITE_H * 0.44, ped.z);
        ped.shadow.position.set(ped.x, 0.022, ped.z + 0.04);

        ped.soulSprite.visible = true;
        const sm = ped.soulSprite.material as THREE.SpriteMaterial;
        sm.opacity = p < 0.15 ? p / 0.15 : Math.max(0, 1 - (p - 0.15) / 0.85);
        ped.soulSprite.position.set(
          ped.x + Math.sin(p * Math.PI * 3) * 0.22,
          0.85 + p * 1.75,
          ped.z + 0.08
        );

        if (ped.koTimer <= 0) {
          ped.koTimer = 0;
          ped.soulSprite.visible = false;
          ped.x = ped.vx > 0 ? 3.2 : -3.2;
          const dir = ped.vx < 0 ? 'left' : 'right';
          (ped.sprite.material as THREE.SpriteMaterial).map = ped.frames[dir][0];
          ped.sprite.position.set(ped.x, PED_SPRITE_H * 0.48, ped.z);
          ped.shadow.position.set(ped.x, 0.022, ped.z + 0.04);
        }
        continue;
      }

      if (ped.state === 'walking-to-slot' && ped.queueSlot >= 0) {
        const slot = QUEUE_SLOTS[ped.queueSlot];
        const dx = slot.x - ped.x;
        const dz = slot.z - ped.z;
        const dist = Math.hypot(dx, dz);

        if (dist <= 0.09) {
          ped.x = slot.x;
          ped.z = slot.z;
          ped.state = 'queued';
          (ped.sprite.material as THREE.SpriteMaterial).map = ped.frames.up[0];
          ped.sprite.position.set(ped.x, PED_SPRITE_H * 0.48, ped.z);
          ped.shadow.scale.set(1, 1, 1);
          ped.shadow.position.set(ped.x, 0.022, ped.z + 0.04);
        } else {
          const step = ped.speed * 1.15 * dt;
          ped.x += (dx / dist) * Math.min(step, dist);
          ped.z += (dz / dist) * Math.min(step, dist);
          ped.animTimer += dt * 6.8;
          const f = Math.floor(ped.animTimer) % 2 === 0 ? 1 : 2;
          const dir = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 'left' : 'right') : dz < 0 ? 'up' : 'down';
          const hop = Math.abs(Math.sin(ped.animTimer * Math.PI)) * 0.055;
          (ped.sprite.material as THREE.SpriteMaterial).map = ped.frames[dir][f];
          ped.sprite.position.set(ped.x, PED_SPRITE_H * 0.48 + hop, ped.z);
          ped.shadow.scale.set(1 - hop * 1.4, 1 - hop * 1.4, 1);
          ped.shadow.position.set(ped.x, 0.022, ped.z + 0.04);
        }
        continue;
      }

      if (ped.state === 'queued') {
        ped.patience -= dt;
        // Subtle impatient fidget when patience gets low
        const lowPatience = ped.patience < ped.maxPatience * 0.35;
        const fidget = lowPatience ? Math.abs(Math.sin(this.elapsedTime * 11 + ped.id)) * 0.04 : 0;
        (ped.sprite.material as THREE.SpriteMaterial).map = ped.frames.up[0];
        ped.sprite.position.set(ped.x, PED_SPRITE_H * 0.48 + fidget, ped.z);
        ped.shadow.scale.set(1, 1, 1);
        ped.shadow.position.set(ped.x, 0.022, ped.z + 0.04);

        if (ped.patience <= 0) {
          const qIdx = this.queue.indexOf(ped);
          if (qIdx >= 0) this.queue.splice(qIdx, 1);
          ped.state = 'leaving';
          ped.queueSlot = -1;
          ped.boughtCooldown = 10 + this.rng.gameplay() * 4;
          ped.vx = (this.rng.gameplay() > 0.5 ? 1 : -1) * ped.speed * 1.25;
          walkedOut = true;
          this.callbacks.onCustomerWalkout?.();
        }
        continue;
      }

      if (ped.state === 'leaving') {
        const dz = ped.homeZ - ped.z;
        if (Math.abs(dz) > 0.08) {
          ped.z += Math.sign(dz) * ped.speed * dt;
        } else {
          ped.z = ped.homeZ;
          ped.state = 'strolling';
        }
      }

      // Smart curb-wait (~80% careful pedestrians) or rare comedy taxi bonk (~20% distracted pedestrians)
      if (this.taxiGroup.visible) {
        const approachingAvenue =
          (ped.vx > 0 && ped.x > -3.5 && ped.x < -2.6) ||
          (ped.vx < 0 && ped.x < 3.5 && ped.x > 2.6);

        const avenueCarApproaching = this.vehicles.some(
          (v) =>
            v.axis === 'z' &&
            ((v.dir === 1 && v.group.position.z > ped.z - 6.8 && v.group.position.z < ped.z + 2.5) ||
              (v.dir === -1 && v.group.position.z < ped.z + 6.8 && v.group.position.z > ped.z - 2.5))
        );

        if (ped.careful && approachingAvenue && avenueCarApproaching) {
          const waitDir = ped.vx < 0 ? 'left' : 'right';
          (ped.sprite.material as THREE.SpriteMaterial).map = ped.frames[waitDir][0];
          ped.sprite.position.set(ped.x, PED_SPRITE_H * 0.48, ped.z);
          ped.shadow.scale.set(1, 1, 1);
          ped.shadow.position.set(ped.x, 0.022, ped.z + 0.04);
          continue;
        }

        const hitByCar = this.vehicles.some(
          (v) =>
            Math.abs(ped.x - v.group.position.x) < v.halfX * 0.9 &&
            Math.abs(ped.z - v.group.position.z) < v.halfZ * 0.9
        );
        if (!ped.careful && hitByCar) {
          ped.koTimer = 1.2;
          ped.soulSprite.visible = true;
          continue;
        }
      }

      ped.x += ped.vx * dt;
      // One-way despawn & fresh off-screen respawn (no back-and-forth bouncing!)
      if (ped.x < -18.2 || ped.x > 18.2) {
        this.respawnPedestrianOffscreen(ped);
        continue;
      }

      // Join queue in front of stand ONLY when stand is built & open (NO auto-selling!)
      if (
        ped.state === 'strolling' &&
        this.currentNeighborhood !== 'market' &&
        this.plotStatus === 'built' &&
        this.standOpen &&
        ped.canBuy &&
        ped.boughtCooldown <= 0 &&
        this.queue.length < QUEUE_SLOTS.length &&
        this.queueJoinCooldown <= 0 &&
        Math.abs(ped.x - OWN_STAND_POS.x) < 2.6
      ) {
        ped.queueSlot = this.queue.length;
        ped.state = 'walking-to-slot';
        ped.patience = QUEUE_MAX_PATIENCE;
        ped.maxPatience = QUEUE_MAX_PATIENCE;
        this.queue.push(ped);
        this.queueJoinCooldown = 2.6 + this.rng.gameplay() * 2.2;
        continue;
      }

      ped.animTimer += dt * 6.5;
      const f = Math.floor(ped.animTimer) % 2 === 0 ? 1 : 2;
      const dir = ped.vx < 0 ? 'left' : 'right';
      const hop = Math.abs(Math.sin(ped.animTimer * Math.PI)) * 0.06;
      const pedShadowScale = 1 - hop * 1.4;
      (ped.sprite.material as THREE.SpriteMaterial).map = ped.frames[dir][f];
      ped.sprite.position.set(ped.x, PED_SPRITE_H * 0.48 + hop, ped.z);
      ped.shadow.scale.set(pedShadowScale, pedShadowScale, 1);
      ped.shadow.position.set(ped.x, 0.022, ped.z + 0.04);
    }

    if (walkedOut) {
      this.shuffleQueueForward();
    }

    this.postfx.render(dt);
    // Centre the tilt-shift sharp band on the player's body (0.9 units up from
    // the feet), as a 0..1 fraction of the canvas height. Uses last-frame-
    // equivalent state; PostFx smooths it, so the one-frame lag is invisible.
    this.postfx.setFocusScreenY(
      this.projectToScreen(this.playerPos, 0.9).y / Math.max(this.container.clientHeight, 1)
    );

    // 6. Update projected screen anchors for floating UI prompts, toasts & customer patience bars
    const queueAnchors: QueuedCustomerAnchor[] = this.queue.map((ped, idx) => {
      const screen = this.projectToScreen(new THREE.Vector3(ped.x, 0, ped.z), 1.62);
      return {
        id: ped.id,
        x: screen.x,
        y: screen.y,
        patienceRatio: THREE.MathUtils.clamp(ped.patience / ped.maxPatience, 0, 1),
        isFront: idx === 0,
      };
    });

    this.callbacks.onAnchorsUpdate({
      ownStand: this.projectToScreen(OWN_STAND_POS, 2.05),
      sellerStand: this.projectToScreen(SELLER_STAND_POS, 2.05),
      player: this.projectToScreen(this.playerPos, 1.8),
      nearby: this.getNearbyTarget(),
      queue: queueAnchors,
      marketAnchors: {
        stalls: this.projectToScreen(MARKET_STALLS_POS, 1.95),
        pitchers: this.projectToScreen(MARKET_PITCHERS_POS, 1.95),
        lemons: this.projectToScreen(MARKET_LEMONS_POS, 1.95),
      },
    });
  };

  /**
   * Free everything this scene put on the GPU, then release the WebGL context.
   *
   * Why this is needed: three.js uploads each geometry, material program and
   * texture to the graphics card the first time it is drawn. JavaScript garbage
   * collection never frees that GPU memory; only an explicit `.dispose()` does.
   * `renderer.dispose()` alone just releases the renderer's own caches, so every
   * scene rebuild (React StrictMode remounts, hot reload) used to leak the whole
   * town's worth of textures.
   *
   * Strategy: collect every resource into ONE Set (so a resource shared by many
   * meshes is disposed exactly once), then dispose them all. Three kinds of
   * resources are reachable from the scene graph (geometry, material, textures
   * on a material); a fourth kind is held only in fields (frame banks, shared
   * materials), so those are added explicitly.
   */
  private disposeGpuResources(): void {
    const resources = new Set<{ dispose(): void }>();

    // Every texture slot a three.js material can carry. Listed explicitly because
    // a material stores its textures as plain properties, not in a collection.
    const TEXTURE_SLOTS = [
      'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap',
      'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap',
      'specularMap', 'gradientMap', 'clearcoatMap', 'clearcoatNormalMap',
      'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap',
      'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap',
    ] as const;

    const addMaterial = (material: THREE.Material | undefined): void => {
      if (!material) return;
      resources.add(material);
      const slots = material as unknown as Record<string, unknown>;
      for (const slot of TEXTURE_SLOTS) {
        const value = slots[slot];
        if (value instanceof THREE.Texture) resources.add(value);
      }
    };

    // 1. Everything reachable from the scene graph.
    this.scene.traverse((obj) => {
      const renderable = obj as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      if (renderable.geometry) resources.add(renderable.geometry);
      if (Array.isArray(renderable.material)) renderable.material.forEach(addMaterial);
      else addMaterial(renderable.material);
    });

    // 2. Resources held only in fields (not necessarily attached to a visible object).
    resources.add(this.sparkleGeo);
    addMaterial(this.streetlampBulbMat);
    addMaterial(this.contactShadowMat);
    addMaterial(this.streetSignAMat);
    addMaterial(this.streetSignBMat);
    for (const tex of [this.summerTreeTex, this.autumnTreeTex, this.playerKoTex, this.pedKoTex]) {
      if (tex) resources.add(tex);
    }
    for (const dir of ['down', 'up', 'left', 'right'] as const) {
      for (const tex of this.playerFrames?.[dir] ?? []) resources.add(tex);
    }
    for (const byDirection of Object.values(this.pedSpriteBank ?? {})) {
      for (const frames of Object.values(byDirection)) {
        for (const tex of frames) resources.add(tex);
      }
    }
    // Sale sparkles each own a private material that is only freed when they expire.
    for (const sparkle of this.sparkles) addMaterial(sparkle.mesh.material as THREE.Material);

    resources.forEach((r) => r.dispose());
  }

  public dispose(): void {
    // Guard against double-dispose: a second call would touch a dead renderer.
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.disposeGpuResources();
    this.postfx.dispose();
    this.renderer.dispose();
    // Ask the browser to drop the WebGL context now instead of waiting for GC;
    // browsers cap live contexts (~16) and warn when a page leaks them.
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
