import { IDENTITY_LIMITS, fitWithin } from './report-identity-model';

/** El logo listo para enviar, o por qué no se pudo preparar (clave de idioma). */
export type PreparedLogo =
  | {
      readonly ok: true;
      readonly data: string;
      readonly contentType: string;
      readonly width: number;
      readonly height: number;
    }
  | { readonly ok: false; readonly problem: string };

const ACCEPTED = /^image\/(png|jpeg|webp|svg\+xml)$/;
const EXTENSIONS = /\.(png|jpe?g|webp|svg)$/i;

/**
 * Prepara un logo elegido por el usuario para guardarlo.
 *
 * Se dibuja en un lienzo reducido a 1.200 × 400 como mucho y se guarda en un
 * formato de mapa de bits. Así un SVG se convierte en PNG —cargado en un
 * `<img>`, sus scripts no se ejecutan, y lo que se guarda ya no los tiene— y un
 * JPEG de una cámara no llega con 8 MB. JPEG se queda en JPEG; el resto va a
 * PNG para conservar la transparencia y, si no cabe, a WebP.
 */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  if (!ACCEPTED.test(file.type) && !EXTENSIONS.test(file.name)) {
    return { ok: false, problem: 'reports.identity.logo.type' };
  }

  const url = URL.createObjectURL(file);

  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    // Un SVG sin tamaño propio se dibuja al máximo que admite el logo.
    const width = image.naturalWidth || IDENTITY_LIMITS.logoWidth;
    const height = image.naturalHeight || IDENTITY_LIMITS.logoHeight;
    const size = fitWithin(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext('2d')!.drawImage(image, 0, 0, size.width, size.height);

    const jpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
    const tries: [string, number?][] = jpeg
      ? [
          ['image/jpeg', 0.9],
          ['image/jpeg', 0.75],
        ]
      : [['image/png'], ['image/webp', 0.9]];

    for (const [type, quality] of tries) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, type, quality),
      );

      if (blob && blob.type === type && blob.size <= IDENTITY_LIMITS.logoBytes) {
        return { ok: true, data: await base64(blob), contentType: type, ...size };
      }
    }

    return { ok: false, problem: 'reports.identity.logo.size' };
  } catch {
    return { ok: false, problem: 'reports.identity.logo.unreadable' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Una imagen que se puede pintar a partir del logo que devuelve la API. */
export function logoUrl(logo: { readonly contentType?: string; readonly data: string }): string {
  return `data:${logo.contentType ?? 'image/png'};base64,${logo.data}`;
}
