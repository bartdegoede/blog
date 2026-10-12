// assets/js/ask/models.js
/**
 * Models offered on /ask/. Pinned to the exact Hugging Face revisions and
 * files the eval measured (scripts/ask_eval/candidates.json; a test keeps
 * them in sync). `faithful` / `invented` are the eval's numbers, shown on
 * the model cards. Zero imports.
 */

export const DEFAULT_MODEL_ID = "qwen3-0.6b";
export const CACHE_NAME = "transformers-cache"; // confirmed in Part 2 Task 1

export const MODELS = [
  {
    id: "qwen3-0.6b", name: "Qwen3-0.6B", role: "default", params: "0.6B",
    repo: "onnx-community/Qwen3-0.6B-ONNX", revision: "1e0a4a196ecabdf9a879664110574563d3f372d3", dtype: "q4f16",
    faithful: 15, invented: 5,
    files: [
      { path: "config.json", bytes: 912 },
      { path: "generation_config.json", bytes: 219 },
      { path: "onnx/model_q4f16.onnx", bytes: 569789750 },
      { path: "tokenizer.json", bytes: 9117040 },
      { path: "tokenizer_config.json", bytes: 10360 },
    ],
  },
  {
    id: "smollm2-360m", name: "SmolLM2-360M", role: "demo", params: "360M",
    repo: "HuggingFaceTB/SmolLM2-360M-Instruct", revision: "a10cc1512eabd3dde888204e902eca88bddb4951", dtype: "q4f16",
    faithful: 3, invented: 15,
    files: [
      { path: "config.json", bytes: 846 },
      { path: "generation_config.json", bytes: 132 },
      { path: "onnx/model_q4f16.onnx", bytes: 272737275 },
      { path: "tokenizer.json", bytes: 2104556 },
      { path: "tokenizer_config.json", bytes: 3764 },
    ],
  },
  {
    id: "gemma3-270m", name: "Gemma 3 270M", role: "demo", params: "270M",
    repo: "onnx-community/gemma-3-270m-it-ONNX", revision: "2dbbfdb1b59bd034eb959428c6a7da9dd7ea27f0", dtype: "q4f16",
    // q4f16 uses GatherBlockQuantized, which has no CPU/WASM kernel in onnxruntime-web (measured in Part 2).
    webgpuOnly: true,
    faithful: 3, invented: 13,
    files: [
      { path: "config.json", bytes: 1652 },
      { path: "generation_config.json", bytes: 202 },
      { path: "onnx/model_q4f16.onnx", bytes: 330717 },
      { path: "onnx/model_q4f16.onnx_data", bytes: 272626176 },
      { path: "tokenizer.json", bytes: 20323013 },
      { path: "tokenizer_config.json", bytes: 2313 },
    ],
  },
  {
    id: "lfm2.5-350m", name: "LFM2.5-350M", role: "demo", params: "350M",
    repo: "onnx-community/LFM2.5-350M-ONNX", revision: "7dd4999565b0342c381ba90a3d8fc467d6df19c4", dtype: "q4f16",
    // q4f16 uses GatherBlockQuantized, which has no CPU/WASM kernel in onnxruntime-web (measured in Part 2).
    webgpuOnly: true,
    faithful: 2, invented: 14,
    files: [
      { path: "config.json", bytes: 1443 },
      { path: "generation_config.json", bytes: 136 },
      { path: "onnx/model_q4f16.onnx", bytes: 182827 },
      { path: "onnx/model_q4f16.onnx_data", bytes: 254965760 },
      { path: "tokenizer.json", bytes: 3297793 },
      { path: "tokenizer_config.json", bytes: 3825 },
    ],
  },
];

export function totalBytes(model) {
  return model.files.reduce((sum, f) => sum + f.bytes, 0);
}

/** The URL transformers.js fetches (and caches under) for a pinned file. */
export function fileUrl(model, path) {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${path}`;
}

export function modelById(id) {
  return MODELS.find((m) => m.id === id);
}
