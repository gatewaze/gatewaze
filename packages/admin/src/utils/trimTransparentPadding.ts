/**
 * Trims transparent padding from an image file before upload.
 *
 * - **SVG**: Renders to canvas at high resolution, detects content bounds,
 *   then updates the SVG's viewBox to crop out transparent whitespace.
 * - **PNG/WebP**: Uses canvas pixel scanning to find the bounding box of
 *   non-transparent content and re-exports a cropped version.
 * - **Other formats** (JPEG, etc.): Returns the file unchanged.
 *
 * Returns the original file if no significant trimming is needed (< 5% area)
 * or if any error occurs.
 */
export async function trimTransparentPadding(file: File): Promise<File> {
  if (file.type === 'image/svg+xml') {
    return trimSvg(file);
  }

  if (file.type.match(/^image\/(png|webp)$/)) {
    return trimRaster(file);
  }

  return file;
}

/**
 * Trim an SVG by rendering it to canvas, detecting content bounds,
 * and rewriting the viewBox to match.
 */
async function trimSvg(file: File): Promise<File> {
  try {
    const svgText = await file.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (!svgEl) return file;

    // Get the original viewBox or derive from width/height
    let vbX = 0, vbY = 0, vbW = 0, vbH = 0;
    const viewBox = svgEl.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        [vbX, vbY, vbW, vbH] = parts;
      }
    }

    // Fall back to width/height attributes
    if (!vbW || !vbH) {
      const w = parseFloat(svgEl.getAttribute('width') || '0');
      const h = parseFloat(svgEl.getAttribute('height') || '0');
      if (w && h) {
        vbW = w;
        vbH = h;
      } else {
        return file;
      }
    }

    // Render SVG to canvas at a reasonable resolution for scanning
    const renderSize = 512;
    const scale = renderSize / Math.max(vbW, vbH);
    const canvasW = Math.ceil(vbW * scale);
    const canvasH = Math.ceil(vbH * scale);

    const bounds = await detectContentBounds(svgText, canvasW, canvasH);
    if (!bounds) return file;

    const { top, bottom, left, right } = bounds;
    const trimmedW = right - left + 1;
    const trimmedH = bottom - top + 1;

    // Skip if trimming would remove less than 5%
    if ((trimmedW * trimmedH) / (canvasW * canvasH) > 0.95) {
      return file;
    }

    // Map canvas pixel bounds back to viewBox coordinates
    const newVbX = vbX + (left / canvasW) * vbW;
    const newVbY = vbY + (top / canvasH) * vbH;
    const newVbW = (trimmedW / canvasW) * vbW;
    const newVbH = (trimmedH / canvasH) * vbH;

    // Update the SVG
    svgEl.setAttribute('viewBox', `${newVbX} ${newVbY} ${newVbW} ${newVbH}`);

    // Remove explicit width/height so it scales to the new viewBox
    svgEl.removeAttribute('width');
    svgEl.removeAttribute('height');

    const serializer = new XMLSerializer();
    const newSvgText = serializer.serializeToString(doc);
    return new File([newSvgText], file.name, { type: 'image/svg+xml' });
  } catch {
    return file;
  }
}

/**
 * Render content to a canvas and detect the bounding box of non-transparent pixels.
 */
function detectContentBounds(
  svgText: string,
  width: number,
  height: number
): Promise<{ top: number; bottom: number; left: number; right: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const { data } = imageData;

        let top = height, bottom = 0, left = width, right = 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const alpha = data[(y * width + x) * 4 + 3];
            if (alpha > 0) {
              if (y < top) top = y;
              if (y > bottom) bottom = y;
              if (x < left) left = x;
              if (x > right) right = x;
            }
          }
        }

        if (top > bottom || left > right) {
          resolve(null);
          return;
        }

        resolve({ top, bottom, left, right });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);

    // Encode SVG as data URL for rendering
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Trim a raster image (PNG/WebP) by scanning for non-transparent pixel bounds.
 */
function trimRaster(file: File): Promise<File> {
  return new Promise<File>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data, width, height } = imageData;

        let top = height, bottom = 0, left = width, right = 0;

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const alpha = data[(y * width + x) * 4 + 3];
            if (alpha > 0) {
              if (y < top) top = y;
              if (y > bottom) bottom = y;
              if (x < left) left = x;
              if (x > right) right = x;
            }
          }
        }

        if (top > bottom || left > right) {
          resolve(file);
          return;
        }

        const trimmedWidth = right - left + 1;
        const trimmedHeight = bottom - top + 1;

        if ((trimmedWidth * trimmedHeight) / (width * height) > 0.95) {
          resolve(file);
          return;
        }

        const trimmedCanvas = document.createElement('canvas');
        trimmedCanvas.width = trimmedWidth;
        trimmedCanvas.height = trimmedHeight;
        const trimmedCtx = trimmedCanvas.getContext('2d');
        if (!trimmedCtx) {
          resolve(file);
          return;
        }

        trimmedCtx.drawImage(
          canvas,
          left, top, trimmedWidth, trimmedHeight,
          0, 0, trimmedWidth, trimmedHeight
        );

        trimmedCanvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            resolve(new File([blob], file.name, { type: file.type }));
          },
          file.type,
          1.0
        );
      } catch {
        resolve(file);
      }
    };

    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}
