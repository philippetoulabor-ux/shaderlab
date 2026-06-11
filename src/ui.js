/**
 * ui.js
 *
 * Minimal UI implementation using plain DOM APIs.
 */

const CUSTOM_MAIN_IMAGE_KEY = 'shaderlab.custom.mainImage';
const CUSTOM_CHANNEL_URL_KEYS = [
  'shaderlab.custom.channel0',
  'shaderlab.custom.channel1',
  'shaderlab.custom.channel2',
  'shaderlab.custom.channel3',
];
const CUSTOM_DEBOUNCE_MS = 600;

export class UI {
  constructor({ shaderList = [], onLoadShader, onLoadMainImage, onSetChannelURL, onSetUniform, onRandomize, onExportAction } = {}){
    this.shaderList = shaderList;
    this.onLoadShader = onLoadShader;
    this.onLoadMainImage = onLoadMainImage;
    this.onSetChannelURL = onSetChannelURL;
    this.onSetUniform = onSetUniform;
    this.onRandomize = onRandomize;
    this.onExportAction = onExportAction;

    this.shaderSelect = document.getElementById('shaderSelect');
    this.uniformControls = document.getElementById('uniformControls');
    this.shaderDesc = document.getElementById('shaderDesc');
    this.randomizeBtn = document.getElementById('randomizeBtn');
    this.exportBtn = document.getElementById('exportBtn');
    this.exportMenu = document.getElementById('exportMenu');
    this.customShaderPanel = document.getElementById('customShaderPanel');
    this.customMainImage = document.getElementById('customMainImage');
    this.shaderCompileError = document.getElementById('shaderCompileError');
    this.channelUrlInputs = [
      document.getElementById('channel0Url'),
      document.getElementById('channel1Url'),
      document.getElementById('channel2Url'),
      document.getElementById('channel3Url'),
    ];

    this._customDebounceTimer = null;
    this._channelDebounceTimer = null;

    this._populateShaderList();
    this._attachListeners();
    this._showCustomPanel(false);

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
    this.shaderDesc.textContent = this.shaderList[0]?.description || '';
    this.shaderSelect.value = this.shaderList[0]?.id || '';
  }

  _isCustomMode(){
    return this.shaderSelect?.value === 'new';
  }

  _getNewShaderEntry(){
    return this.shaderList.find(s => s.id === 'new');
  }

  _readStored(key, fallback){
    try {
      const stored = localStorage.getItem(key);
      if(stored !== null && stored !== '') return stored;
    } catch (_) { /* ignore */ }
    return fallback;
  }

  _persistCustomSources(){
    try {
      localStorage.setItem(CUSTOM_MAIN_IMAGE_KEY, this.customMainImage.value);
      this.channelUrlInputs.forEach((input, i) => {
        if(input) localStorage.setItem(CUSTOM_CHANNEL_URL_KEYS[i], input.value);
      });
    } catch (_) { /* ignore */ }
  }

  _fillCustomTextareasFromTemplate(){
    const entry = this._getNewShaderEntry();
    const defaultMain = (entry?.mainImage || '').trim();
    this.customMainImage.value = this._readStored(CUSTOM_MAIN_IMAGE_KEY, defaultMain);
    this.channelUrlInputs.forEach((input, i) => {
      if(!input) return;
      input.value = this._readStored(CUSTOM_CHANNEL_URL_KEYS[i], '');
    });
  }

  _showCustomPanel(show){
    if(!this.customShaderPanel) return;
    this.customShaderPanel.classList.toggle('is-visible', show);
    this.customShaderPanel.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  _scheduleCustomCompile(){
    clearTimeout(this._customDebounceTimer);
    this._customDebounceTimer = setTimeout(() => {
      if(!this._isCustomMode()) return;
      this._persistCustomSources();
      this.onLoadMainImage && this.onLoadMainImage(this.customMainImage.value);
    }, CUSTOM_DEBOUNCE_MS);
  }

  _scheduleChannelReload(){
    clearTimeout(this._channelDebounceTimer);
    this._channelDebounceTimer = setTimeout(() => {
      if(!this._isCustomMode()) return;
      this._persistCustomSources();
      this.channelUrlInputs.forEach((input, i) => {
        if(!input || !this.onSetChannelURL) return;
        this.onSetChannelURL(i, input.value);
      });
    }, 400);
  }

  _enterCustomMode(){
    this._showCustomPanel(true);
    this._fillCustomTextareasFromTemplate();
    this.setCompileError(null);
    this.onLoadShader && this.onLoadShader('new');
    this.onLoadMainImage && this.onLoadMainImage(this.customMainImage.value);
    this.channelUrlInputs.forEach((input, i) => {
      if(input && this.onSetChannelURL) this.onSetChannelURL(i, input.value);
    });
  }

  _exitCustomMode(){
    this._showCustomPanel(false);
    this.setCompileError(null);
    clearTimeout(this._customDebounceTimer);
    clearTimeout(this._channelDebounceTimer);
  }

  setCompileError(message){
    if(!this.shaderCompileError) return;
    if(message){
      this.shaderCompileError.hidden = false;
      this.shaderCompileError.textContent = message;
    } else {
      this.shaderCompileError.hidden = true;
      this.shaderCompileError.textContent = '';
    }
  }

  getCustomSources(){
    return {
      mainImage: this.customMainImage?.value || '',
      channelUrls: this.channelUrlInputs.map((el) => el?.value || ''),
    };
  }

  _attachListeners(){
    this.shaderSelect.addEventListener('change', (e) => {
      const id = e.target.value;
      const entry = this.shaderList.find(s => s.id === id);
      this.shaderDesc.textContent = entry?.description || '';

      if(id === 'new'){
        this._enterCustomMode();
        return;
      }

      this._exitCustomMode();
      this.onLoadShader && this.onLoadShader(id);
    });

    this.customMainImage?.addEventListener('input', () => {
      if(!this._isCustomMode()) return;
      this._scheduleCustomCompile();
    });

    for(const input of this.channelUrlInputs){
      input?.addEventListener('change', () => {
        if(!this._isCustomMode()) return;
        this._scheduleChannelReload();
      });
    }

    this.randomizeBtn.addEventListener('click', () => {
      this.onRandomize && this.onRandomize();
    });

    const closeMenu = () => {
      if(!this.exportMenu) return;
      this.exportMenu.hidden = true;
      this.exportBtn?.setAttribute('aria-expanded', 'false');
    };

    const toggleMenu = () => {
      if(!this.exportMenu) return;
      const willOpen = this.exportMenu.hidden;
      this.exportMenu.hidden = !willOpen;
      this.exportBtn?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    };

    this.exportBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
    });

    this.exportMenu?.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-export-action]');
      if(!btn) return;
      const actionId = btn.getAttribute('data-export-action');
      closeMenu();
      this.onExportAction && this.onExportAction(actionId);
    });

    document.addEventListener('click', () => closeMenu());
    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape') closeMenu();
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
