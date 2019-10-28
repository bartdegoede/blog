---
title: "Searching your Hugo site with Lunr"
date: 2018-03-04T23:38:44+01:00
draft: false
slug: "searching-your-hugo-site-with-lunr"
categories: ["hugo", "search", "lunr", "javascript", "how-to"]
keywords: ["hugo", "search", "lunr", "javascript"]
---

Like many software engineers, I figured I needed a blog of sorts, because it would give me a place for my own notes on "How To Do Things™", let me have a URL to give people, and share my ramblings about Life, the Universe and Everything Else with whoever wants to read them.<!--more-->

{{< audio src="/audio/2018-03-02-searching-your-hugo-site-with-lunr.mp3" type="mp3" backup_src="/audio/2018-03-02-searching-your-hugo-site-with-lunr.ogg" backup_type="ogg">}}

Because I'm trying to get more familiar with [Go](https://golang.org/), I opted to use the awesome [Hugo](https://gohugo.io/)[^hugo] framework to build myself a static site hosted on [Github Pages](https://pages.github.com/).

In my day job I work on our search engine, so the first thing that I wanted to have was some basic search functionality for all the blog posts I haven't written yet, preferably something that ~~I can mess with~~ is extensible and configurable.

There are three options if you want to add search functionality to a static website, each with their pros and cons:

1. **Third-party service (i.e. Google CSE):**
<br>There are a bunch of services that provide basic search widgets for your site, such as [Google Custom Search Engine (CSE)](https://cse.google.com/cse/). Those are difficult to customise, break your UI with their Google-styled widgets, and (in some cases) will display ads on your website[^google_ads].
2. **Run a server-side search engine:**
<br>You can set up a backend that indexes your data and can process the queries your users submit in the search box on your website. The obvious downside is that you throw away all the benefits of having a static site (free hosting, complex infrastructure).
3. **Search client-side**:
<br>Having a static site, it makes sense to move all the user interaction to the client. We depend on the users' browser to run Javascript[^my_users] and download the searchable data in order to run queries against it, but the upside is that you can control how data is processed and how that data is queried. Fortunately for us, [Atwood's Law](https://blog.codinghorror.com/the-principle-of-least-power/) holds true; there's a full-text search library inspired by Lucene/Solr written in Javascript we can use to implement our search engine: [Lunr.js](https://lunrjs.com/).

# Relevance

When thinking about search, the most important question is what users want to find. This sounds very much like an open door, but you'd be surprised how often this gets overlooked; what are we looking for (tweets, products, (the fastest route to) a destination?), who is doing the search (lawyers, software engineers, my mom?), what do we hope to get out of it (money, page views?).

In our case, we're searching blog posts that have titles, tags and content (in decreasing order of value to relevance); queries matching titles should be more important than matches in post content[^relevance].

# Indexing

The project folder for my blog[^github] looks roughly like this:

```
blog/ <= Hugo project root folder
|- content/ <- this is where the pages I want to be searchable live
    |- about.md
    |- post/
        |- 2018-01-01-first-post.md
        |- 2018-01-15-second-post.md
        |- ...
|- layout/
    |- partials/ <- these contain the templates we need for search
        |- search.html
        |- search_scripts.html
|- static/
    |- js/
        |- search/ <- Where we generate the index file
        |- vendor/
            |- lunrjs.min.js <- lunrjs library; https://cdnjs.com/libraries/lunr.js/
|- ...
|- config.toml
|- ...
|- Gruntfile.js <- This will build our index
|- ...
```

The idea is that we build an index on site generation time, and fetch that file when a user loads the page.

I use [`Gruntjs`](https://gruntjs.com/)[^grunt_to_go] to build the index file, and some dependencies that make life a little easier. Install them with `npm`:

<code class="bash">
$ npm install --save-dev grunt string gray-matter
</code>

This is my [`Gruntfile.js`](https://github.com/bartdegoede/blog/blob/master/Gruntfile.js) that lives in the root of my project. It will walk through the `content/` directory and parse all the markdown files it finds. It will parse out `title`, `categories` and `href` (this will be the reference to the post; i.e. the URL of the page we want to point to) from the front matter, and the `content` from the rest of the post. It also skips posts that are labeled `draft`, because I don't want the posts I'm still working on to already show up in the search results.

```
var matter = require('gray-matter');
var S = require('string');

var CONTENT_PATH_PREFIX = 'content';

module.exports = function(grunt) {
    grunt.registerTask('search-index', function() {
        grunt.log.writeln('Build pages index');

        var indexPages = function() {
            var pagesIndex = [];
            grunt.file.recurse(CONTENT_PATH_PREFIX, function(abspath, rootdir, subdir, filename) {
                grunt.verbose.writeln('Parse file:', abspath);
                d = processMDFile(abspath, filename);
                if (d !== undefined) {
                    pagesIndex.push(d);
                }
            });
            return pagesIndex;
        };

        var processMDFile = function(abspath, filename) {
            var content = matter(grunt.file.read(abspath, filename));
            if (content.data.draft) {
                // don't index draft posts
                return;
            }
            var pageIndex;
            return {
                title: content.data.title,
                categories: content.data.categories,
                href: content.data.slug,
                content: S(content.content).trim().stripTags().stripPunctuation().s
            };
        };

        grunt.file.write('static/js/search/index.json', JSON.stringify(indexPages()));
        grunt.log.ok('Index built');
    });
};
```

To run this task, simply run `grunt search-index` in the directory where `Gruntfile.js` is located[^deploy]. This will generate a JSON index file looking like this:

```
[
    {
        "content": "Hi My name is Bart de Goede and ...",
        "href": "about",
        "title": "About"
    },
    {
        "content": "Like many software engineers, I figured I needed a blog of sorts...",
        "href": "Searching-your-hugo-site-with-lunr",
        "title": "Searching your Hugo site with Lunr",
        "categories": [ "hugo", "search", "lunr", "javascript" ]
    },
    ...
]
```

# Querying

Now we've built the index, we need a way of obtaining it client-side, and then query it. To do that, I have two partials that include [the markup for the search input box](https://github.com/bartdegoede/blog/blob/master/layouts/partials/search.html) and the links to the [relevant Javascript](https://github.com/bartdegoede/blog/blob/master/layouts/partials/search_scripts.html):

```
<script type="text/javascript" src="https://code.jquery.com/jquery-2.1.3.min.js"></script>
<script type="text/javascript" src="js/vendor/lunr.min.js"></script>
<script type="text/javascript" src="js/search/search.js"></script>
<!-- js/search/search.js contains the code that downloads and initialises the index -->
...
<input type="text" id="search">
```

For my blog, I have one [`search.js` file](https://github.com/bartdegoede/blog/blob/master/static/js/search/search.js) that will download the index file, initialise the UI, and run the searches. For the sake of readability, I've split up the relevant functions below and added some comments to the code.

This function fetches the index file we've generated with the Grunt task, initialises the relevant fields, and then adds the each of the documents to the index. The `pagesIndex` variable will store the documents as we indexed them, and the `searchIndex` variable will store the statistics and data structures we need to rank our documents for a query efficiently.

```
function initSearchIndex() {
  // this file is built by the Grunt task, and
  $.getJSON('js/search/index.json')
    .done(function(documents) {
      pagesIndex = documents;
      searchIndex = lunr(function() {
        this.field('title');
        this.field('categories');
        this.field('content');
        this.ref('href');

        // This will add all the documents to the index. This is
        // different compared to older versions of Lunr, where
        // documents could be added after index initialisation
        for (var i = 0; i < documents.length; ++i) {
          this.add(documents[i])
        }
      });
    })
    .fail(function(jqxhr, textStatus, error) {
      var err = textStatus + ', ' + error;
      console.error('Error getting index file:', err);
    }
  );
}

initSearchIndex();
```

Then, we need to sprinkle some jQuery magic on the input box. In my case, I want to start searching once a user has typed at least two characters, and support a typeahead style of searching, so everytime a character is entered, I want to empty the current search results (if any), run the `searchSite` function with whatever is in the input box, and render the results.

```
function initUI() {
  $results = $('.posts');
  // or whatever element is supposed to hold your results
  $('#search').keyup(function() {
    $results.empty();
    // only search when query has 2 characters or more
    var query = $(this).val();
    if (query.length < 2) {
      return;
    }
    var results = searchSite(query);
    renderResults(results);
  });
}

$(document).ready(function() {
  initUI();
});
```

The `searchSite` function will take the `query_string` the user typed in and build a `lunr.Query` object and run it against the index (stored in the `searchIndex` variable). The `lunr` index will return a ranked list of `ref`s (these are the identifiers we assigned to the documents in the `Gruntfile`). The second part of this method maps these identifiers to the original documents we stored in the `pagesIndex` variable.

```
// this function will parse the query_string, which will you
// to run queries like "title:lunr" (search the title field),
// "lunr^10" (boost hits with this term by a factor 10) or
// "lunr~2" (will match anything within an edit distance of 2,
// i.e. "losr" will also match)
function simpleSearchSite(query_string) {
  return searchIndex.search(query_string).map(function(result) {
    return pagesIndex.filter(function(page) {
      return page.href === result.ref;
    })[0];
  });
}

// I want a typeahead search, so if a user types a query like
// "pyth", it should show results that contain the word "Python",
// rather than just the entire word.
function searchSite(query_string) {
  return searchIndex.query(function(q) {
    // look for an exact match and give that a massive positive boost
    q.term(query_string, { usePipeline: true, boost: 100 });
    // prefix matches should not use stemming, and lower positive boost
    q.term(query_string, { usePipeline: false, boost: 10, wildcard: lunr.Query.wildcard.TRAILING });
  }).map(function(result) {
    return pagesIndex.filter(function(page) {
      return page.href === result.ref;
    })[0];
  });
}
```

The snippet above lists two methods. The first shows an example of a search using the default `lunr.Index#search` method, which uses the `lunr` query syntax.

In my case, I want to support a typeahead search, where we show the user results for partial queries too; if the user types `"pyth"`, we should display results that have the word `"python"` in the post. To do that, we tell Lunr to combine two queries: the first `q.term` provides _exact matches_ with a high boost to relevance (because we it's likely that these matches are relevant to the user), the second appends a trailing wildcard to the query[^trie], providing prefix matches with a (lower) boost.

Finally, given the ranked list of results (containing _all_ pages in the `content/` directory), we want to render those somewhere on the page. The `renderResults` method slices the result list to the first ten results, creates a link to the appropriate post based on the `href`, and creates a (crude) snippet based on the 100 first characters of the content.
```
function renderResults(results) {
  if (!results.length) {
    return;
  }

  results.slice(0, 10).forEach(function(hit) {
    var $result = $('<li>');
    $result.append($('<a>', {
      href: hit.href,
      text: '» ' + hit.title
    }));
    $result.append($('<p/>', { text: hit.content.slice(0, 100) + '...' }));
    $results.append($result);
  });
}
```

This is a pretty naive approach to introducing full-text search to a static site (I use Hugo, but this will work with static site generators like Jekyll or Hyde too); it completely ignores other languages than English (there's [support for other languages](https://lunrjs.com/guides/language_support.html) too), let alone non whitespace languages like Chinese, and it requires users to download the full index that contains all your searchable pages, so it won't scale as nicely if you have thousands of pages. For my personal blog though, it's good enough 😇.

[^hugo]: It's fast, it's written in Golang, it supports [fancy themes](https://themes.gohugo.io/), and it's [open source](https://github.com/gohugoio/hugo)!
[^google_ads]: You can [make money](https://support.google.com/adsense/answer/9879?visit_id=1-636557905318663395-3173001859&ctx=as2&hl=en&rd=2&ref_topic=1705820) off theses ads, but the question is whether you want to show ads on your personal blog or not.
[^my_users]: I'm assuming that the audience that'll land on these pages will have Javascript enabled in their browser 😄
[^relevance]: In this case, I'm totally assuming that if words from the query occur in the title or the manually assigned tags of a post are way more relevant than matches in the content of a post, if only because there's a lot more words in post content, so there's a higher probability of matching _any_ word in the query.
[^github]: It's also on [GitHub](https://github.com/bartdegoede/blog).
[^grunt_to_go]: A port of this script to Golang is in the works.
[^deploy]: The idea is to run the task before you deploy the latest version of your site. In my case, I have a [`deploy.sh` script](https://github.com/bartdegoede/blog/blob/master/deploy.sh) that runs Hugo to build my static pages, runs `grunt search-index` and pushes the result to GitHub.
[^trie]: Lunr uses tries to represent terms internally, giving us an efficient way of doing fast prefix lookups.
