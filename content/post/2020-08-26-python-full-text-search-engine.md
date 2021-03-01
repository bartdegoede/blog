---
title: "Building a full-text search engine in 150 lines of Python code"
date: 2020-12-10T17:00:12-07:00
draft: true
slug: "building-a-full-text-search-engine-150-lines-of-code"
categories: ["how-to", "search", "full-text search", "python"]
keywords: ["how-to", "search", "full-text search", "python"]
description: Full-text search is everywhere. From finding a book on Scribd, a movie on Netflix, toilet paper on Amazon, or anything else on the web through Google (like [how to do your job as a software engineer](https://localghost.dev/2019/09/everything-i-googled-in-a-week-as-a-professional-software-engineer/)), you've searched vast amounts of unstructured data multiple times today. What's even more amazing, is that you've even though you searched millions (or [billions](https://www.worldwidewebsize.com/)) of records, you got a response in milliseconds. In this post, we are going to build a basic full-text search engine that can search across millions of documents and rank them according to their relevance to the query in milliseconds, in less than 150 lines of code!
---

Full-text search is everywhere. From finding a book on Scribd, a movie on Netflix, toilet paper on Amazon, or anything else on the web through Google (like [how to do your job as a software engineer](https://localghost.dev/2019/09/everything-i-googled-in-a-week-as-a-professional-software-engineer/)), you've searched vast amounts of unstructured data multiple times today. What's even more amazing, is that you've even though you searched millions (or [billions](https://www.worldwidewebsize.com/)) of records, you got a response in milliseconds. In this post, we are going to go over the basic components of a full-text search engine, and use them to build one that can search across millions of documents and rank them according to their relevance in milliseconds, in less than 150 lines of code!<!-- more -->

# Data
All the code you in this blog post can be found on [Github](https://github.com/bartdegoede/python-searchengine/). I'll provide links with the code snippets here, so you can try running this yourself should you want to.

Before we're jumping into building a search engine, we first need some full-text, unstructured data to search. We are going to be searching abstracts of articles from the English Wikipedia, which is currently a gzipped XML file of about 785mb and contains about 6.2 million abstracts[^wikipedia_dump]. I've written [a simple function to download](https://github.com/bartdegoede/python-searchengine/blob/master/download.py) the gzipped XML, but you can also just manually download the file.

## Data preparation

The file is one large XML file that contains all abstracts. One abstract in this file is contained by a `<doc>` element, and looks roughly like this (I've omitted elements we're not interested in):

```xml
<doc>
    <title>Wikipedia: London Beer Flood</title>
    <url>https://en.wikipedia.org/wiki/London_Beer_Flood</url>
    <abstract>The London Beer Flood was an accident at Meux & Co's Horse Shoe Brewery, London, on 17 October 1814. It took place when one of the  wooden vats of fermenting porter burst.</abstract>
    ...
</doc>
```

The bits were interested in are the `title`, the `url` and the `abstract` text itself. We'll represent documents with a [Python dataclass](https://realpython.com/python-data-classes/) for convenient data access. We'll add a property that concatenates the title and the contents of the abstract. You can find the code [here](https://github.com/bartdegoede/python-searchengine/blob/master/search/documents.py).

```python
from dataclasses import dataclass

@dataclass
class Abstract:
    """Wikipedia abstract"""
    ID: int
    title: str
    abstract: str
    url: str

    @property
    def fulltext(self):
        return ' '.join([self.title, self.abstract])
```

Then, we'll want to extract the abstracts data from the XML and parse it so we can create instances of our `Abstract` object. We are going to stream through the gzipped XML without loading the entire file into memory first[^xml_memory_note]. We'll assign each document an ID in order of loading (ie the first document will have ID=1, the second one will have ID=2, etcetera).

```python
import gzip
from lxml import etree

from search.documents import Abstract

def load_documents():
    # open a filehandle to the gzipped Wikipedia dump
    with gzip.open('data/enwiki.latest-abstract.xml.gz', 'rb') as f:
        doc_id = 1
        # iterparse will yield the entire `doc` element once it finds the
        # closing `</doc>` tag
        for _, element in etree.iterparse(f, events=('end',), tag='doc'):
            title = element.findtext('./title')
            url = element.findtext('./url')
            abstract = element.findtext('./abstract')

            yield Abstract(ID=doc_id, title=title, url=url, abstract=abstract)

            doc_id += 1
            # the `element.clear()` call will explicitly free up the memory
            # used to store the element
            element.clear()
```

## Indexing

We are going to store this in a data structure known as an ["inverted index" or a "postings list"](https://en.wikipedia.org/wiki/Inverted_index). Think of it as the index in the back of a book that has an alphabetized list of relevant words and concepts, and on what page number a reader can find them.

{{< figure src="/img/2020-10-17-building-a-full-text-search-engine-150-lines-of-code/book-index-1080x675.png" title="Back of the book index" >}}

Practically, what this means is that we're going to create a dictionary where we map all the words in our corpus to the IDs of the documents they occur in. That looks like this:

```json
{
    ...
    "london": [5245250, 2623812, 133455, 3672401, ...],
    "beer": [1921376, 4411744, 684389, 2019685, ...],
    "flood": [3772355, 2895814, 3461065, 5132238, ...],
    ...
}
```

Note that in the example above the words in the dictionary are lowercased; before building the index we are going to break down or `analyze` the raw text into a list of words or `tokens`. The idea is that we first break up or `tokenize` the text into words, and then apply zero or more `filters` (such as lowercasing) on each token to improve the odds of matching queries to text.

{{< figure src="/img/2020-10-17-building-a-full-text-search-engine-150-lines-of-code/tokenization.png" title="Tokenization" >}}

We are going to apply very simple tokenization, by just splitting the text on whitespace. Then, we are going to apply a couple of filters on each of the tokens: we are going to lowercase each token, remove any punctuation, remove the 25 most common words in the English language (and the word "wikipedia" because it occurs in every title in every abstract) and apply [stemming](https://en.wikipedia.org/wiki/Stemming) to every word (ensuring that different forms of a word map to the same stem, like _brewery_ and _breweries_).

The tokenization and lowercase filter are very simple:

```python
def tokenize(text):
    return text.split()

def lowercase_filter(text):
    return [token.lower() for token in tokens]
```

Punctuation requires a regular expression on the set of punctuation:

```python
import re
import string

PUNCTUATION = re.compile('[%s]' % re.escape(string.punctuation))

def punctuation_filter(tokens):
    return [PUNCTUATION.sub('', token) for token in tokens]
```

Stopwords are words that are very common and we would expect to occcur in (almost) every document in the corpus. As such, they won't contribute much when we search for them (i.e. (almost) every document will match when we search for those terms) and will just take up space, so we will filter them out at index time. The Wikipedia abstract corpus includes the word "Wikipedia" in every title, so we'll add that word to the stopword list as well.

```python
# top 25 most common words in English and "wikipedia":
# https://en.wikipedia.org/wiki/Most_common_words_in_English
STOPWORDS = set(['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have',
                 'I', 'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you',
                 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'wikipedia'])

def stopword_filter(tokens):
    return [token for token in tokens if token not in STOPWORDS]
```

```python
def analyze(text):
    tokens = tokenize(text)
    tokens = lowercase_filter(tokens)
    tokens = punctuation_filter(tokens)
    tokens = stopword_filter(tokens)
    tokens = stem_filter(tokens)

    return [token for token in tokens if token]
```

```python
class Index:
    def __init__(self):
        self.index = {}
        self.documents = {}

    def index_document(self, document):
        if document.ID not in self.documents:
            self.documents[document.ID] = document

        for token in analyze(document.fulltext):
            if token not in self.index:
                self.index[token] = set()
            self.index[token].add(document.ID)
```

# Extending with scoring like tf-idf; order by relevancy
- idea of relevancy
- order by tf
- why tf alone is not enough; idf to the rescue

# Expand
- query parsing; only does AND or OR between query terms, but why not !a AND (a OR b)
- we assume each field has same value (ie fulltext); but what about weighting matches in titles more
- all of this is in memory on my laptop; Lucene has very efficient disk structure => scales to multiple machines, like ES


[^wikipedia_dump]: An abstract is generally the first paragraph or the first couple of sentences of a Wikipedia article. The [entire dataset](https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-abstract.xml.gz) is currently about ±786mb of gzipped XML. There's smaller dumps with a subset of articles available if you want to experiment and mess with the code yourself; parsing XML and indexing will take a while, and require a substantial amount of memory.
[^xml_memory_note]: We're going to have the entire dataset and index in memory as well, so we may as well skip keeping the raw data in memory.
