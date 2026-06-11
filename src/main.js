/**
 * main.js
 * Entry point: wires ShaderLab and UI
 */

import { ShaderLab } from './shaderLab.js';
import { UI } from './ui.js';
import { SHADERS } from './shaders.js';

const DEFAULT_SHADER = SHADERS[0].id;

function pickMimeType(){
  if(typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  const candidates = [
    // Prefer MP4 if the browser supports it (often not available).
    'video/mp4;codecs=h264',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || null;
}

/** MediaRecorder defaults are very low bitrate → blocky exports on large canvases. */
function estimateVideoBitrate(canvas, fps){
  const w = canvas.width;
  const h = canvas.height;
  const pixels = w * h;
  // ~0.08 bpp/frame is a reasonable target for shader gradients; clamp to sane range.
  const bps = Math.round(pixels * fps * 0.08);
  return Math.min(50_000_000, Math.max(12_000_000, bps));
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function init(){
  const container = document.getElementById('canvasWrap');
  // Create the ShaderLab instance
  const lab = new ShaderLab(container, DEFAULT_SHADER, SHADERS);

  // Create UI and link it to the lab
  const ui = new UI({
    shaderList: SHADERS,
    onLoadShader: (id) => {
      if(id === 'new'){
        lab.loadShader('new');
        return;
      }
      lab.loadShader(id);
    },
    onLoadMainImage: (mainImageSource) => {
      const result = lab.loadMainImage(mainImageSource);
      ui.setCompileError(result.ok ? null : result.log);
      if(result.ok) lab.onUniformChanged?.([]);
    },
    onSetChannelURL: (index, url) => lab.setChannelURL(index, url),
    onSetUniform: (name, value) => lab.setUniform(name, value),
    onRandomize: () => ui.applyConfig(lab.randomizeCurrentConfig()),
    onExportAction: async (actionId) => {
      if(actionId === 'copyShaderCode'){
        const bundle = lab.getShaderSourceBundle();
        if(lab.currentShaderId === 'new'){
          const custom = ui.getCustomSources();
          bundle.userMainImage = custom.mainImage;
        }
        const parts = [
          `// ShaderLab export: ${bundle.name} (${bundle.shaderId})`,
          '',
          '// vertex.glsl (fixed Shadertoy quad)',
          bundle.vertex,
          '',
        ];
        if(bundle.userMainImage != null){
          parts.push('// mainImage (user)', bundle.userMainImage, '', '// full compiled fragment.glsl', bundle.fragment, '');
        } else {
          parts.push('// fragment.glsl', bundle.fragment, '');
        }
        parts.push('// uniforms (current values)', JSON.stringify(bundle.uniformsCurrent, null, 2));
        const payload = parts.join('\n');

        try {
          await navigator.clipboard.writeText(payload);
          alert('Shader-Code copied to clipboard!');
        } catch (e) {
          const w = window.open('', '_blank');
          w.document.body.innerText = payload;
        }
        return;
      }

      if(actionId === 'exportVideo'){
        const mimeType = pickMimeType();
        if(!mimeType){
          alert('Video export not supported in this browser (MediaRecorder unavailable).');
          return;
        }

        const fps = 60;
        const durationMs = 5000;
        const canvas = lab.getActiveCanvas();
        if(!canvas?.captureStream){
          alert('Video export not supported (canvas.captureStream unavailable).');
          return;
        }

        const prevTime = lab.getTime();
        lab.setTime(0);

        const stream = canvas.captureStream(fps);
        const videoBitsPerSecond = estimateVideoBitrate(canvas, fps);
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
        const chunks = [];

        const stopped = new Promise((resolve) => {
          recorder.addEventListener('stop', resolve, { once: true });
        });

        recorder.addEventListener('dataavailable', (e) => {
          if(e.data && e.data.size > 0) chunks.push(e.data);
        });

        recorder.start();
        setTimeout(() => {
          if(recorder.state !== 'inactive') recorder.stop();
        }, durationMs);

        await stopped;
        stream.getTracks().forEach(t => t.stop());
        lab.setTime(prevTime);

        const blob = new Blob(chunks, { type: mimeType });
        const safeId = (lab.currentShaderId || 'shader').replace(/[^a-z0-9_-]+/gi, '_');
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        if(ext !== 'mp4'){
          alert('MP4 export is not supported by this browser. Exporting as WebM instead.');
        }
        downloadBlob(blob, `${safeId}_${Math.round(durationMs/1000)}s.${ext}`);
        return;
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
