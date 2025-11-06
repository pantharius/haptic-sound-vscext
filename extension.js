"use strict";
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { AudioContext } = require("node-web-audio-api");

let audioContext = new AudioContext();
let gainNode = audioContext.createGain();
gainNode.connect(audioContext.destination);

/**
 * Determine if a string looks like a path to a file.
 */
function isLikelyPath(value) {
  if (!value || typeof value !== "string") return false;
  return (
    value.endsWith(".wav") ||
    value.endsWith(".mp3") ||
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.includes(path.sep)
  );
}

/**
 * Load themes mapping from themes.json if present, otherwise use defaults.
 */
let themesCache = null;
function getThemesMap() {
  if (themesCache) return themesCache;

  const basePath = path.join(__dirname, "sounds");
  const themesJsonPath = path.join(__dirname, "themes.json");
  try {
    if (fs.existsSync(themesJsonPath)) {
      const raw = fs.readFileSync(themesJsonPath, "utf8");
      const parsed = JSON.parse(raw);
      // Normalize relative paths to absolute
      const normalized = {};
      for (const [themeName, mapping] of Object.entries(parsed)) {
        normalized[themeName.toLowerCase()] = {
          key: path.isAbsolute(mapping.key)
            ? mapping.key
            : path.join(__dirname, mapping.key),
          backspace: path.isAbsolute(mapping.backspace)
            ? mapping.backspace
            : path.join(__dirname, mapping.backspace),
          save: path.isAbsolute(mapping.save)
            ? mapping.save
            : path.join(__dirname, mapping.save),
        };
      }
      themesCache = normalized;
      return themesCache;
    }
  } catch (e) {
    console.error(`Failed to load themes.json: ${e.message}`);
  }

  // Fallback defaults if no JSON or failed to parse
  themesCache = {
    typewriter: {
      key: path.join(basePath, "key.wav"),
      backspace: path.join(basePath, "key.wav"),
      save: path.join(basePath, "carriage-return.wav"),
    },
  };
  return themesCache;
}

/**
 * Resolve a sound setting which can be a theme name or a file path.
 * kind: "key" | "backspace" | "save"
 */
function resolveSound(kind, configured) {
  const basePath = path.join(__dirname, "sounds");

  // If configured as a path, return absolute path (resolve relative to extension root)
  if (isLikelyPath(configured)) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(__dirname, configured);
  }

  // Theme mapping – default 'typewriter'
  const theme = (configured || "typewriter").toLowerCase();
  const themeFileMap = getThemesMap();

  if (themeFileMap[theme] && themeFileMap[theme][kind]) {
    return themeFileMap[theme][kind];
  }

  // Fallback to typewriter if unknown theme
  return themeFileMap.typewriter[kind];
}

/**
 * Load user configuration from settings
 */
function getConfig() {
  const config = vscode.workspace.getConfiguration("hapticsound");
  const themeConfig = config.get("theme");

  let keySound, backspaceSound, saveSound;

  // Check if theme parameter is configured
  if (themeConfig !== undefined) {
    // Test if theme is a string or an object
    if (typeof themeConfig === "string") {
      // If it's a string, use it as theme name for all sounds
      keySound = resolveSound("key", themeConfig);
      backspaceSound = resolveSound("backspace", themeConfig);
      saveSound = resolveSound("save", themeConfig);
    } else if (typeof themeConfig === "object" && themeConfig !== null) {
      // If it's an object, use the individual properties
      keySound = resolveSound("key", themeConfig.key);
      backspaceSound = resolveSound("backspace", themeConfig.backspace);
      saveSound = resolveSound("save", themeConfig.save);
    } else {
      // Fallback to default if theme is invalid
      keySound = resolveSound("key", "typewriter");
      backspaceSound = resolveSound("backspace", "typewriter");
      saveSound = resolveSound("save", "typewriter");
    }
  } else {
    // Fallback to legacy individual settings for backward compatibility
    keySound = resolveSound("key", "typewriter");
    backspaceSound = resolveSound("backspace", "typewriter");
    saveSound = resolveSound("save", "typewriter");
  }

  return {
    enabled: config.get("enabled") !== false, // Default to true
    keySound,
    backspaceSound,
    saveSound,
  };
}

/**
 * Plays the given sound file asynchronously
 */
async function playSound(filePath) {
  try {
    const config = getConfig();
    if (!config.enabled || !fs.existsSync(filePath)) return;

    const buffer = fs.readFileSync(filePath);
    // Convert Node.js Buffer to a guaranteed ArrayBuffer (avoid SharedArrayBuffer union)
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(arrayBuffer).set(
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    );
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNode); // Connect to gain node instead of directly to destination

    // Apply slight random pitch variation to avoid repetitive sound
    // Playback rate around 1.0 +/- ~40%
    const min = 0.6;
    const max = 1.4;
    source.playbackRate.value = Math.random() * (max - min) + min;

    source.start();
  } catch (error) {
    console.error(`Sound error: ${error.message}`);
  }
}

/**
 * Detects which sound to play when user types
 */
function handleTyping(event) {
  if (event.contentChanges.length === 0) return;
  const config = getConfig();
  if (!config.enabled) return;

  const change = event.contentChanges[0];

  // Detect deletion or backspace
  if (change.text === "" && change.rangeLength > 0) {
    playSound(config.backspaceSound);
    return;
  }

  // Regular typing
  playSound(config.keySound);
}

/**
 * Plays the save sound when a document is saved
 */
function handleSave() {
  const config = getConfig();
  if (!config.enabled) return;
  playSound(config.saveSound);
}

/**
 * Toggle enabled state
 */
async function toggleEnabled() {
  const config = vscode.workspace.getConfiguration("hapticsound");
  const currentValue = config.get("enabled") !== false;
  await config.update(
    "enabled",
    !currentValue,
    vscode.ConfigurationTarget.Global
  );
  vscode.window.showInformationMessage(
    `🎹 Haptic Sounds ${!currentValue ? "enabled" : "disabled"}`
  );
}

/**
 * Update volume from settings
 */
function updateVolume() {
  const config = vscode.workspace.getConfiguration("hapticsound");
  const volume = (config.get("volume") || 50) / 100;
  gainNode.gain.value = volume;
}

/**
 * Extension activation
 */
function activate(context) {
  // Initialize volume from settings
  updateVolume();

  const onType = vscode.workspace.onDidChangeTextDocument(handleTyping);
  const onSave = vscode.workspace.onDidSaveTextDocument(handleSave);

  // Listen for configuration changes to update volume dynamically
  const onConfigChange = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration("hapticsound.volume") ||
      event.affectsConfiguration("hapticsound.enabled")
    ) {
      updateVolume();
    }
  });

  // Register commands
  const toggleCommand = vscode.commands.registerCommand(
    "hapticsound.toggle",
    toggleEnabled
  );
  context.subscriptions.push(onType, onSave, onConfigChange, toggleCommand);

  vscode.window.showInformationMessage("🎹 Typewriter Sounds activated!");
}

function deactivate() {
  try {
    if (audioContext && typeof audioContext.close === "function") {
      audioContext.close();
    }
  } catch (e) {
    // Ignore shutdown errors
  }
}

module.exports = {
  activate,
  deactivate,
  resolveSound,
  getThemesMap,
  isLikelyPath,
};
