/**
 * Image-picker capability: pick from the library or capture with the
 * system camera UI, returning a multipart-ready file part.
 *
 * Everything is normalised to JPEG before it leaves this module. iPhones
 * store photos as HEIC by default, which the analysis endpoints cannot
 * read, and asking members to change a camera setting is not a fix. EXIF
 * stripping stays server-side, so the app needs no scrubber of its own.
 */

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export interface PickedImage {
  uri: string;
  fileName: string;
  mimeType: string;
}

/** Longest edge of an uploaded photo. Plenty for analysis, far smaller than a
 *  12MP original, so uploads finish on a phone connection. */
const MAX_EDGE = 1600;

async function toJpeg(uri: string): Promise<{ uri: string }> {
  return ImageManipulator.manipulateAsync(uri, [{ resize: { width: MAX_EDGE } }], {
    compress: 0.82,
    format: ImageManipulator.SaveFormat.JPEG,
  });
}

async function fromResult(result: ImagePicker.ImagePickerResult): Promise<PickedImage | null> {
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];

  // Convert unconditionally: HEIC, PNG and oversized JPEGs all become a
  // modest JPEG, so the upload path has exactly one shape to handle.
  try {
    const converted = await toJpeg(asset.uri);
    return {
      uri: converted.uri,
      fileName: (asset.fileName || `photo-${Date.now()}`).replace(/\.[^.]+$/, '') + '.jpg',
      mimeType: 'image/jpeg',
    };
  } catch {
    // If conversion fails, send the original rather than losing the photo.
    return {
      uri: asset.uri,
      fileName: asset.fileName || `photo-${Date.now()}.jpg`,
      mimeType: asset.mimeType || 'image/jpeg',
    };
  }
}

export async function pickFromLibrary(): Promise<PickedImage | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
  });
  return fromResult(result);
}

export async function captureWithSystemCamera(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchCameraAsync({ quality: 0.9 });
  return fromResult(result);
}

/**
 * Normalise a photo captured by the in-app camera (expo-camera returns a
 * file URI, HEIC on some devices) to the same JPEG shape.
 */
export async function normalisePhoto(uri: string): Promise<PickedImage> {
  try {
    const converted = await toJpeg(uri);
    return { uri: converted.uri, fileName: `photo-${Date.now()}.jpg`, mimeType: 'image/jpeg' };
  } catch {
    return { uri, fileName: `photo-${Date.now()}.jpg`, mimeType: 'image/jpeg' };
  }
}

/** Append a picked image to FormData under the given field name. */
export function appendImage(form: FormData, field: string, image: PickedImage): void {
  form.append(field, {
    uri: image.uri,
    name: image.fileName,
    type: image.mimeType,
    // React Native's FormData file part shape.
  } as unknown as Blob);
}
