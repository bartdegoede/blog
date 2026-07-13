"""Suggest genuinely-related posts via semantic similarity (authoring aid).

Prints ranked candidates for a post; never edits front matter. A human confirms
suggestions before they go into a post's `related:` list. See
docs/superpowers/specs/2026-07-12-related-posts-design.md.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np

CORPUS = Path("content/post")
MODEL = "minishlab/potion-retrieval-32M"
# Match the search index chunker so "related" sees posts the way search does.
CHUNK_SIZE = 600
CHUNK_OVERLAP = 120
DEFAULT_TOP = 3
DEFAULT_THRESHOLD = 0.35


def _l2(mat: np.ndarray) -> np.ndarray:
    """Row-wise (or vector) L2 normalize; zero rows stay zero."""
    mat = np.asarray(mat, dtype=np.float32)
    if mat.ndim == 1:
        norm = np.linalg.norm(mat)
        return mat / norm if norm else mat
    norms = np.linalg.norm(mat, axis=1, keepdims=True)
    return np.divide(mat, norms, out=np.zeros_like(mat), where=norms > 0)


def doc_vector(chunk_matrix: np.ndarray) -> np.ndarray:
    """Post vector = L2-normalized mean of L2-normalized chunk vectors."""
    unit = _l2(chunk_matrix)
    return _l2(unit.mean(axis=0))


def max_chunk_sim(a_chunks: np.ndarray, b_chunks: np.ndarray) -> float:
    """Largest cosine between any chunk of A and any chunk of B."""
    return float((_l2(a_chunks) @ _l2(b_chunks).T).max())


def rank_related(
    doc_vecs: dict[str, np.ndarray],
    chunk_mats: dict[str, np.ndarray],
    target: str,
    *,
    top: int = DEFAULT_TOP,
    threshold: float = DEFAULT_THRESHOLD,
) -> list[tuple[str, float, float]]:
    """[(slug, cosine, max_chunk_sim)] for the best `top` peers of `target`
    whose cosine >= threshold, best first. doc_vecs are already unit vectors."""
    tv = doc_vecs[target]
    scored: list[tuple[str, float, float]] = []
    for slug, vec in doc_vecs.items():
        if slug == target:
            continue
        cos = float(tv @ vec)
        if cos >= threshold:
            scored.append((slug, cos, max_chunk_sim(chunk_mats[target], chunk_mats[slug])))
    scored.sort(key=lambda t: t[1], reverse=True)
    return scored[:top]
