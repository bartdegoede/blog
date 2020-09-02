---
title: "Use Hugo Output Formats to generate Lunr index files for your static site search"
date: 2019-07-12T15:27:40-07:00
draft: false
slug: "use-hugo-output-formats-to-generate-lunr-index-files"
categories: ["hugo", "search", "lunr", "how-to"]
keywords: ["search", "hugo", "lunr", "how-to"]
description: I've been using Lunr.js to enable some basic site search on this blog. Lunr.js requires an index file that contains all the content you want to make available for search. In order to generate that file, I had a kind of hacky setup, depending on running a Grunt script on every deploy, which introduces a dependency on node, and nobody really wants any of that for just a static HTML website.
---

[I've been using Lunr.js]({{< ref "/post/2018-03-02-searching-your-hugo-site-with-lunr.md" >}}) to enable some basic site search on this blog. Lunr.js requires an [index file](/index.json) that contains all the content you want to make available for search. In order to generate that file, I had a kind of hacky setup, depending on running a [Grunt script](https://github.com/bartdegoede/blog/blob/7eccae434335c6ab6ec5e10240dbc89884a194ad/Gruntfile.js) on [every deploy](https://github.com/bartdegoede/blog/commit/335d19e81016633823ccfb6fbb2038c891182bbb#diff-60254338249f657a0a83f98258a56bfeL9), which introduces a dependency on node, and nobody really wants any of that for just a static HTML website.<!--more-->

{{<audio src="/audio/2019-07-12-use-output-format-for-index-generation.mp3" type="mp3" backup_src="/audio/2019-07-12-use-output-format-for-index-generation.ogg" backup_type="ogg">}}

I have been wanting forever to have Hugo build that file for me instead[^gh_issue]. As it turns out, [Output Formats](https://gohugo.io/templates/output-formats/#output-formats-for-pages)[^hugo] make building that index file _very_ easy. Output formats let you generate your content in other formats than HTML, such as AMP or [XML for an RSS feed](https://bart.degoe.de/index.xml), and it also speaks JSON.

The search on my blog lives on the homepage, where some [(very ugly) Javascript](https://github.com/bartdegoede/blog/blob/335d19e81016633823ccfb6fbb2038c891182bbb/static/js/search/search.js) downloads the index file, parses it contents into an [inverted index](https://en.wikipedia.org/wiki/Inverted_index), and replaces the content on the page with search results whenever someone starts typing. Essentially, I want to create some JSON output on my homepage ([`index.json`](/index.json) instead of [`index.html`](/index.html)).

I added the following snippet to my [`config.toml`](https://github.com/bartdegoede/blog/blob/335d19e81016633823ccfb6fbb2038c891182bbb/config.toml#L24-L26), that says that besides HTML, the homepage also has JSON output:

```toml
[outputs]
    home = ["HTML", "JSON"]
    page = ["HTML"]
```
**N.B.:** this means that there won't be a JSON version of the other pages; I just need it on my homepage, because that serves as the search results page too.

Now, I don't want that `index.json` file to basically be the list of links it is in the HTML version and in the RSS feed, so I [added an `index.json` file](https://github.com/bartdegoede/blog/blob/335d19e81016633823ccfb6fbb2038c891182bbb/layouts/index.json) in my `layouts` folder with the following content:

```
[
    {{ range $index, $page := .Site.Pages }}
    {{- if eq $page.Type "post" -}}
        {{- if $page.Plain -}}
            {{- if and $index (gt $index 0) -}},{{- end }}
                {
                    "href": "{{ $page.Permalink }}",
                    "title": "{{ htmlEscape $page.Title }}",
                    "categories": [{{ range $tindex, $tag := $page.Params.categories }}{{ if $tindex }}, {{ end }}"{{ $tag| htmlEscape }}"{{ end }}],
                    "content": {{$page.Plain | jsonify}}
                }
            {{- end -}}
      {{- end -}}
    {{- end -}}
]
```

This will render a JSON file (named [`index.json`](/index.json)) with an array in the [root directory of my site](https://github.com/bartdegoede/bartdegoede.github.io/blob/master/index.json), and every item in that array is one of the `.Site.Pages` (i.e. my posts), whenever that page has text in it and it's not the homepage. I didn't bother with minification, because the file is tiny and will be served nicely gzipped by [Cloudflare]({{< ref "/post/2018-03-28-free-ssl-on-github-pages-with-a-custom-domain.md" >}}) anyway. Whenever Hugo builds the site, it will reindex all the data (i.e. rebuild this file), and I don't have a dependency on Node and Grunt scripts anymore.

[^hugo]: Ships with Hugo version 0.20.0 or greater.
[^gh_issue]: Ever since someone opened [a GitHub issue](https://github.com/bartdegoede/blog/issues/1) about it 😄
