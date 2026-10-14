from indexnow import BASE, changed_urls, path_to_url

SITEMAP = f"""<urlset>
<url><loc>{BASE}</loc></url>
<url><loc>{BASE}some-post/</loc></url>
</urlset>"""


def test_path_to_url():
    assert path_to_url("index.html") == BASE
    assert path_to_url("some-post/index.html") == BASE + "some-post/"
    assert path_to_url("css/style.css") is None


def test_only_sitemap_pages_are_submitted():
    paths = [
        "index.html",
        "some-post/index.html",
        "old-slug/index.html",  # alias stub, not in sitemap
        "ask/index.html",  # noindex, not in sitemap
        "404.html",
        "index.json",
    ]
    assert changed_urls(paths, SITEMAP) == [BASE, BASE + "some-post/"]
