/**
 * shaderLab.js
 *
 * Central class to manage shaders, uniforms, rendering and lifecycle.
 *
 * API:
 *  new ShaderLab(containerElement, initialShaderId, shaderRegistry)
 *  loadShader(id)
 *  setUniform(name, value)
 *  getConfig() -> { shaderId, uniforms }
 *  applyConfig(config)
 *  randomizeCurrentConfig() -> config
 *  start(), dispose()
 *
 * Notes:
 * - The shader registry is an array of shader definitions (see src/shaders.js).
 * - The class keeps a single plane mesh and replaces the material when switching shaders.
 */

import * as THREE from 'https://unpkg.com/three@0.152.2/build/three.module.js';
import { ShadertoyRenderer } from './shadertoy.js';

export class ShaderLab {
  /**
   * @param {HTMLElement} container
   * @param {string} initialShaderId
   * @param {Array} shaderRegistry
   */
  constructor(container, initialShaderId, shaderRegistry){
    this.container = container;
    this.shaderRegistry = shaderRegistry;
    this.currentShaderId = null;
    this.onUniformChanged = null;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    container.appendChild(this.renderer.domElement);

    // Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.z = 1;

    // Geometry & placeholder mesh
    this.geometry = new THREE.PlaneGeometry(2, 2);

    this.clock = new THREE.Clock();

    // Shared uniforms that most shaders expect
    this.sharedUniforms = {
      uTime: { value: 0.0 },
      uResolution: { value: new THREE.Vector2(container.clientWidth, container.clientHeight) }
    };

    this._resizeHandler = this._onWindowResize.bind(this);
    window.addEventListener('resize', this._resizeHandler);

    // WebGL2 Shadertoy path (used when shader id === 'new')
    this.shadertoy = new ShadertoyRenderer(container);
    this.shadertoy.hide();
    this._shadertoyActive = false;

    // Setup initial shader
    this.mesh = null;
    this._animate = this._animate.bind(this);

    this.loadShader(initialShaderId);
  }

  /** Canvas used for export / capture (Three.js or Shadertoy). */
  getActiveCanvas(){
    if(this._shadertoyActive) return this.shadertoy.domElement;
    return this.renderer.domElement;
  }

  _setShadertoyMode(active){
    this._shadertoyActive = active;
    if(active){
      this.renderer.domElement.style.display = 'none';
      this.shadertoy.show();
      this.shadertoy.start();
    } else {
      this.shadertoy.stop();
      this.shadertoy.hide();
      this.renderer.domElement.style.display = 'block';
    }
  }

  start(){
    this._running = true;
    this.clock.start();
    requestAnimationFrame(this._animate);
  }

  _animate(){
    if(!this._running) return;

    if(!this._shadertoyActive){
      const dt = this.clock.getDelta();
      this.sharedUniforms.uTime.value += dt;
      if(this.material && this.material.uniforms && this.material.uniforms.uTime){
        this.material.uniforms.uTime.value = this.sharedUniforms.uTime.value;
      }
      this.renderer.render(this.scene, this.camera);
    }

    requestAnimationFrame(this._animate);
  }

  _onWindowResize(){
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    if (this.sharedUniforms.uResolution && this.sharedUniforms.uResolution.value){
      this.sharedUniforms.uResolution.value.set(w, h);
    }
  }

  /**
   * Load a shader by id from registry and apply it.
   * @param {string} id
   */
  loadShader(id){
    const entry = this.shaderRegistry.find(s => s.id === id);
    if(!entry) {
      console.warn('Shader not found:', id); return;
    }

    if(id === 'new'){
      this._setShadertoyMode(true);
      this.currentShaderId = 'new';
      this.currentShaderEntry = entry;
      this._notifyUniforms();
      return { ok: true, log: '' };
    }

    this._setShadertoyMode(false);

    // Build uniforms: merge shared + shader-specific
    const uniforms = Object.assign({}, this.sharedUniforms);
    for(const u of entry.uniforms){
      // convert color arrays to THREE.Color for convenience
      if(u.type === 'color'){
        const c = Array.isArray(u.value)
          ? new THREE.Color(u.value[0], u.value[1], u.value[2])
          : new THREE.Color(u.value);
        uniforms[u.name] = { value: c };
      } else {
        uniforms[u.name] = { value: u.value };
      }
    }

    // Create material
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: entry.vertex,
      fragmentShader: entry.fragment,
      transparent: false
    });

    // Replace mesh material or create mesh
    if(this.mesh){
      // dispose previous material
      const prev = this.mesh.material;
      this.mesh.material = mat;
      if(prev){
        prev.dispose();
      }
    } else {
      this.mesh = new THREE.Mesh(this.geometry, mat);
      this.scene.add(this.mesh);
    }

    this.material = mat;
    this.currentShaderId = id;
    this.currentShaderEntry = entry;

    // Notify UI about new uniforms (pass simplified values)
    this._notifyUniforms();
  }

  /**
   * WebGLProgram for a material (Three r152 stores it on renderer.properties, not material.program).
   */
  _getCompiledProgram(mat){
    const props = this.renderer.properties?.get(mat);
    return props?.currentProgram ?? null;
  }

  /**
   * Compile-check a shader material without permanently swapping it in.
   * @returns {{ ok: boolean, log: string }}
   */
  _compileCheckMaterial(mat){
    if(!this.mesh){
      this.mesh = new THREE.Mesh(this.geometry, mat);
      this.scene.add(this.mesh);
    }

    const prev = this.mesh.material;
    this.mesh.material = mat;

    try {
      this.renderer.compile(this.scene, this.camera);
      let webglProgram = this._getCompiledProgram(mat);
      if(!webglProgram?.program){
        this.renderer.render(this.scene, this.camera);
        webglProgram = this._getCompiledProgram(mat);
      }

      const gl = this.renderer.getContext();
      const logs = [];

      if(!webglProgram?.program){
        this.mesh.material = prev;
        return { ok: false, log: 'Shader konnte nicht kompiliert werden.' };
      }

      if(webglProgram.vertexShader && !gl.getShaderParameter(webglProgram.vertexShader, gl.COMPILE_STATUS)){
        const vLog = gl.getShaderInfoLog(webglProgram.vertexShader);
        logs.push('Vertex:\n' + (vLog?.trim() || 'compile failed'));
      }
      if(webglProgram.fragmentShader && !gl.getShaderParameter(webglProgram.fragmentShader, gl.COMPILE_STATUS)){
        const fLog = gl.getShaderInfoLog(webglProgram.fragmentShader);
        logs.push('Fragment:\n' + (fLog?.trim() || 'compile failed'));
      }
      if(!gl.getProgramParameter(webglProgram.program, gl.LINK_STATUS)){
        const pLog = gl.getProgramInfoLog(webglProgram.program);
        logs.push('Program:\n' + (pLog?.trim() || 'link failed'));
      }

      this.mesh.material = prev;

      if(logs.length > 0){
        return { ok: false, log: logs.join('\n\n') };
      }
      return { ok: true, log: '' };
    } catch (e) {
      this.mesh.material = prev;
      return { ok: false, log: String(e?.message || e) };
    }
  }

  /**
   * Load user mainImage source (Shadertoy NEW mode).
   * @param {string} mainImageSource
   * @returns {{ ok: boolean, log: string, fullFragmentSource?: string }}
   */
  loadMainImage(mainImageSource){
    if(!this._shadertoyActive){
      this._setShadertoyMode(true);
    }
    this.currentShaderId = 'new';
    const entry = this.shaderRegistry.find(s => s.id === 'new');
    this.currentShaderEntry = entry || {
      id: 'new',
      name: 'NEW',
      description: 'Shadertoy-style shader',
      mainImage: mainImageSource,
      uniforms: [],
    };

    const result = this.shadertoy.loadMainImage(mainImageSource);
    if(result.ok){
      this._notifyUniforms();
    }
    return result;
  }

  /**
   * Bind a texture URL to iChannel0…3.
   * @param {number} index
   * @param {string} url
   */
  setChannelURL(index, url){
    return this.shadertoy.setChannelURL(index, url);
  }

  /**
   * Set a uniform value at runtime without rebuilding the material.
   * Color inputs may be strings like "#ff00aa" or THREE.Color.
   * @param {string} name
   * @param {*} value
   */
  setUniform(name, value){
    if(!this.material || !this.material.uniforms) return;
    const u = this.material.uniforms[name];
    if(!u) {
      console.warn('Uniform not found:', name); return;
    }

    // handle color
    if(u.value && (u.value.isColor || typeof value === 'string' && value.startsWith('#'))){
      if(typeof value === 'string') {
        u.value.set(value);
      } else if(value instanceof THREE.Color){
        u.value.copy(value);
      } else if(Array.isArray(value)){
        u.value.setRGB(value[0], value[1], value[2]);
      }
    } else {
      u.value = value;
      // Ensure the uniform reference is updated (Three.js uses object wrappers for some types)
      this.material.uniforms[name].value = u.value;
    }
  }

  getTime(){
    if(this._shadertoyActive) return this.shadertoy.getTime();
    return this.sharedUniforms?.uTime?.value ?? 0;
  }

  setTime(t){
    const v = Number(t) || 0;
    if(this._shadertoyActive){
      this.shadertoy.setTime(v);
      return;
    }
    if(this.sharedUniforms?.uTime) this.sharedUniforms.uTime.value = v;
    if(this.material?.uniforms?.uTime) this.material.uniforms.uTime.value = v;
  }

  /**
   * Returns shader source + metadata + current uniform values for copy/export.
   */
  getShaderSourceBundle(){
    const entry = this.currentShaderEntry;
    const cfg = this.getConfig();

    if(this._shadertoyActive){
      const st = this.shadertoy.getShaderSourceBundle();
      return {
        shaderId: 'new',
        name: entry?.name || 'NEW',
        description: entry?.description || '',
        vertex: st.vertex,
        userMainImage: st.userMainImage,
        fragment: st.fullFragment,
        uniformsMeta: [],
        uniformsCurrent: {},
      };
    }

    return {
      shaderId: cfg.shaderId,
      name: entry?.name || cfg.shaderId,
      description: entry?.description || '',
      vertex: entry?.vertex || '',
      fragment: entry?.fragment || '',
      uniformsMeta: entry?.uniforms || [],
      uniformsCurrent: cfg.uniforms || {}
    };
  }

  /**
   * Return a plain JSON-serializable config for the current shader + uniforms.
   */
  getConfig(){
    const cfg = { shaderId: this.currentShaderId, uniforms: {} };
    if(!this.material || !this.currentShaderEntry) return cfg;
    for(const umeta of this.currentShaderEntry.uniforms){
      const u = this.material.uniforms[umeta.name];
      if(!u) continue;
      let val = u.value;
      if(val && val.isColor){
        // output hex string
        val = '#' + val.getHexString();
      } else if(val instanceof THREE.Vector2){
        val = [val.x, val.y];
      }
      cfg.uniforms[umeta.name] = val;
    }
    return cfg;
  }

  /**
   * Apply a config produced by getConfig().
   */
  applyConfig(config){
    if(!config) return;
    if(config.shaderId && config.shaderId !== this.currentShaderId){
      this.loadShader(config.shaderId);
    }
    if(config.uniforms){
      for(const k in config.uniforms){
        this.setUniform(k, config.uniforms[k]);
      }
    }
  }

  /**
   * Randomize current shader parameters based on their min/max
   */
  randomizeCurrentConfig(){
    if(!this.currentShaderEntry) return {};
    const cfg = { shaderId: this.currentShaderId, uniforms: {} };
    for(const u of this.currentShaderEntry.uniforms){
      if(u.type === 'color'){
        const c = '#' + Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0');
        cfg.uniforms[u.name] = c;
        this.setUniform(u.name, c);
      } else if(u.type === 'float' || u.type === 'int' || (u.min !== undefined && u.max !== undefined)){
        const min = (u.min !== undefined) ? u.min : 0;
        const max = (u.max !== undefined) ? u.max : 1;
        const isInt = u.type === 'int';
        const v = Math.random() * (max - min) + min;
        const val = isInt ? Math.round(v) : parseFloat(v.toFixed(3));
        cfg.uniforms[u.name] = val;
        this.setUniform(u.name, val);
      } else {
        // fallback: use default
        cfg.uniforms[u.name] = u.value;
        this.setUniform(u.name, u.value);
      }
    }
    return cfg;
  }

  /**
   * Notify UI about current uniforms in a minimal format.
   */
  _notifyUniforms(){
    if(!this.onUniformChanged || !this.currentShaderEntry) return;
    const out = this.currentShaderEntry.uniforms.map(u => {
      const matU = this.material.uniforms[u.name];
      let val = matU ? matU.value : u.value;
      if(val && val.isColor) val = '#' + val.getHexString();
      if(val instanceof THREE.Vector2) val = [val.x, val.y];
      return { ...u, value: val };
    });
    this.onUniformChanged(out);
  }

  dispose(){
    this._running = false;
    window.removeEventListener('resize', this._resizeHandler);
    this.shadertoy?.dispose();
    if(this.mesh){
      if(this.mesh.material) this.mesh.material.dispose();
      this.scene.remove(this.mesh);
      this.mesh.geometry?.dispose();
      this.mesh = null;
    }
    this.renderer.dispose();
    if(this.renderer.domElement && this.renderer.domElement.parentNode){
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
