export interface PointerInfo {
  type: 'down' | 'move' | 'up';
  x: number;
  y: number;
  button: number;
  shift: boolean;
  alt: boolean;
}

export interface LightUniforms {
  reflectance: Float32Array;
  irradiance: [number, number, number];
  gain: number;
  offset: number;
  textureStrength: number;
  channel: 'Red' | 'Green' | 'Blue' | 'RGB';
  showMaterial: boolean;
}

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  toScreen(x: number, y: number): [number, number];
  toImage(sx: number, sy: number): [number, number];
}

interface GrayTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
}

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
uniform vec2 u_scale;
uniform vec2 u_offset;
void main() {
  v_uv = vec2(a_pos.x, 1.0 - a_pos.y);
  vec2 p = a_pos * u_scale + u_offset;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const LIGHT_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_material;
uniform sampler2D u_median;
uniform vec4 u_means;
uniform float u_reflectance[12];
uniform vec3 u_irradiance;
uniform float u_gain;
uniform float u_gvOffset;
uniform float u_textureStrength;
uniform int u_channel;
uniform int u_showMaterial;
void main() {
  float mf = texture(u_material, v_uv).r * 255.0;
  int m = int(floor(mf + 0.5));
  if (m < 0) m = 0;
  if (m > 3) m = 3;
  float v = texture(u_median, v_uv).r * 255.0;
  float mean = m == 0 ? u_means.x : m == 1 ? u_means.y : m == 2 ? u_means.z : u_means.w;
  float t = mean > 0.0 ? clamp(v / mean, 0.0, 4.0) : 1.0;
  float tp = 1.0 + u_textureStrength * (t - 1.0);
  if (u_showMaterial == 1) {
    vec3 base = vec3(0.18, 0.18, 0.18);
    vec3 sr = vec3(0.20, 0.75, 0.30);
    vec3 openC = vec3(0.65, 0.45, 0.20);
    vec3 metal = vec3(0.95, 0.80, 0.25);
    vec3 c = m == 0 ? base : m == 1 ? sr : m == 2 ? openC : metal;
    outColor = vec4(c, 1.0);
    return;
  }
  float r = u_reflectance[m * 3 + 0];
  float g = u_reflectance[m * 3 + 1];
  float b = u_reflectance[m * 3 + 2];
  float gvR = clamp(floor(u_gain * u_irradiance.x * r * tp * 255.0 + u_gvOffset + 0.5), 0.0, 255.0);
  float gvG = clamp(floor(u_gain * u_irradiance.y * g * tp * 255.0 + u_gvOffset + 0.5), 0.0, 255.0);
  float gvB = clamp(floor(u_gain * u_irradiance.z * b * tp * 255.0 + u_gvOffset + 0.5), 0.0, 255.0);
  if (u_channel == 0) outColor = vec4(gvR / 255.0, gvR / 255.0, gvR / 255.0, 1.0);
  else if (u_channel == 1) outColor = vec4(gvG / 255.0, gvG / 255.0, gvG / 255.0, 1.0);
  else if (u_channel == 2) outColor = vec4(gvB / 255.0, gvB / 255.0, gvB / 255.0, 1.0);
  else outColor = vec4(gvR / 255.0, gvG / 255.0, gvB / 255.0, 1.0);
}
`;

const GRAY_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform sampler2D u_image;
void main() {
  float v = texture(u_image, v_uv).r;
  outColor = vec4(v, v, v, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown';
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertex);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (program === null) throw new Error('failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown';
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
}

export class Viewer {
  private host: HTMLElement;
  private glCanvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private overlayCtx: CanvasRenderingContext2D;
  private lightProgram: WebGLProgram;
  private grayProgram: WebGLProgram;
  private quad: WebGLBuffer;
  private materialTexture: WebGLTexture | null = null;
  private medianTexture: WebGLTexture | null = null;
  private grayTextures = new Map<string, GrayTexture>();
  private imageWidth = 0;
  private imageHeight = 0;
  private materialMeans: [number, number, number, number] = [0, 0, 0, 0];
  private uniforms: LightUniforms = {
    reflectance: new Float32Array(12),
    irradiance: [0, 0, 0],
    gain: 1,
    offset: 0,
    textureStrength: 1,
    channel: 'Red',
    showMaterial: false,
  };
  private mode: 'light' | 'gray' = 'light';
  private grayKey: string | null = null;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private overlayDraw: ((ctx: CanvasRenderingContext2D, view: ViewTransform) => void) | null = null;
  private pointerHandler: ((p: PointerInfo) => boolean) | null = null;
  private hoverHandler: ((x: number, y: number) => void) | null = null;
  private redrawQueued = false;
  private panning = false;
  private panButton = 0;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private spaceDown = false;
  private maxTextureSize = 0;

  constructor(host: HTMLElement) {
    this.host = host;
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.className = 'gl';
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'overlay';
    host.appendChild(this.glCanvas);
    host.appendChild(this.overlayCanvas);

    const gl = this.glCanvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
    if (gl === null) throw new Error('WebGL2 not available');
    this.gl = gl;
    const ctx = this.overlayCanvas.getContext('2d');
    if (ctx === null) throw new Error('2D canvas not available');
    this.overlayCtx = ctx;

    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.lightProgram = linkProgram(gl, VERTEX_SHADER, LIGHT_FRAGMENT);
    this.grayProgram = linkProgram(gl, VERTEX_SHADER, GRAY_FRAGMENT);

    const quad = gl.createBuffer();
    if (quad === null) throw new Error('failed to create buffer');
    this.quad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(host);
    this.resize();
    this.attachEvents();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.host.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    for (const canvas of [this.glCanvas, this.overlayCanvas]) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    }
    this.redraw();
  }

  private attachEvents(): void {
    this.glCanvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.glCanvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const before = this.screenToImage(sx, sy);
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.scale = Math.min(32, Math.max(0.02, this.scale * factor));
      const after = this.screenToImage(sx, sy);
      this.offsetX += (after[0] - before[0]) * this.scale;
      this.offsetY += (after[1] - before[1]) * this.scale;
      this.redraw();
    }, { passive: false });

    this.glCanvas.addEventListener('pointerdown', (event) => {
      this.glCanvas.setPointerCapture(event.pointerId);
      const rect = this.glCanvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const img = this.screenToImage(sx, sy);
      const info: PointerInfo = {
        type: 'down',
        x: img[0],
        y: img[1],
        button: event.button,
        shift: event.shiftKey,
        alt: event.altKey,
      };
      const consumed = this.pointerHandler !== null ? this.pointerHandler(info) : false;
      if (!consumed && (event.button === 0 || event.button === 1 || this.spaceDown)) {
        this.panning = true;
        this.panButton = event.button;
        this.panStartX = sx;
        this.panStartY = sy;
        this.panOriginX = this.offsetX;
        this.panOriginY = this.offsetY;
      }
    });

    this.glCanvas.addEventListener('pointermove', (event) => {
      const rect = this.glCanvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const img = this.screenToImage(sx, sy);
      if (this.panning) {
        this.offsetX = this.panOriginX + (sx - this.panStartX);
        this.offsetY = this.panOriginY + (sy - this.panStartY);
        this.redraw();
      }
      const info: PointerInfo = {
        type: 'move',
        x: img[0],
        y: img[1],
        button: this.panning ? this.panButton : event.button,
        shift: event.shiftKey,
        alt: event.altKey,
      };
      if (this.pointerHandler !== null) this.pointerHandler(info);
      if (this.hoverHandler !== null) this.hoverHandler(img[0], img[1]);
    });

    const endPointer = (event: PointerEvent): void => {
      const rect = this.glCanvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const img = this.screenToImage(sx, sy);
      const info: PointerInfo = {
        type: 'up',
        x: img[0],
        y: img[1],
        button: event.button,
        shift: event.shiftKey,
        alt: event.altKey,
      };
      if (this.pointerHandler !== null) this.pointerHandler(info);
      this.panning = false;
    };
    this.glCanvas.addEventListener('pointerup', endPointer);
    this.glCanvas.addEventListener('pointercancel', endPointer);

    this.glCanvas.addEventListener('dblclick', () => this.fit());

    window.addEventListener('keydown', (event) => {
      if (event.code === 'Space') this.spaceDown = true;
    });
    window.addEventListener('keyup', (event) => {
      if (event.code === 'Space') this.spaceDown = false;
    });
  }

  private screenToImage(sx: number, sy: number): [number, number] {
    const dpr = window.devicePixelRatio || 1;
    const px = sx * dpr;
    const py = sy * dpr;
    return [(px - this.offsetX) / this.scale, (py - this.offsetY) / this.scale];
  }

  private getViewTransform(): ViewTransform {
    const dpr = window.devicePixelRatio || 1;
    const scale = this.scale;
    const offsetX = this.offsetX;
    const offsetY = this.offsetY;
    return {
      scale: scale / dpr,
      offsetX: offsetX / dpr,
      offsetY: offsetY / dpr,
      toScreen(x: number, y: number): [number, number] {
        return [(x * scale + offsetX) / dpr, (y * scale + offsetY) / dpr];
      },
      toImage(sx: number, sy: number): [number, number] {
        return [(sx * dpr - offsetX) / scale, (sy * dpr - offsetY) / scale];
      },
    };
  }

  setScene(
    width: number,
    height: number,
    material: Uint8Array,
    median: Uint8Array,
    materialMeans: [number, number, number, number],
  ): void {
    if (width > this.maxTextureSize || height > this.maxTextureSize) {
      throw new Error(`image ${width}x${height} exceeds MAX_TEXTURE_SIZE ${this.maxTextureSize}`);
    }
    const gl = this.gl;
    if (this.materialTexture !== null) gl.deleteTexture(this.materialTexture);
    if (this.medianTexture !== null) gl.deleteTexture(this.medianTexture);
    this.materialTexture = this.createTexture(width, height, material);
    this.medianTexture = this.createTexture(width, height, median);
    this.imageWidth = width;
    this.imageHeight = height;
    this.materialMeans = materialMeans;
    this.mode = 'light';
    this.grayKey = null;
  }

  private createTexture(width: number, height: number, data: Uint8Array): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (texture === null) throw new Error('failed to create texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  setLightUniforms(u: LightUniforms): void {
    this.uniforms = u;
    this.mode = 'light';
    this.redraw();
  }

  showLight(): void {
    this.mode = 'light';
    this.redraw();
  }

  showGray(key: string, image: { width: number; height: number; data: Uint8Array }): void {
    if (image.width > this.maxTextureSize || image.height > this.maxTextureSize) {
      throw new Error(`image ${image.width}x${image.height} exceeds MAX_TEXTURE_SIZE ${this.maxTextureSize}`);
    }
    const gl = this.gl;
    const existing = this.grayTextures.get(key);
    if (existing !== undefined && existing.width === image.width && existing.height === image.height) {
      gl.bindTexture(gl.TEXTURE_2D, existing.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, image.width, image.height, gl.RED, gl.UNSIGNED_BYTE, image.data);
    } else {
      if (existing !== undefined) gl.deleteTexture(existing.texture);
      const texture = this.createTexture(image.width, image.height, image.data);
      this.grayTextures.set(key, { texture, width: image.width, height: image.height });
    }
    this.grayKey = key;
    this.mode = 'gray';
    this.imageWidth = image.width;
    this.imageHeight = image.height;
    this.redraw();
  }

  setOverlay(draw: ((ctx: CanvasRenderingContext2D, view: ViewTransform) => void) | null): void {
    this.overlayDraw = draw;
    this.redraw();
  }

  onPointer(handler: ((p: PointerInfo) => boolean) | null): void {
    this.pointerHandler = handler;
  }

  onHover(handler: (x: number, y: number) => void): void {
    this.hoverHandler = handler;
  }

  fit(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.host.getBoundingClientRect();
    const cw = rect.width * dpr;
    const ch = rect.height * dpr;
    if (this.imageWidth <= 0 || this.imageHeight <= 0) return;
    const scale = Math.min(cw / this.imageWidth, ch / this.imageHeight) * 0.98;
    this.scale = scale;
    this.offsetX = (cw - this.imageWidth * scale) / 2;
    this.offsetY = (ch - this.imageHeight * scale) / 2;
    this.redraw();
  }

  oneToOne(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.host.getBoundingClientRect();
    const cw = rect.width * dpr;
    const ch = rect.height * dpr;
    this.scale = 1;
    this.offsetX = (cw - this.imageWidth) / 2;
    this.offsetY = (ch - this.imageHeight) / 2;
    this.redraw();
  }

  redraw(): void {
    if (this.redrawQueued) return;
    this.redrawQueued = true;
    requestAnimationFrame(() => {
      this.redrawQueued = false;
      this.draw();
    });
  }

  private draw(): void {
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;
    gl.viewport(0, 0, this.glCanvas.width, this.glCanvas.height);
    gl.clearColor(0.043, 0.047, 0.059, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.imageWidth > 0 && this.imageHeight > 0) {
      const program = this.mode === 'light' ? this.lightProgram : this.grayProgram;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      const loc = gl.getAttribLocation(program, 'a_pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const scaleX = (this.imageWidth * this.scale) / this.glCanvas.width;
      const scaleY = (this.imageHeight * this.scale) / this.glCanvas.height;
      const offsetX = this.offsetX / this.glCanvas.width;
      const offsetY = 1 - (this.offsetY + this.imageHeight * this.scale) / this.glCanvas.height;
      gl.uniform2f(gl.getUniformLocation(program, 'u_scale'), scaleX, scaleY);
      gl.uniform2f(gl.getUniformLocation(program, 'u_offset'), offsetX, offsetY);

      if (this.mode === 'light') {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.materialTexture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_material'), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.medianTexture);
        gl.uniform1i(gl.getUniformLocation(program, 'u_median'), 1);
        gl.uniform4f(
          gl.getUniformLocation(program, 'u_means'),
          this.materialMeans[0],
          this.materialMeans[1],
          this.materialMeans[2],
          this.materialMeans[3],
        );
        gl.uniform1fv(gl.getUniformLocation(program, 'u_reflectance'), this.uniforms.reflectance);
        gl.uniform3f(
          gl.getUniformLocation(program, 'u_irradiance'),
          this.uniforms.irradiance[0],
          this.uniforms.irradiance[1],
          this.uniforms.irradiance[2],
        );
        gl.uniform1f(gl.getUniformLocation(program, 'u_gain'), this.uniforms.gain);
        gl.uniform1f(gl.getUniformLocation(program, 'u_gvOffset'), this.uniforms.offset);
        gl.uniform1f(gl.getUniformLocation(program, 'u_textureStrength'), this.uniforms.textureStrength);
        const channelIndex =
          this.uniforms.channel === 'Red' ? 0 : this.uniforms.channel === 'Green' ? 1 : this.uniforms.channel === 'Blue' ? 2 : 3;
        gl.uniform1i(gl.getUniformLocation(program, 'u_channel'), channelIndex);
        gl.uniform1i(gl.getUniformLocation(program, 'u_showMaterial'), this.uniforms.showMaterial ? 1 : 0);
      } else {
        const entry = this.grayKey !== null ? this.grayTextures.get(this.grayKey) : undefined;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, entry !== undefined ? entry.texture : null);
        gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    const ctx = this.overlayCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.overlayDraw !== null) {
      this.overlayDraw(ctx, this.getViewTransform());
    }
  }

  get imageSize(): { width: number; height: number } {
    return { width: this.imageWidth, height: this.imageHeight };
  }

  get zoom(): number {
    return this.scale / (window.devicePixelRatio || 1);
  }
}
