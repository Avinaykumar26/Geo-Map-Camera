/**
 * Geo Map Camera — app controller.
 *
 * Wiring only: every rule lives in src/lib/* and is unit tested there.
 */

import {
  describeCameraFailure,
  listVideoInputs,
  openCamera,
  stopStream,
  streamInfo,
} from './lib/camera.js';
import { captureStampedPhoto } from './lib/capture.js';
import { createDemoCamera, createDemoGeo } from './lib/demo.js';
import { downloadBlob, formatBytes } from './lib/download.js';
import { formatAccuracy, formatCoords, formatTimestamp } from './lib/format.js';
import { createAddressResolver, watchPosition } from './lib/geo.js';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, sanitizeSettings } from './lib/settings.js';
import { drawPlaceholderMap, drawStaticMap, haversineDistance, planMap } from './lib/staticmap.js';
import { createTileLoader } from './lib/tiles.js';

const $ = (id) => document.getElementById(id);

const els = {
  intro: $('screen-intro'),
  camera: $('screen-camera'),
  review: $('screen-review'),
  start: $('start'),
  startDemo: $('start-demo'),
  embedNote: $('embed-note'),
  video: $('viewfinder'),
  hudMap: $('hud-map'),
  hudCoords: $('hud-coords'),
  hudAddress: $('hud-address'),
  hudTime: $('hud-time'),
  status: $('status'),
  fatal: $('fatal'),
  fatalTitle: $('fatal-title'),
  fatalHint: $('fatal-hint'),
  fatalRetry: $('fatal-retry'),
  fatalDemo: $('fatal-demo'),
  shutter: $('shutter'),
  flip: $('flip'),
  last: $('last'),
  previewImage: $('preview-image'),
  previewMeta: $('preview-meta'),
  retake: $('retake'),
  save: $('save'),
  settings: $('settings'),
  openSettings: $('open-settings'),
  resetSettings: $('reset-settings'),
  toast: $('toast'),
};

const tileLoader = createTileLoader();
const addressResolver = createAddressResolver();

const state = {
  settings: loadSettings(),
  stream: null,
  watch: null,
  info: null,
  cameras: [],
  activeDeviceId: null,
  point: null,
  address: null,
  lastCapture: null,
  previewUrl: null,
  mapPoint: null,
  hudTimer: 0,
  toastTimer: 0,
  running: false,
  capturing: false,
  demo: false,
  demoCamera: null,
  demoGeo: null,
};

const isEmbedded = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin top access throws -> we are embedded
  }
};

/* --------------------------------- screens -------------------------------- */

function show(screen) {
  for (const node of [els.intro, els.camera, els.review]) {
    node.hidden = node !== screen;
  }
  if (screen === els.review) stopHudClock();
  else if (screen === els.camera) startHudClock();
}

function setStatus(message, tone = '') {
  els.status.textContent = message ?? '';
  if (tone) els.status.dataset.tone = tone;
  else delete els.status.dataset.tone;
}

function showFatal({ title, hint }) {
  els.fatalTitle.textContent = title;
  let message = hint;
  if (isEmbedded() && title !== 'HTTPS required') {
    message += ' Embedded previews usually block the camera — try opening this page in its own tab, or use demo mode.';
  }
  els.fatalHint.textContent = message;
  els.fatal.hidden = false;
}

function hideFatal() {
  els.fatal.hidden = true;
}

function toast(message, tone = '') {
  els.toast.textContent = message;
  if (tone) els.toast.dataset.tone = tone;
  else delete els.toast.dataset.tone;
  els.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3600);
}

/* --------------------------------- camera --------------------------------- */

async function playVideo() {
  try {
    const pending = els.video.play();
    if (pending && typeof pending.catch === 'function') await pending.catch(() => {});
  } catch {
    /* autoplay policy or stubbed media element — non-fatal */
  }
}

function stopDemo() {
  state.demoGeo?.stop();
  state.demoCamera?.stop();
  state.demoGeo = null;
  state.demoCamera = null;
  state.demo = false;
}

/** Synthetic camera + GPS for environments where the real camera is blocked. */
async function startDemo() {
  stopStream(state.stream);
  state.watch?.stop();
  stopDemo();

  const demoCamera = createDemoCamera();
  if (!demoCamera.supported) {
    toast('Demo mode needs canvas.captureStream, which this browser lacks.', 'error');
    return;
  }
  state.demoCamera = demoCamera;
  state.demo = true;
  state.stream = demoCamera.stream;
  state.info = { facing: 'environment', label: 'Demo scene', width: demoCamera.width, height: demoCamera.height };

  els.video.srcObject = state.stream;
  await playVideo();

  hideFatal();
  show(els.camera);
  setStatus('Demo mode — simulated camera & GPS (MG Road, Bengaluru)', 'warn');

  state.demoGeo = createDemoGeo();
  state.demoGeo.start(handleFix);
  state.running = true;
}

async function startCamera() {
  stopDemo();
  hideFatal();
  setStatus('Starting camera…');
  try {
    stopStream(state.stream);
    state.stream = await openCamera({
      facingMode: state.info?.facing === 'user' ? 'user' : 'environment',
      deviceId: state.activeDeviceId ?? null,
    });
    state.activeDeviceId = null;
    els.video.srcObject = state.stream;
    await playVideo();
    state.info = streamInfo(state.stream);
    state.cameras = await listVideoInputs().catch(() => []);
    els.flip.disabled = state.cameras.length < 2;
    setStatus(cameraLabel());
    state.running = true;
  } catch (error) {
    state.running = false;
    const failure = describeCameraFailure(error);
    setStatus('');
    showFatal(failure);
  }
}

function cameraLabel() {
  if (state.demo) {
    return `Demo scene · ${state.info?.width ?? 1280}×${state.info?.height ?? 720}`;
  }
  const facing = state.info?.facing === 'user' ? 'Front camera' : 'Rear camera';
  const size = state.info?.width ? ` · ${state.info.width}×${state.info.height}` : '';
  return `${facing}${size}`;
}

async function flipCamera() {
  if (state.demo) {
    state.demoCamera?.flip();
    setStatus('Demo scene mirrored');
    return;
  }
  const current = state.info?.facing ?? 'environment';
  const wanted = current === 'user' ? 'environment' : 'user';
  const target = els.cameras.find((camera) => camera.facing === wanted);
  state.activeDeviceId = target?.deviceId ?? null;
  if (state.info) state.info = { ...state.info, facing: wanted };
  await startCamera();
}

/* ------------------------------- geolocation ------------------------------- */

function startGeolocation() {
  if (!('geolocation' in navigator)) {
    setStatus('This browser has no geolocation support', 'warn');
    return;
  }
  state.watch?.stop();
  state.watch = watchPosition(navigator.geolocation, {
    onUpdate: handleFix,
    onError: (error) => setStatus(`${error.title} — ${error.hint}`, 'warn'),
  });
}

function handleFix(point) {
  const moved = state.mapPoint ? haversineDistance(state.mapPoint, point) : Infinity;
  state.point = point;
  refreshHud();
  if (moved > 15 || !state.mapPoint) {
    state.mapPoint = point;
    refreshHudMap();
  }
  addressResolver.resolve(point).then((address) => {
    if (!address) return;
    state.address = address;
    refreshHud();
  });
}

function refreshHud() {
  const { settings, point } = state;
  els.hudCoords.textContent =
    point && Number.isFinite(point.lat)
      ? formatCoords(point, { format: settings.coordFormat, decimals: settings.coordDecimals })
      : 'Waiting for GPS…';
  els.hudAddress.textContent = settings.showAddress ? (state.address?.short ?? '') : '';

  const accuracy =
    settings.showAccuracy && point?.accuracy != null ? formatAccuracy(point.accuracy) : '';
  els.hudTime.textContent = [
    settings.showTimestamp
      ? formatTimestamp(new Date(), {
          format: settings.dateFormat,
          hour12: settings.hour12,
          showSeconds: settings.showSeconds,
          showTimezone: settings.showTimezone,
        })
      : '',
    accuracy,
  ]
    .filter(Boolean)
    .join('  ·  ');

  if (point?.accuracy != null && point.accuracy > 60) {
    setStatus(`GPS accuracy is low (${formatAccuracy(point.accuracy)})`, 'warn');
  } else if (state.running) {
    setStatus(cameraLabel());
  }
}

function startHudClock() {
  stopHudClock();
  state.hudTimer = setInterval(refreshHud, 1000);
}

function stopHudClock() {
  clearInterval(state.hudTimer);
  state.hudTimer = 0;
}

async function refreshHudMap() {
  const point = state.point;
  if (!point || !Number.isFinite(point.lat)) return;
  const canvas = els.hudMap;
  const ctx = canvas.getContext('2d');
  const plan = planMap({
    lat: point.lat,
    lon: point.lon,
    zoom: state.settings.mapZoom,
    width: canvas.width,
    height: canvas.height,
  });
  const result = await drawStaticMap(ctx, plan, tileLoader.loadTile);
  if (!result.ok) drawPlaceholderMap(ctx, plan);
}

/* -------------------------------- capture --------------------------------- */

async function capture() {
  if (state.capturing) return;
  state.capturing = true;
  els.shutter.disabled = true;
  try {
    const result = await captureStampedPhoto({
      video: els.video,
      point: state.point,
      address: state.address,
      settings: state.settings,
      deps: { loadTile: tileLoader.loadTile },
    });
    revokePreview();
    state.lastCapture = result;
    state.previewUrl = URL.createObjectURL(result.blob);
    els.previewImage.src = state.previewUrl;
    els.previewMeta.textContent = `${result.filename} · ${formatBytes(result.blob.size)}${
      result.map?.placeholder ? ' · map tiles unavailable' : ''
    }${result.data.hasFix ? '' : ' · no GPS fix'}`;
    els.last.disabled = false;
    show(els.review);
  } catch (error) {
    toast(error?.message || 'Could not capture that frame', 'error');
  } finally {
    state.capturing = false;
    els.shutter.disabled = false;
  }
}

function revokePreview() {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = null;
}

function saveLast() {
  if (!state.lastCapture) return;
  try {
    downloadBlob(state.lastCapture.blob, state.lastCapture.filename);
    toast(`Saved ${state.lastCapture.filename}`);
  } catch {
    toast('This browser blocked the download', 'error');
  }
}

function retake() {
  revokePreview();
  show(els.camera);
  refreshHud();
}

/* -------------------------------- settings -------------------------------- */

function syncSettingsUI() {
  for (const input of document.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    const value = state.settings[key];
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else input.value = String(value);
  }
  for (const output of document.querySelectorAll('[data-output]')) {
    const key = output.dataset.output;
    output.textContent =
      key === 'jpegQuality' ? `${Math.round(state.settings[key] * 100)}%` : String(state.settings[key]);
  }
}

function onSettingChange(event) {
  const input = event.target.closest('[data-setting]');
  if (!input) return;
  const key = input.dataset.setting;
  const raw = input.type === 'checkbox' ? input.checked : input.value;
  state.settings = sanitizeSettings({ ...state.settings, [key]: raw });
  saveSettings(state.settings);
  syncSettingsUI();
  refreshHud();
  if (key === 'mapZoom') refreshHudMap();
}

function openSettings(open) {
  els.settings.hidden = !open;
  els.openSettings.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) els.settings.querySelector('input, select, button')?.focus();
}

/* --------------------------------- wiring --------------------------------- */

async function start() {
  show(els.camera);
  await startCamera();
  startGeolocation();
  refreshHud();
}

function bind() {
  els.start.addEventListener('click', start);
  els.startDemo.addEventListener('click', startDemo);
  els.fatalDemo.addEventListener('click', startDemo);
  els.fatalRetry.addEventListener('click', start);
  els.shutter.addEventListener('click', capture);
  els.flip.addEventListener('click', flipCamera);
  els.last.addEventListener('click', saveLast);
  els.save.addEventListener('click', saveLast);
  els.retake.addEventListener('click', retake);
  els.openSettings.addEventListener('click', () => openSettings(els.settings.hidden));
  els.resetSettings.addEventListener('click', () => {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings(state.settings);
    syncSettingsUI();
    refreshHud();
    toast('Settings reset');
  });
  els.settings.addEventListener('change', onSettingChange);
  els.settings.addEventListener('input', (event) => {
    if (event.target.type === 'range') onSettingChange(event);
  });
  els.settings.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-settings]')) openSettings(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.settings.hidden) openSettings(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopHudClock();
      stopStream(state.stream);
      state.stream = null;
      state.running = false;
    } else if (!els.camera.hidden && !state.stream) {
      if (state.demo) startDemo();
      else startCamera();
      startHudClock();
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline support is a nice-to-have, never a blocker */
    });
  });
}

function init() {
  syncSettingsUI();
  bind();
  registerServiceWorker();
  els.embedNote.hidden = !isEmbedded();
  show(els.intro);
  if (!globalThis.isSecureContext) {
    show(els.camera);
    showFatal(describeCameraFailure(new Error('insecure')));
  }
}

init();
