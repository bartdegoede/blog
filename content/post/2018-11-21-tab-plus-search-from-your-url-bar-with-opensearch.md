---
title: "Custom OpenSearch: search from your URL bar"
date: 2018-11-21T11:00:00-08:00
draft: false
slug: "tab-plus-search-from-your-url-bar-with-opensearch"
categories: ["search", "opensearch", "how-to"]
keywords: ["search", "opensearch", "how-to"]
---

Almost all modern browsers enable websites to customize the built-in search feature to let the user access their search features directly, without going to your website first and finding the search input box. If your website has search functionality accessible through a basic GET request, it's surprisingly simple to enable this for your website too.<!--more-->

{{<audio src="/audio/2018-11-21-tab-plus-search-from-your-url-bar-with-opensearch.mp3" type="mp3" backup_src="/audio/2018-11-20-tab-plus-search-from-your-url-bar-with-opensearch.ogg" backup_type="ogg">}}

{{< figure src="/img/2018-11-20-tab-plus-search-from-your-url-bar-with-opensearch/opensearch-on-bart-degoe-de.png" title="Typing 'bart' and hitting tab in my Chrome browser lets me search the website directly." >}}

# Some browsers do it automatically

If your users are on Chrome, chances are this already works! Chromium [tries really hard](https://dev.chromium.org/tab-to-search) to figure out where your search page is and how to access it. A strong hint you can give it is to change the type of the `<input>` element to `"search"`[^input]:

```
<input autocapitalize="off" autocorrect="off" autocomplete="off" name="q" placeholder="Search" type="search">
```

The `"name"` attribute gives the browser a hint as to what HTTP parameter will hold the query (it is a good idea to [configure your Google Analytics](https://support.google.com/analytics/answer/1012264) to pick this up as well!).

This will let the browser add some nice UI elements to the search input box, like a small "x" button on the right to clear the search input in Safari and Chrome. Enabling the `"autocapitalize"`, `"autocorrect"` and `"autocomplete"` attributes will instruct your browser to modify and correct the user input even further (think of the iOS autocorrect feature, for example).

{{< figure src="/img/2018-11-20-tab-plus-search-from-your-url-bar-with-opensearch/search-input-ui.png" title="Just by changing the input type you can hook in to the browsers' native UX." >}}

## Word of warning

Because once upon a time [apple.com](https://www.apple.com/) relied on the `type` attribute to give their search box a more "Mac-like" feel, [Safari will basically ignore any CSS](http://diveintohtml5.info/forms.html#type-search) applied to `<input type="search">` elements. If you need Safari to treat your search field like any other input field for display purposes, you can add the following to your CSS:

```
input[type="search"] {
  -webkit-appearance: textfield;
}
```

This will let you apply your own styles to the input box.

# Others don't

Not all browsers do this out of the box, so you need to provide them with a more formalized configuration. Most browsers find out about the search functionality of a website through an OpenSearch XML file that directs them to the right page.

## OpenSearch

[OpenSearch](https://en.wikipedia.org/wiki/OpenSearch) is a standard that was developed by [A9](https://en.wikipedia.org/wiki/A9.com), an Amazon subsidiary developing search engine and search advertising technology, and has been around since Jeff Bezos unveiled it in 2005 at a conference on emerging technologies.

It is nothing more than an XML specification that lets a website describe a search engine for itself, and where a user or browser might find and use it. Firefox, Chrome, Edge, Internet Explorer and Safari all support the OpenSearch standard, with [Firefox even supporting features](https://developer.mozilla.org/en-US/docs/Web/OpenSearch) that are not in the standard, such as search suggestions.

## XML

All you need is a small XML file. Below is an example of the one we have at [work](https://www.scribd.com/opensearch.xml):

```
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/" xmlns:moz="http://www.mozilla.org/2006/browser/search/">
    <ShortName>Scribd.com</ShortName>
    <Description>Scribd's mission is to create the world's largest open library of documents. Search it.</Description>
    <Url type="text/html" method="get" template="https://www.scribd.com/search?query={searchTerms}" />
     <Image height="32" width="32" type="image/x-icon">https://www.scribd.com/favicon.ico</Image>
</OpenSearchDescription>
```

It provides a `<ShortName>` (there's a `<LongName>` element too, that's mostly used for aggregators or automatically generated search plugins), a `<Description>` of what the search will let you do, and most importantly, the `<Url>` where you can do it.

It tells the browser there's a `text/html` page that can process an HTTP GET request, and has a `template` for the browser. `{searchTerms}` will be interpolated with the query terms the user will type in the browser. You need to host this file somewhere with the rest of your web pages.

But what if you don't have a dedicated search engine for your website? Well, just use Google! Replace the value of the `"template"` attribute with something like this[^url]:

```
<Url type="text/html" method="get" template="https://www.google.com/search?q=site:bart.degoe.de {searchTerms}">
```

This will redirect your user to the Google search results, but those will only display matches from content on your site. That's a lot cheaper than employing a bunch of engineers to build and maintain a custom search engine!

# Turn on autodiscovery!

Now we need to activate the automatic discovery of search engines in the browsers of your users. That sounds a lot cooler and more complicated than it actually is; the only thing you have to do is provide a `<link>` somewhere in the `<head>` of your webpages:

```
<link rel="search" href="https://bart.degoe.de/opensearch.xml" type="application/opensearchdescription+xml" title="Search bart.degoe.de">
```

This will alert browsers that load the page that there is a search feature available, described in the linked XML file. Make sure your OpenSearch XML file is available and can be loaded from your webserver, and refresh the page containing the `<link>`. This will tell the browser where to look, and enable custom search!

{{< figure src="/img/2018-11-20-tab-plus-search-from-your-url-bar-with-opensearch/opensearch-safari-bart-degoe-de.png" title="Now tab-searching from the Safari URL bar works too!" >}}

The OpenSearch specification [supports a lot more features](https://github.com/dewitt/opensearch/blob/master/opensearch-1-1-draft-6.md) than this, ranging from `<Tags>` to help plugins generated from these standardized descriptions be found better in [search plugin aggregators](https://addons.mozilla.org/en-US/firefox/search-tools/), what `<Language>` the search engine supports, or whether the search results may contain `<AdultContent>`. There are many ways to configure and customize OpenSearch that go way beyond the basic example described here, but for my little blog this is more than enough 😄.

[^input]: The other attributes are to dis-/enable [features](https://developer.mozilla.org/en-US/docs/Web/OpenSearch) certain other browsers like Safari have that automatically correct what you type into the search box.
[^url]: Yes, you could absolutely point your search input to my website, but that's not a requirement 😉
