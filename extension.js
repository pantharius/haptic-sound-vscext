"use strict";
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { AudioContext } = require("node-web-audio-api");

let audioContext = new AudioContext();
let gainNode = audioContext.createGain();
gainNode.connect(audioContext.destination);

/**
 * Load user configuration from settings
 */
function getConfig() {
  const config = vscode.workspace.getConfiguration("hapticsound");
  const basePath = path.join(__dirname, "sounds");

  return {
    enabled: config.get("enabled") !== false, // Default to true
    keySound: config.get("keySound") || path.join(basePath, "key.wav"),
    backspaceSound:
      config.get("backspaceSound") || path.join(basePath, "key.wav"),
    saveSound:
      config.get("saveSound") || path.join(basePath, "carriage-return.wav"),
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
  if (audioContext) audioContext.close();
}

module.exports = { activate, deactivate };
