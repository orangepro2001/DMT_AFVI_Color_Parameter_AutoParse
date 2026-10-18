export type { GrayImage, Rect, Point } from './gray.ts';
export {
  clampByte,
  createGray,
  cloneGray,
  getPixel,
  sampleBilinear,
  gaussianBlur,
  downsampleArea,
  cropGray,
} from './gray.ts';

export { readTiffGray } from './tiff.ts';

export type { Rng } from './rng.ts';
export { createRng } from './rng.ts';

export type {
  Material,
  CameraChannel,
  LightColor,
  LightChannel,
  Reflectance,
  Crosstalk,
  LightSetting,
  LightScene,
  GvStats,
} from './light.ts';
export {
  MATERIALS,
  DEFAULT_REFLECTANCE,
  DEFAULT_CROSSTALK,
  cloneReflectance,
  withReflectance,
  buildMaterialMap,
  materialStats,
  createLightScene,
  irradiance,
  renderChannel,
  renderRgb,
  toLuma,
  estimateReflectance,
  measureGv,
} from './light.ts';

export type { WarpParams, Similarity } from './warp.ts';
export {
  IDENTITY_WARP,
  warpPoint,
  unwarpPoint,
  applyWarp,
  warpToSimilarity,
  applySimilarity,
  invertSimilarity,
  composeSimilarity,
} from './warp.ts';

export type {
  AlignRoi,
  AlignConfig,
  NccSurface,
  RoiMatch,
  AlignVerdictReason,
  AlignReport,
} from './align.ts';
export {
  DEFAULT_ALIGN_CONFIG,
  ncc,
  matchRoi,
  fitSimilarity,
  ransacSimilarity,
  alignWithRois,
  compareToTruth,
} from './align.ts';

export type {
  DefectStroke,
  SceneStroke,
  DefectParams,
  DefectBlob,
  DefectReport,
} from './defect.ts';
export {
  DEFAULT_DEFECT_PARAMS,
  paintDefects,
  paintScene,
  defectParamsFromInspection,
  detectDefects,
  probeArea,
  materialMask,
} from './defect.ts';
