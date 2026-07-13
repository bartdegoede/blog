import numpy as np

from suggest_related import doc_vector, max_chunk_sim, rank_related


def test_doc_vector_is_unit_length_mean():
    mat = np.array([[3.0, 0.0], [0.0, 4.0]], dtype=np.float32)  # -> unit rows [1,0],[0,1]
    v = doc_vector(mat)
    assert np.allclose(np.linalg.norm(v), 1.0, atol=1e-6)
    assert np.allclose(v, [0.7071, 0.7071], atol=1e-3)


def test_max_chunk_sim_takes_best_pair():
    a = np.array([[1.0, 0.0]], dtype=np.float32)
    b = np.array([[0.0, 1.0], [0.8, 0.6]], dtype=np.float32)
    assert np.isclose(max_chunk_sim(a, b), 0.8, atol=1e-6)


def test_rank_related_orders_and_thresholds():
    single = lambda v: np.array([v], dtype=np.float32)
    chunk_mats = {
        "a": single([1.0, 0.0, 0.0]),
        "b": single([0.9, 0.1, 0.0]),   # close to a
        "c": single([0.0, 0.0, 1.0]),   # orthogonal to a
    }
    doc_vecs = {k: doc_vector(m) for k, m in chunk_mats.items()}
    hits = rank_related(doc_vecs, chunk_mats, "a", top=3, threshold=0.5)
    assert [h[0] for h in hits] == ["b"]        # c filtered by threshold
    assert hits[0][1] > 0.98                     # cosine(a,b)
