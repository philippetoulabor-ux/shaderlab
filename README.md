# Shader Lab - Three.js Playground

Kurzes Demo-Projekt: interaktiver Shader-Playground mit Three.js.

Quick start:
1. Erstelle einen Ordner und kopiere die Dateien hinein (index.html, styles.css, src/...).
2. Starte einen lokalen Static-Server, z.B. mit Python:

```bash
python -m http.server 8000
```

3. Öffne `http://localhost:8000` im Browser.

Erweiterung:
- Neue Shader in `src/shaders.js` registrieren (eintrag in `SHADERS`).
- `ShaderLab` bietet `loadShader`, `setUniform`, `getConfig`, `applyConfig`, `randomizeCurrentConfig`.
