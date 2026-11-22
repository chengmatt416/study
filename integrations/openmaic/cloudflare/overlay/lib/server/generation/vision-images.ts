import image from '@/lib/study-workers/images';
import { parseBase64DataUrl, type GenerationLogger } from '@openmaic/generation';
import { MAX_VISION_IMAGE_BASE64_BYTES, MAX_VISION_IMAGE_DIMENSION } from '@/lib/constants/generation';
interface VisionImage { id: string; src: string; width?: number; height?: number }
export async function prepareVisionImages<T extends VisionImage>(images: readonly T[], log: Pick<GenerationLogger, 'info' | 'warn'>): Promise<Array<T & VisionImage>> {
  const result: Array<T & VisionImage> = [];
  for (const value of images) {
    const parsed = parseBase64DataUrl(value.src);
    if (!parsed) { result.push(value); continue; }
    try {
      const source = Buffer.from(parsed.base64, 'base64');
      let accepted = false;
      for (const quality of [82,65,45,30,20]) {
        const output = await image(source).rotate().resize({ width: MAX_VISION_IMAGE_DIMENSION, height: MAX_VISION_IMAGE_DIMENSION, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer({ resolveWithObject: true });
        if (Math.ceil(output.data.byteLength / 3) * 4 > MAX_VISION_IMAGE_BASE64_BYTES) continue;
        result.push({ ...value, src: `data:image/jpeg;base64,${output.data.toString('base64')}`, width: output.info.width, height: output.info.height });
        accepted = true; break;
      }
      if (!accepted) throw new Error('Encoded image exceeds the vision base64 payload cap');
    } catch (error) { log.warn('Dropped vision image', { id: value.id, reason: error instanceof Error ? error.message : 'Image preparation failed' }); }
  }
  return result;
}
