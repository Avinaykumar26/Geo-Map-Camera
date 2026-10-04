/**
 * Camera access helpers around `navigator.mediaDevices.getUserMedia`.
 * Front/rear switching uses an exact deviceId when we have one (labels only
 * become readable after permission is granted) and falls back to facingMode.
 */

const IDEAL_RESOLUTION = { width: { ideal: 3840 }, height: { ideal: 2160 } };

export const FAILURE_HINTS = {
  insecure: {
    title: 'HTTPS required',
    hint: 'Browsers only expose the camera on secure origins. Open this page over HTTPS.',
  },
  unsupported: {
    title: 'Camera API unavailable',
    hint: 'This browser does not expose navigator.mediaDevices. Try Chrome, Edge or Safari.',
  },
  denied: {
    title: 'Camera permission denied',
    hint: 'Tap the lock icon in the address bar, allow the camera, then reload.',
  },
  missing: {
    title: 'No camera found',
    hint: 'Connect a camera or check that another app is not already using it.',
  },
  busy: {
    title: 'Camera is in use',
    hint: 'Close other apps that might be holding the camera, then try again.',
  },
  unknown: { title: 'Camera error', hint: 'The camera could not be started. Try again.' },
};

export function describeCameraFailure(error) {
  if (!globalThis.isSecureContext) return { code: 'insecure', ...FAILURE_HINTS.insecure };
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { code: 'denied', ...FAILURE_HINTS.denied };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { code: 'missing', ...FAILURE_HINTS.missing };
    case 'NotReadableError':
    case 'TrackStartError':
      return { code: 'busy', ...FAILURE_HINTS.busy };
    default:
      return { code: 'unknown', ...FAILURE_HINTS.unknown, detail: error?.message };
  }
}

function constraintsFor({ facingMode, deviceId }) {
  const video = deviceId
    ? { deviceId: { exact: deviceId }, ...IDEAL_RESOLUTION }
    : { facingMode: { ideal: facingMode ?? 'environment' }, ...IDEAL_RESOLUTION };
  return { video, audio: false };
}

/**
 * @param {{facingMode?: string, deviceId?: string}} [options]
 * @returns {Promise<MediaStream>}
 */
export async function openCamera({ facingMode = 'environment', deviceId = null } = {}) {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!globalThis.isSecureContext) throw Object.assign(new Error('insecure context'), { name: 'InsecureContext' });
  if (!mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('getUserMedia unsupported'), { name: 'UnsupportedError' });
  }

  const attempts = [];
  if (deviceId) attempts.push({ deviceId });
  attempts.push({ facingMode });
  attempts.push({}); // last resort: whatever the browser gives us

  let lastError = null;
  for (const attempt of attempts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await mediaDevices.getUserMedia(constraintsFor(attempt));
    } catch (error) {
      lastError = error;
      if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') throw error;
    }
  }
  throw lastError ?? new Error('camera unavailable');
}

/** Video input devices, annotated with a best-guess facing. */
export async function listVideoInputs() {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  if (!mediaDevices?.enumerateDevices) return [];
  const devices = await mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${device.deviceId.slice(0, 4) || '?'}`,
      facing: guessFacing(device.label),
    }));
}

export function guessFacing(label = '') {
  const text = label.toLowerCase();
  if (/back|rear|environment|world|main|camera2 0|facing back/.test(text)) return 'environment';
  if (/front|face|user|selfie|facing front/.test(text)) return 'user';
  return null;
}

/** Inspect the active track so the UI can label the current camera. */
export function streamInfo(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return null;
  const settings = track.getSettings?.() ?? {};
  const capabilities = track.getCapabilities?.() ?? {};
  return {
    label: track.label || 'Camera',
    deviceId: settings.deviceId ?? null,
    facing: settings.facingMode ?? guessFacing(track.label) ?? null,
    width: settings.width ?? null,
    height: settings.height ?? null,
    hasTorch: Boolean(capabilities.torch),
  };
}

export function stopStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}
