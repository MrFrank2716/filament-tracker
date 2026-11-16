/**
 * Reading QR codes (and, where the browser can, ordinary barcodes) from the camera.
 * Uses the browser's own detector when it has one; otherwise a small decoder loaded only when a scan starts,
 * which covers iPhones and most desktop browsers.
 */

interface DetectedCode {
  rawValue: string;
}
interface Detector {
  detect(source: CanvasImageSource): Promise<DetectedCode[]>;
}
interface DetectorClass {
  new (options?: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Product and shelf barcodes worth reading when the browser can; a QR code is always read. */
const WANTED = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'data_matrix'];

/** Cameras only work on a secure address (https, or localhost while developing). */
export const cameraAvailable = (): boolean => window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);

type Read = (source: HTMLVideoElement) => Promise<string | null>;

async function nativeReader(): Promise<Read | null> {
  const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!Native) return null;
  try {
    const supported = (await Native.getSupportedFormats?.()) ?? ['qr_code'];
    if (!supported.includes('qr_code')) return null;
    const detector = new Native({ formats: WANTED.filter((format) => supported.includes(format)) });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

/** Frames are shrunk to this width before decoding: plenty for a label held up to the camera, and quick. */
const DECODE_WIDTH = 640;

async function fallbackReader(): Promise<Read> {
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (!context || !video.videoWidth) return null;
    const scale = Math.min(1, DECODE_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data || null;
  };
}

/** Why the camera could not be used, in words for the person holding the phone. */
export function cameraProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Wrkbench is not allowed to use the camera. Allow camera access for this site in your browser, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is in use by another app.';
  return 'The camera could not be started.';
}

/**
 * Show the camera in `video` and call `onRead` with whatever each code holds, until the returned function
 * is called. The same code is reported again only after it has left the picture or a few seconds have passed,
 * so holding a label steady does not fire repeatedly.
 */
export async function startScanner(video: HTMLVideoElement, onRead: (text: string) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  let stopped = false;
  let timer = 0;
  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    // Only if the picture is still ours: a scanner started just after this one may already be showing in it.
    if (video.srcObject === stream) video.srcObject = null;
  };
  try {
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.muted = true;
    await video.play();
    const read = (await nativeReader()) ?? (await fallbackReader());
    let last = '';
    let lastAt = 0;
    const tick = async () => {
      if (stopped) return;
      let text: string | null = null;
      try {
        text = await read(video);
      } catch {
        // A frame that cannot be read is just skipped.
      }
      const now = Date.now();
      if (text && (text !== last || now - lastAt > 3000)) {
        last = text;
        lastAt = now;
        onRead(text);
      } else if (text) lastAt = now;
      if (!stopped) timer = window.setTimeout(tick, 160);
    };
    void tick();
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
