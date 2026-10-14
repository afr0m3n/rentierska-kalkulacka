export interface CanvasSlice {
  sourceY: number;
  sourceHeight: number;
  pageIndex: number;
  destinationY: number;
  destinationHeight: number;
}

export function planCanvasSlices(
  canvasHeightPixels: number,
  scale: number,
  pointsPerCssPixel: number,
  pageHeightPoints: number,
  topMarginPoints: number,
  bottomMarginPoints: number,
  initialYPoints: number,
): CanvasSlice[] {
  if (canvasHeightPixels <= 0 || scale <= 0 || pointsPerCssPixel <= 0) return [];
  const slices: CanvasSlice[] = [];
  let sourceY = 0;
  let pageIndex = 0;
  let destinationY = initialYPoints;

  while (sourceY < canvasHeightPixels) {
    const availablePoints = pageHeightPoints - bottomMarginPoints - destinationY;
    if (availablePoints <= 0) {
      pageIndex += 1;
      destinationY = topMarginPoints;
      continue;
    }
    const availablePixels = Math.floor(availablePoints / pointsPerCssPixel * scale);
    const sourceHeight = Math.min(canvasHeightPixels - sourceY, Math.max(1, availablePixels));
    const destinationHeight = sourceHeight / scale * pointsPerCssPixel;
    slices.push({ sourceY, sourceHeight, pageIndex, destinationY, destinationHeight });
    sourceY += sourceHeight;
    if (sourceY < canvasHeightPixels) {
      pageIndex += 1;
      destinationY = topMarginPoints;
    } else {
      destinationY += destinationHeight;
    }
  }
  return slices;
}
