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

    // Setup initial shader
    this.mesh = null;
    this._animate = this._animate.bind(this);

    this.loadShader(initialShaderId);
  }

  start(){
    this._running = true;
    this.clock.start();
    requestAnimationFrame(this._animate);
  }

  _animate(){
    if(!this._running) return;
    const dt = this.clock.getDelta();
    this.sharedUniforms.uTime.value += dt;
    if(this.material && this.material.uniforms && this.material.uniforms.uTime){
      this.material.uniforms.uTime.value = this.sharedUniforms.uTime.value;
    }

    this.renderer.render(this.scene, this.camera);
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
    return this.sharedUniforms?.uTime?.value ?? 0;
  }

  setTime(t){
    const v = Number(t) || 0;
    if(this.sharedUniforms?.uTime) this.sharedUniforms.uTime.value = v;
    if(this.material?.uniforms?.uTime) this.material.uniforms.uTime.value = v;
  }

  /**
   * Returns shader source + metadata + current uniform values for copy/export.
   */
  getShaderSourceBundle(){
    const entry = this.currentShaderEntry;
    const cfg = this.getConfig();
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
