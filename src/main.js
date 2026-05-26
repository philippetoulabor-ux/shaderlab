/**
 * main.js
 * Entry point: wires ShaderLab and UI
 */

import { ShaderLab } from './shaderLab.js';
import { UI } from './ui.js';
import { SHADERS } from './shaders.js';

const DEFAULT_SHADER = SHADERS[0].id;

async function init(){
  const container = document.getElementById('canvasWrap');
  // Create the ShaderLab instance
  const lab = new ShaderLab(container, DEFAULT_SHADER, SHADERS);

  // Create UI and link it to the lab
  const ui = new UI({
    shaderList: SHADERS,
    onLoadShader: (id) => lab.loadShader(id),
    onSetUniform: (name, value) => lab.setUniform(name, value),
    onRandomize: () => ui.applyConfig(lab.randomizeCurrentConfig()),
    onExport: async () => {
      const cfg = lab.getConfig();
      const json = JSON.stringify(cfg, null, 2);
      try {
        await navigator.clipboard.writeText(json);
        alert('Config copied to clipboard!');
      } catch (e) {
        // fallback: open in new window
        const w = window.open('', '_blank');
        w.document.body.innerText = json;
      }
    }
  });

  // Forward updates from ShaderLab to UI (e.g., time-based uniform changes aren't needed)
  lab.onUniformChanged = (uniforms) => ui.updateControls(uniforms);

  // Start
  lab.start();

  // Clean up on unload
  window.addEventListener('beforeunload', () => lab.dispose());
}

window.addEventListener('DOMContentLoaded', init);
