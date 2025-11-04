"use strict";
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { AudioContext } = require("node-web-audio-api");

let audioContext = new AudioContext();
let isActive = true;

/**
 * Load user configuration from settings
 */
function getConfig() {
  const config = vscode.workspace.getConfiguration("typewriterSounds");
  const basePath = path.join(__dirname, "sounds");
  return {
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
    if (!fs.existsSync(filePath)) return;
    const buffer = fs.readFileSync(filePath);
    // Convert Node.js Buffer to a guaranteed ArrayBuffer (avoid SharedArrayBuffer union)
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(arrayBuffer).set(
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    );
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start();
  } catch (error) {
    console.error(`Sound error: ${error.message}`);
  }
}

/**
 * Detects which sound to play when user types
 */
function handleTyping(event) {
  if (!isActive || event.contentChanges.length === 0) return;
  const config = getConfig();
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
function handleSave(document) {
  if (!isActive) return;
  const config = getConfig();
  playSound(config.saveSound);
}

/**
 * Extension activation
 */
function activate(context) {
  const onType = vscode.workspace.onDidChangeTextDocument(handleTyping);
  const onSave = vscode.workspace.onDidSaveTextDocument(handleSave);

  context.subscriptions.push(onType, onSave);

  vscode.window.showInformationMessage("🎹 Typewriter Sounds activated!");
}

function deactivate() {
  isActive = false;
  if (audioContext) audioContext.close();
}

module.exports = { activate, deactivate };
