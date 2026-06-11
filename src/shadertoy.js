/**
 * Shadertoy-style WebGL2 renderer.
 *
 * The user edits only `mainImage(out vec4 fragColor, in vec2 fragCoord)`.
 * This module supplies the vertex shader, fragment wrapper (Shadertoy uniforms + main()),
 * fullscreen quad, uniform updates, optional iChannel textures, and error remapping.
 */

// ---------------------------------------------------------------------------
// GLSL sources
// ---------------------------------------------------------------------------

/** Fixed vertex shader: clip-space quad, UVs 0–1 passed to the fragment stage. */
export const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
    vUv = aPosition * .5 + .5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * Fragment shader prefix: Shadertoy uniforms + forward declaration of mainImage.
 * User GLSL is concatenated next, then FRAGMENT_SHADER_SUFFIX (main()).
 */
export const FRAGMENT_SHADER_PREFIX = `#version 300 es
precision highp float;

// --- Shadertoy-compatible uniforms (see setUniforms() in JS) ---
uniform vec3      iResolution;           // viewport pixels (xy), aspect placeholder (z)
uniform float     iTime;                 // seconds since start
uniform float     iTimeDelta;            // last frame duration (seconds)
uniform float     iFrameRate;            // smoothed FPS estimate
uniform int       iFrame;                // frame index since start
uniform float     iChannelTime[4];       // playback time per channel (static images: 0)
uniform vec3      iChannelResolution[4]; // texture size per channel (xy), z = 1
uniform vec4      iMouse;                // xy: pos while down / last; zw: click position
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec4      iDate;                 // year, month, day, seconds since midnight
uniform float     iSampleRate;           // audio sample rate (default 44100)

out vec4 outColor;

void mainImage( out vec4 fragColor, in vec2 fragCoord );
`;

/** Fragment tail: invokes user mainImage and writes the framebuffer. */
export const FRAGMENT_SHADER_SUFFIX = `
void main() {
    vec4 fragColor;
    vec2 fragCoord = gl_FragCoord.xy;
    mainImage(fragColor, fragCoord);
    outColor = fragColor;
}
`;

/** Default user snippet (mainImage only). */
export const DEFAULT_MAIN_IMAGE = `void mainImage( out vec4 fragColor, in vec2 fragCoord ) {
    vec2 uv = fragCoord / iResolution.xy;
    // Use .5 not 0.5 — GLSL ES can lex 0.5 as int(0) + swizzle(.5)
    vec3 col = vec3(.5) + vec3(.5) * cos(iTime + uv.xyx + vec3(.0, 2., 4.));
    fragColor = vec4(col, 1.);
}`;

/** Number of wrapper lines before the user's mainImage code (for error line mapping). */
export function getUserCodeLineOffset() {
  return FRAGMENT_SHADER_PREFIX.split('\n').length;
}

/**
 * GLSL ES can tokenize `0.5` as integer `0` plus swizzle `.5` (not as one float).
 * Rewrite common literals so Shadertoy-style snippets compile under #version 300 es.
 */
export function sanitizeGlslEsLiterals(source) {
  return (source || '')
    .replace(/\b0\.5\b/g, '.5')
    .replace(/\b1\.0\b/g, '1.')
    .replace(/\b0\.0\b/g, '.0');
}

/**
 * Build the complete fragment shader source WebGL compiles.
 * @param {string} userMainImageCode
 */
export function buildFragmentShaderSource(userMainImageCode) {
  const user = sanitizeGlslEsLiterals((userMainImageCode || '').trim());
  return `${FRAGMENT_SHADER_PREFIX}\n${user}\n${FRAGMENT_SHADER_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// Shader compile / link helpers
// ---------------------------------------------------------------------------

/**
 * Compile one shader stage; returns the shader object or throws with the driver log.
 */
export function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'Unknown compile error';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

/**
 * Create and link a program from vertex + fragment source strings.
 */
export function createProgram(gl, vertexSource, fragmentSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'Unknown link error';
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

/**
 * Remap ERROR line numbers in a driver log so they refer to the user's mainImage source.
 * Wrapper lines are subtracted when the reported line is past the prefix.
 */
export function remapShaderErrors(log, userLineOffset) {
  if (!log) return '';
  return log
    .split('\n')
    .map((line) =>
      line.replace(/ERROR:\s*(\d+):(\d+)/g, (full, lineStr, col) => {
        const lineNum = parseInt(lineStr, 10);
        if (lineNum > userLineOffset) {
          return `ERROR: ${lineNum - userLineOffset}:${col}`;
        }
        return full;
      })
    )
    .join('\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Fullscreen quad (TRIANGLE_STRIP)
// ---------------------------------------------------------------------------

const QUAD_POSITIONS = new Float32Array([
  -1, -1,
   1, -1,
  -1,  1,
   1,  1,
]);

/**
 * Upload clip-space quad positions and return { vbo, attribLoc }.
 */
export function createFullscreenQuad(gl, program) {
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_POSITIONS, gl.STATIC_DRAW);

  const attribLoc = gl.getAttribLocation(program, 'aPosition');
  return { vbo, attribLoc };
}

// ---------------------------------------------------------------------------
// Texture channels
// ---------------------------------------------------------------------------

function createPlaceholderTexture(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255])
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture: tex, width: 1, height: 1, url: null, loadTime: 0 };
}

function uploadImageTexture(gl, image) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/**
 * Load an image from URL into a channel slot (0..3).
 * @returns {Promise<void>}
 */
export function loadChannelFromURL(gl, channels, index, url) {
  if (!url || !url.trim()) {
    if (channels[index]?.texture) {
      gl.deleteTexture(channels[index].texture);
    }
    channels[index] = createPlaceholderTexture(gl);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (channels[index]?.texture) {
        gl.deleteTexture(channels[index].texture);
      }
      const texture = uploadImageTexture(gl, img);
      channels[index] = {
        texture,
        width: img.naturalWidth,
        height: img.naturalHeight,
        url,
        loadTime: performance.now() / 1000,
      };
      resolve();
    };
    img.onerror = () => reject(new Error(`Failed to load texture: ${url}`));
    img.src = url.trim();
  });
}

// ---------------------------------------------------------------------------
// Uniform locations + upload
// ---------------------------------------------------------------------------

function getUniformLocations(gl, program) {
  const names = [
    'iResolution',
    'iTime',
    'iTimeDelta',
    'iFrameRate',
    'iFrame',
    'iChannelTime',
    'iChannelResolution',
    'iMouse',
    'iChannel0',
    'iChannel1',
    'iChannel2',
    'iChannel3',
    'iDate',
    'iSampleRate',
  ];
  const locs = {};
  for (const name of names) {
    locs[name] = gl.getUniformLocation(program, name);
  }
  return locs;
}

/**
 * Upload all Shadertoy uniforms for the current frame.
 * @param {WebGL2RenderingContext} gl
 * @param {object} locs - uniform locations
 * @param {object} state - runtime values (see ShadertoyRenderer)
 * @param {Array} channels - channel texture metadata
 */
export function setUniforms(gl, locs, state, channels) {
  const { iResolution, iMouse, iDate } = state;

  if (locs.iResolution) gl.uniform3f(locs.iResolution, iResolution[0], iResolution[1], iResolution[2]);
  if (locs.iTime) gl.uniform1f(locs.iTime, state.iTime);
  if (locs.iTimeDelta) gl.uniform1f(locs.iTimeDelta, state.iTimeDelta);
  if (locs.iFrameRate) gl.uniform1f(locs.iFrameRate, state.iFrameRate);
  if (locs.iFrame) gl.uniform1i(locs.iFrame, state.iFrame);
  if (locs.iSampleRate) gl.uniform1f(locs.iSampleRate, state.iSampleRate);

  if (locs.iDate) {
    gl.uniform4f(locs.iDate, iDate[0], iDate[1], iDate[2], iDate[3]);
  }

  if (locs.iMouse) {
    gl.uniform4f(locs.iMouse, iMouse[0], iMouse[1], iMouse[2], iMouse[3]);
  }

  const channelTime = new Float32Array(4);
  const channelRes = new Float32Array(12);
  const nowSec = performance.now() / 1000;

  for (let i = 0; i < 4; i++) {
    const ch = channels[i];
    const w = ch?.width ?? 1;
    const h = ch?.height ?? 1;
    channelRes[i * 3] = w;
    channelRes[i * 3 + 1] = h;
    channelRes[i * 3 + 2] = 1.0;
    channelTime[i] = ch?.url ? nowSec - (ch.loadTime || 0) : 0.0;

    const unit = i;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, ch?.texture ?? null);
    const samplerLoc = locs[`iChannel${i}`];
    if (samplerLoc) gl.uniform1i(samplerLoc, unit);
  }

  if (locs.iChannelTime) gl.uniform1fv(locs.iChannelTime, channelTime);
  if (locs.iChannelResolution) gl.uniform3fv(locs.iChannelResolution, channelRes);
}

// ---------------------------------------------------------------------------
// ShadertoyRenderer
// ---------------------------------------------------------------------------

export class ShadertoyRenderer {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'none';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.appendChild(this.canvas);

    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new Error('WebGL2 is not available in this browser.');
    }
    this.gl = gl;

    this.program = null;
    this.uniformLocs = null;
    this.quad = null;
    this.channels = [];
    for (let i = 0; i < 4; i++) {
      this.channels.push(createPlaceholderTexture(gl));
    }

    this.userCode = DEFAULT_MAIN_IMAGE;
    this.userLineOffset = getUserCodeLineOffset();

    this._running = false;
    this._raf = 0;
    this._startTime = performance.now();
    this._lastFrameTime = this._startTime;
    this._frame = 0;
    this._smoothedFps = 60;

    this.state = {
      iTime: 0,
      iTimeDelta: 0,
      iFrameRate: 60,
      iFrame: 0,
      iResolution: [1, 1, 1],
      iMouse: [0, 0, 0, 0],
      iDate: [0, 0, 0, 0],
    };

    this._mouseDown = false;
    this._mousePos = [0, 0];

    this._onResize = this._handleResize.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this._onMouseLeave = this._handleMouseUp.bind(this);

    window.addEventListener('resize', this._onResize);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.canvas.addEventListener('mouseleave', this._onMouseLeave);

    this._handleResize();
  }

  get domElement() {
    return this.canvas;
  }

  getTime() {
    return this.state.iTime;
  }

  setTime(t) {
    const sec = Number(t) || 0;
    this.state.iTime = sec;
    this._startTime = performance.now() - sec * 1000;
    this._lastFrameTime = performance.now();
  }

  show() {
    this.canvas.style.display = 'block';
  }

  hide() {
    this.canvas.style.display = 'none';
  }

  /**
   * @param {string} userMainImageCode
   * @returns {{ ok: boolean, log: string, fullFragmentSource?: string }}
   */
  loadMainImage(userMainImageCode) {
    const user = (userMainImageCode || '').trim();
    if (!user) {
      return { ok: false, log: 'mainImage code must not be empty.' };
    }

    const gl = this.gl;
    const fragmentSource = buildFragmentShaderSource(user);
    this.userCode = user;
    this.userLineOffset = getUserCodeLineOffset();

    try {
      const nextProgram = createProgram(gl, VERTEX_SHADER_SOURCE, fragmentSource);

      if (this.program) {
        gl.deleteProgram(this.program);
      }
      this.program = nextProgram;
      this.uniformLocs = getUniformLocations(gl, this.program);

      if (this.quad?.vbo) {
        gl.deleteBuffer(this.quad.vbo);
      }
      this.quad = createFullscreenQuad(gl, this.program);

      return { ok: true, log: '', fullFragmentSource: fragmentSource };
    } catch (err) {
      const raw = String(err.message || err);
      const log = remapShaderErrors(raw, this.userLineOffset);
      return { ok: false, log, fullFragmentSource: fragmentSource };
    }
  }

  /**
   * @param {number} index 0..3
   * @param {string} url
   */
  async setChannelURL(index, url) {
    if (index < 0 || index > 3) return;
    try {
      await loadChannelFromURL(this.gl, this.channels, index, url);
    } catch (e) {
      console.warn(e);
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._startTime = performance.now() - this.state.iTime * 1000;
    this._lastFrameTime = performance.now();
    this._loop();
  }

  stop() {
    this._running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }

  _handleResize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.state.iResolution = [pw, ph, 1.0];
    const gl = this.gl;
    gl.viewport(0, 0, pw, ph);
  }

  _canvasPixelCoords(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const x = (clientX - rect.left) * scaleX;
    const y = this.canvas.height - (clientY - rect.top) * scaleY;
    return [x, y];
  }

  _handleMouseMove(e) {
    const [x, y] = this._canvasPixelCoords(e.clientX, e.clientY);
    this._mousePos = [x, y];
    if (this._mouseDown) {
      this.state.iMouse[0] = x;
      this.state.iMouse[1] = y;
    }
  }

  _handleMouseDown(e) {
    if (e.button !== 0) return;
    this._mouseDown = true;
    const [x, y] = this._canvasPixelCoords(e.clientX, e.clientY);
    this._mousePos = [x, y];
    this.state.iMouse[0] = x;
    this.state.iMouse[1] = y;
    this.state.iMouse[2] = x;
    this.state.iMouse[3] = y;
  }

  _handleMouseUp() {
    if (!this._mouseDown) return;
    this._mouseDown = false;
    this.state.iMouse[0] = this._mousePos[0];
    this.state.iMouse[1] = this._mousePos[1];
  }

  _updateDateUniform() {
    const d = new Date();
    const secondsOfDay =
      d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    this.state.iDate = [d.getFullYear(), d.getMonth() + 1, d.getDate(), secondsOfDay];
  }

  _renderFrame() {
    const gl = this.gl;
    if (!this.program || !this.quad) return;

    const now = performance.now();
    const dt = Math.max(0, (now - this._lastFrameTime) / 1000);
    this._lastFrameTime = now;

    this.state.iTime = (now - this._startTime) / 1000;
    this.state.iTimeDelta = dt;
    this.state.iFrame = this._frame;

    const instantFps = dt > 0 ? 1 / dt : 60;
    this._smoothedFps = this._smoothedFps * 0.9 + instantFps * 0.1;
    this.state.iFrameRate = this._smoothedFps;

    this._updateDateUniform();

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    setUniforms(gl, this.uniformLocs, this.state, this.channels);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad.vbo);
    gl.enableVertexAttribArray(this.quad.attribLoc);
    gl.vertexAttribPointer(this.quad.attribLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    this._frame += 1;
  }

  _loop() {
    if (!this._running) return;
    this._renderFrame();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  getShaderSourceBundle() {
    return {
      userMainImage: this.userCode,
      fullFragment: buildFragmentShaderSource(this.userCode),
      vertex: VERTEX_SHADER_SOURCE,
    };
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('mouseleave', this._onMouseLeave);

    const gl = this.gl;
    for (const ch of this.channels) {
      if (ch?.texture) gl.deleteTexture(ch.texture);
    }
    if (this.quad?.vbo) gl.deleteBuffer(this.quad.vbo);
    if (this.program) gl.deleteProgram(this.program);

    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}
