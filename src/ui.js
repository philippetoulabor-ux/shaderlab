/**
 * ui.js
 *
 * Minimal UI implementation using plain DOM APIs.
 * Responsibilities:
 *  - render shader selection dropdown
 *  - create uniform controls dynamically based on metadata
 *  - forward user changes to callbacks
 *
 * Expects an object with callbacks:
 *  - onLoadShader(id)
 *  - onSetUniform(name, value)
 *  - onRandomize()
 *  - onExport()
 *
 * The UI is intentionally modular and does not access WebGL internals.
 */

export class UI {
  constructor({ shaderList = [], onLoadShader, onSetUniform, onRandomize, onExport } = {}){
    this.shaderList = shaderList;
    this.onLoadShader = onLoadShader;
    this.onSetUniform = onSetUniform;
    this.onRandomize = onRandomize;
    this.onExport = onExport;

    this.shaderSelect = document.getElementById('shaderSelect');
    this.uniformControls = document.getElementById('uniformControls');
    this.shaderDesc = document.getElementById('shaderDesc');
    this.randomizeBtn = document.getElementById('randomizeBtn');
    this.exportBtn = document.getElementById('exportBtn');

    this._populateShaderList();
    this._attachListeners();

    // keep a small map of control elements to update values later
    this.controls = new Map();
  }

  _populateShaderList(){
    this.shaderSelect.innerHTML = '';
    for(const s of this.shaderList){
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      this.shaderSelect.appendChild(opt);
    }
    // Set description for first
    this.shaderDesc.textContent = this.shaderList[0]?.description || '';
    this.shaderSelect.value = this.shaderList[0]?.id || '';
  }

  _attachListeners(){
    this.shaderSelect.addEventListener('change', (e) => {
      const id = e.target.value;
      const entry = this.shaderList.find(s => s.id === id);
      this.shaderDesc.textContent = entry?.description || '';
      this.onLoadShader && this.onLoadShader(id);
    });

    this.randomizeBtn.addEventListener('click', () => {
      this.onRandomize && this.onRandomize();
    });

    this.exportBtn.addEventListener('click', () => {
      this.onExport && this.onExport();
    });
  }

  _isNumericUniform(u){
    return u.type === 'float' || u.type === 'int' || (u.min !== undefined && u.max !== undefined);
  }

  _createNumericControl(u){
    const min = (u.min !== undefined) ? u.min : 0;
    const max = (u.max !== undefined) ? u.max : 1;
    const step = (u.step !== undefined) ? u.step : 0.01;
    const isInt = u.type === 'int';
    const initial = (u.value !== undefined) ? u.value : min;

    const wrapper = document.createElement('div');
    wrapper.className = 'control-inputs';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = initial;

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'value-input';
    numInput.min = min;
    numInput.max = max;
    numInput.step = step;
    numInput.value = initial;

    const applyValue = (raw) => {
      let v = isInt ? parseInt(raw, 10) : parseFloat(raw);
      if(Number.isNaN(v)) return;
      v = Math.min(max, Math.max(min, v));
      if(isInt) v = Math.round(v);
      slider.value = v;
      numInput.value = v;
      this.onSetUniform && this.onSetUniform(u.name, v);
    };

    slider.addEventListener('input', (e) => applyValue(e.target.value));
    numInput.addEventListener('input', (e) => applyValue(e.target.value));

    wrapper.appendChild(slider);
    wrapper.appendChild(numInput);
    return { wrapper, slider, numInput };
  }

  /**
   * Receives an array of uniforms metadata (with current value) and builds/upates controls.
   * @param {Array} uniforms
   */
  updateControls(uniforms){
    this.uniformControls.innerHTML = '';
    this.controls.clear();

    for(const u of uniforms){
      const row = document.createElement('div');
      row.className = 'control-row';

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = u.label || u.name;
      row.appendChild(label);

      if(u.type === 'color'){
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'color-input';
        input.value = (typeof u.value === 'string') ? u.value : '#ffffff';
        input.addEventListener('input', (e) => {
          this.onSetUniform && this.onSetUniform(u.name, e.target.value);
        });
        row.appendChild(input);
        this.controls.set(u.name, input);
      } else if(this._isNumericUniform(u)){
        const { wrapper, slider, numInput } = this._createNumericControl(u);
        row.appendChild(wrapper);
        this.controls.set(u.name, { slider, input: numInput });
      } else {
        // fallback: show text input
        const input = document.createElement('input');
        input.type = 'text';
        input.value = u.value ?? '';
        input.addEventListener('change', (e) => this.onSetUniform && this.onSetUniform(u.name, e.target.value));
        row.appendChild(input);
        this.controls.set(u.name, input);
      }

      this.uniformControls.appendChild(row);
    }
  }

  /**
   * Apply a config object (from ShaderLab.randomizeCurrentConfig()) back to the UI controls.
   */
  applyConfig(cfg){
    if(!cfg || !cfg.uniforms) return;
    for(const k in cfg.uniforms){
      const el = this.controls.get(k);
      if(!el) continue;
      const v = cfg.uniforms[k];
      if(el.slider && el.input){
        el.slider.value = v;
        el.input.value = v;
      } else if(el.type === 'color'){
        el.value = v;
      } else if(el.type === 'range'){
        el.value = v;
      } else {
        el.value = v;
      }
    }
  }
}
