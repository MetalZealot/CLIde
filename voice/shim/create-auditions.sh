#!/usr/bin/env bash
# Create one WAV audition per locally installed Piper model.
#
# Run with the shim venv active or directly:
#   ~/voice/shim/create-auditions.sh
#
# By default it renders all en_US models. To audition another language or a
# manually added model, override the glob, for example:
#   PIPER_AUDITION_GLOB='en_GB-*.onnx' ./create-auditions.sh
#   PIPER_AUDITION_GLOB='my-voice.onnx' ./create-auditions.sh
set -euo pipefail

VOICE_ROOT=/home/gnuthall/voice
MODELS_DIR="$VOICE_ROOT/models"
OUTPUT_DIR="$VOICE_ROOT/auditions"
TEXT_FILE="$VOICE_ROOT/audition-text.txt"
PIPER="$VOICE_ROOT/.venv/bin/piper"
MODEL_GLOB="${PIPER_AUDITION_GLOB:-en_US-*.onnx}"

[[ -x "$PIPER" ]] || { echo "Piper is not installed: $PIPER" >&2; exit 1; }
[[ -r "$TEXT_FILE" ]] || { echo "Missing audition text: $TEXT_FILE" >&2; exit 1; }
mkdir -p "$OUTPUT_DIR"

shopt -s nullglob
models=("$MODELS_DIR"/$MODEL_GLOB)
(( ${#models[@]} )) || { echo "No models matching $MODEL_GLOB in $MODELS_DIR" >&2; exit 1; }

text=$(<"$TEXT_FILE")
for model_path in "${models[@]}"; do
  model_name=$(basename "$model_path" .onnx)
  output_path="$OUTPUT_DIR/$model_name.wav"
  echo "Rendering $model_name"
  "$PIPER" -m "$model_name" --data-dir "$MODELS_DIR" -f "$output_path" -- "$text"
done

echo "Wrote ${#models[@]} auditions to $OUTPUT_DIR"
