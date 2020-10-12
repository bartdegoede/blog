---
title: "How to implement a full-text search engine in less than 150 lines of Python code"
date: 2020-09-02T22:51:12-07:00
draft: true
slug: "how-to-implement-a-full-text-search-engine-100-lines-of-code"
categories: ["how-to", "search", "python"]
keywords: ["how-to", "search", "python"]
description: Full-text search is everywhere. From finding a book on Scribd, a movie on Netflix, toilet paper on Amazon, or anything else on the web through Google (like [how to do your job as a software engineer](https://localghost.dev/2019/09/everything-i-googled-in-a-week-as-a-professional-software-engineer/)), you've searched vast amounts of unstructured data multiple times today. What's even more amazing, is that you've even though you searched millions (or [billions](https://www.worldwidewebsize.com/)) of records, you got a response in milliseconds. In this post, we are going to build a basic full-text search engine that can search across millions of documents and rank them according to their relevance to the query in milliseconds, in less than 150 lines of code!
---

Full-text search is everywhere. From finding a book on Scribd, a movie on Netflix, toilet paper on Amazon, or anything else on the web through Google (like [how to do your job as a software engineer](https://localghost.dev/2019/09/everything-i-googled-in-a-week-as-a-professional-software-engineer/)), you've searched vast amounts of unstructured data multiple times today. What's even more amazing, is that you've even though you searched millions (or [billions](https://www.worldwidewebsize.com/)) of records, you got a response in milliseconds. In this post, we are going to build a basic full-text search engine that can search across millions of documents and rank them according to their relevance to the query in milliseconds, in less than 150 lines of code!<!-- more -->

We are going to be searching abstracts of articles from the English Wikipedia, which is currently a gzipped XML file of about 780mb and contains about 6.1 million abstracts. We'll be focusing on the abstracts here because we'll keep our data in-memory, and my laptop can only handle so much 😅[^wikipedia_dump].

# Data preparation

One abstract in this file is contained by a `<doc>` element, and looks like this:

```xml
<doc>
    <title>Wikipedia: Full-text search</title>
    <url>https://en.wikipedia.org/wiki/Full-text_search</url>
    <abstract>In text retrieval, full-text search refers to techniques for searching a single computer-stored document or a collection in a full-text database. Full-text search is distinguished from searches based on metadata or on parts of the original texts represented in databases (such as titles, abstracts, selected sections, or bibliographical references).</abstract>
</doc>
```

The bits were interested in are the `title`, the `url` and the `abstract` itself. In order to access the data efficiently, we're going to stream through the gzipped file document by document and create a simple [Python dataclass](https://realpython.com/python-data-classes/) for convenient access to the data, without loading the entire XML file into memory first[^xml_memory_note]. We'll add a property that concatenates the title and the contents of the abstract.

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

Then, we'll want to load the data into memory, so we can actually search the text:

```python
import gzip
from lxml import etree

def load_documents():
    # open a filehandle to the gzipped Wikipedia dump
    with gzip.open('enwiki.latest-abstract.xml.gz', 'rb') as f:
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

We'll assign each document an ID in order of loading (ie the first document will have ID=1, the second one will have ID=2, etcetera).

```
In [1] documents = list(load_documents())
...
...
# this will take a while
...
...
Out[1] [Abstract(ID=1, title='Wikipedia: Autism', abstract='| onset         = By age two or three', url='https://en.wikipedia.org/wiki/Autism'), Abstract(ID=2, title='Wikipedia: Albedo', abstract="Albedo () (, meaning 'whiteness') is the measure of the diffuse reflection of solar radiation out of the total solar radiation and measured on a scale from 0, corresponding to a black body that absorbs all incident radiation, to 1, corresponding to a body that reflects all incident radiation.", url='https://en.wikipedia.org/wiki/Albedo'), ...]

In [2] len(documents)
Out[2] 6153201
```

Finally, in order to determine how fast our search is, we'll want something like this decorator to time how long it takes to run our query through our search engine. I made a [`@timing` decorator]() I can easily wrap my functions with.

# Substring search

Now that we have all the text in memory, the simplest way of searching is to see if any of these documents contain a given substring. We'll just loop over each document in our collection and see if the query occurs somewhere in the document:

```python
@timing
def substring_search(documents, query):
    results = []
    for document in documents:
        if query in document.fulltext:
            results.append(document)
    return results
```

Easy enough, but our implementation has some drawbacks. First, on my laptop searching 6.1 million documents takes about 4 seconds, which is not _too_ bad, but we can definitely do better.

```python
In [27]: substring_search(docs, 'full-text search')
substring_search took 4.1284661293029785 seconds
Out[27]:
[Abstract(ID=398143, title='Wikipedia: Full-text search', abstract='In text retrieval, full-text search refers to techniques for searching a single computer-stored document or a collection in a full-text database. Full-text search is distinguished from searches based on metadata or on parts of the original texts represented in databases (such as titles, abstracts, selected sections, or bibliographical references).', url='https://en.wikipedia.org/wiki/Full-text_search'),
 Abstract(ID=734329, title='Wikipedia: Inverted index', abstract='In computer science, an inverted index (also referred to as a postings file or inverted file) is a database index storing a mapping from content, such as words or numbers, to its locations in a table, or in a document or a set of documents (named in contrast to a forward index, which maps from documents to content).  The purpose of an inverted index is to allow fast full-text searches, at a cost of increased processing when a document is added to the database.', url='https://en.wikipedia.org/wiki/Inverted_index')]
```

Second, we're looking for an exact substring match. If we'd change the query by capitalizing the first word, we lose one of the results that seem relevant.

```python
In [28]: substring_search(docs, 'Full-text search')
substring_search took 4.044554948806763 seconds
Out[28]: [Abstract(ID=398143, title='Wikipedia: Full-text search', abstract='In text retrieval, full-text search refers to techniques for searching a single computer-stored document or a collection in a full-text database. Full-text search is distinguished from searches based on metadata or on parts of the original texts represented in databases (such as titles, abstracts, selected sections, or bibliographical references).', url='https://en.wikipedia.org/wiki/Full-text_search')]
```

Finally, because we do substring matching, we'll find results that have words that contain the substring, such as `research` or `search_worst`.

```python
In [29]: substring_search(docs, 'search')
substring_search took 4.1888110637664795 seconds
Out[29]:
[Abstract(ID=678, title='Wikipedia: Arizona State University', abstract='| type = Public research university', url='https://en.wikipedia.org/wiki/Arizona_State_University'),
 Abstract(ID=829, title='Wikipedia: AVL tree', abstract='|search_worst=O(\\log n)', url='https://en.wikipedia.org/wiki/AVL_tree'),
 Abstract(ID=1264, title='Wikipedia: Assassination', abstract='Assassination is the act of deliberately killing a prominent person,Black\'s Law Dictionary "the act of deliberately killing someone especially a public figure, usually for money or for political reasons" (Legal Research, Analysis and Writing by William H. Putman p.', url='https://en.wikipedia.org/wiki/Assassination'),
 ...
 ```

In order to improve our search function, we want to improve [`precision`](https://en.wikipedia.org/wiki/Precision_and_recall#Precision) (how many results that were found are correct[^information_need] results) and [`recall`](https://en.wikipedia.org/wiki/Precision_and_recall#Recall) (how many of the total number of correct[^information_need] results in the data set did we find).

We can improve our `recall` by making our search function case-insensitive so that both `Full-text search` and `full-text search` match the same result. We can improve our `precision` by matching on word boundaries rather than substrings, so that we won't return irrelevant results like `research` for a query like `search`.

# Regex search


# Full-text search intro
- what is it
- scale, fast, lucene, ES
- search wikipedia abstracts
- implement in python, "slow language"

# Naive implementations
- substring match (grep)
- regex search (word boundaries yo)
- doesn't scale (linear with number of docs)

# Indexing ftw
- book analogy => inverted index
- fast lookup, scalable extensible
- text analysis; tokenize, token filters
- build boolean search (and/or)

# Extending with scoring like tf-idf; order by relevancy
- idea of relevancy
- order by tf
- why tf alone is not enough; idf to the rescue

# Expand
- query parsing; only does AND or OR between query terms, but why not !a AND (a OR b)
- we assume each field has same value (ie fulltext); but what about weighting matches in titles more
- all of this is in memory on my laptop; Lucene has very efficient disk structure => scales to multiple machines, like ES

# DATA
## subset
Loads of stdout about parsing XML, takes ±30 seconds on my laptop
Parsing XML took 32.68613815307617 seconds
Loads of stdout about indexing data, takes ±30 seconds on my laptop
index_documents took 25.253756046295166 seconds
substring_search took 0.40305519104003906 seconds
regex_search took 2.7608580589294434 seconds
search took 0.050067901611328125 milliseconds
run took 61.108176946640015 seconds
## full data set
index_documents took 487.53364872932434 seconds
substring_search took 3.651111125946045 seconds
regex_search took 25.815366983413696 seconds
search took 0.23889541625976562 milliseconds
search took 0.05960679054260254 seconds
search took 0.003979921340942383 seconds
search took 0.43673086166381836 seconds

[^wikipedia_dump]: The [entire dataset](https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-abstract.xml.gz) is currently about ±780mb of gzipped XML. There's smaller dumps with a subset of articles available if you want to experiment and mess with the code yourself; parsing XML and indexing will take a while, and require a substantial amount of memory.
[^xml_memory_note]: We're going to have the entire dataset and index in memory as well, so we may as well skip keeping the raw data in memory.
