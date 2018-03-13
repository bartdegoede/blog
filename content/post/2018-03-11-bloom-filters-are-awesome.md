---
title: "Bloom filters are awesome"
date: 2018-03-10T18:14:33+01:00
draft: false
slug: "bloom-filters-are-awesome"
categories: ["python", "bloom filter", "how-to"]
include_js: [ "2018-03-11-bloom-filters-are-awesome/murmurhash3js.min.js", "2018-03-11-bloom-filters-are-awesome/bloomfilters.js" ]
---

Bloom filters are cool. In this post I'll go over what they are, what they're useful for, how they work, and at the end I've hacked together an [interactive example](#interactive_example) to help visualise what happens behind the scenes.

What is a Bloom filter?
-----------------------
A Bloom filter is a data structure designed to quickly tell you whether an element is not in a set. What's even nicer, it does so within the memory constraints you specify. It doesn't actually store the data itself, only trimmed down version of it. This gives it the desirable property that it has a _constant time complexity_[^BigO] for both adding a value to the filter _and_ for checking whether a value is present in the filter.

Like with most things that offer great benefits, there is a trade-off: Bloom filters are probabilistic in nature. On rare occassions, it will respond with _yes_ to the question if the element is in the set (_false positives_ are a possibility), although it will never respond with _no_ if the value is actually present (_false negatives_ can't happen).

You can actually control how rare those occassions are, by setting the size of the Bloom filter bit array and the amount of hash functions depending on the amount of elements you expect to add[^optimal_hash_functions]. Also, note that you can't remove items from a Bloom filter.

What can I use it for?
----------------------
Given that a Bloom filter is really good at telling you whether something is in a set or not, caching is a prime candidate for using a Bloom filter. CDN providers like Akamai[^akamai_ref] use it to optimise their disk caches; nearly 75% of the URLs that are accessed in their web caches is accessed only once and then never again. To prevent caching these "one-hit wonders" and massively saving disk space requirements, Akamai uses a Bloom filter to store all URLs that are accessed. If a URL is found in the Bloom filter, it means it was requested before, and should be stored in their disk cache.

Blogging platform Medium [uses Bloom filters](https://blog.medium.com/what-are-bloom-filters-1ec2a50c68ff)[^medium_bloom] to filter out posts that users have already read from their recommendation engine specifically because it will never let a post through the user read before, and the false positives (i.e. posts the _have_ read) are an acceptable trade-off, because the user will never know they didn't see the post (because they haven't read it).

Quora does something similar to filter out stories users have seen before, and [Facebook](https://www.facebook.com/Engineering/videos/432864835468/) and [LinkedIn](https://engineering.linkedin.com/open-source/cleo-open-source-technology-behind-linkedins-typeahead-search) use Bloom filters in their typeahead searches (it basically provides a fast and memory-efficient way to filter out documents that can't match on the prefix of the query terms).

There's [a lot more usecases](https://www.quora.com/What-are-the-best-applications-of-Bloom-filters) for Bloom filters, but let's dive into how they work!

How does it work?
-----------------
An empty Bloom filter is a bit array of a particular size (let's call that size _m_) where all the bits are set to 0. In addition, there must be a number (let's call the number _k_) of hashing functions defined. Each of these functions hashes a value to one of the positions in our array _m_, distributing the values uniformly over the array.

We'll do a very simple Python implementation[^bloom_gist] of a Bloom filter. For simplicity's sake, we'll use a bit array[^bitarraydisclaimer] with 15 bits (`m=15`) and 3 hashing functions (`k=3`) for the running example.
```
import mmh3

class Bloomfilter(object):
    def __init__(self, m=15, k=3):
        self.m = m
        self.k = k
        # we use a list of Booleans to represent our
        # bit array for simplicity
        self.bit_array = [False for i in range(self.m)]

    def add(self, element):
        ...

    def check(self, element):
        ...
```
To add elements to the array, our `add` method needs to run `k` hashing functions on the input that each will almost randomly pick an index in our bit array. We'll use the [`mmh3`](https://pypi.python.org/pypi/mmh3) library to hash our `element`, and use the amount of hash functions we want to apply as a seed to give us different hashes for each of them. Finally, we compute the remainder of the hash divided by the size of the bit array to obtain the position we want to set.
```
def add(self, element):
    """
    Add an element to the filter. Murmurhash3 gives us hash values
    distributed uniformly enough we can use different seeds to
    represent different hash functions
    """
    for i in range(self.k):
        # this will give us a number between 0 and m - 1
        digest = mmh3.hash(element, i) % self.m
        self.bit_array[digest] = True
```
In our case (`m=15` and `k=3`), we would set the bits at index 1, 6 and 9 to one for the string `hello`.
```
In [1]: mmh3.hash('hello', 0) % 15
Out[1]: 1

In [2]: mmh3.hash('hello', 1) % 15
Out[2]: 6

In [3]: mmh3.hash('hello', 2) % 15
Out[3]: 9
```
Now, to determine if an element is in the bloom filter, we apply the same hash functions to the element, and see whether the bits at the resulting indices are all 1. If one of them is _not_ 1, then the element has not been added to the filter (because otherwise we'd see a value of 1 for all hash functions!).
```
def check(self, element):
    """
    To check whether element is in the filter, we hash the element with
    the same hash functions as the add functions (using the seed). If one
    of them doesn't occur in our bit_array, the element is not in there
    (only a value that hashes to all of the same indices we've already
    seen before).
    """
    for i in range(self.k):
        digest = mmh3.hash(element, i) % self.m
        if self.bit_array[digest] == False:
            # if any of the bits hasn't been set, then it's not in
            # the filter
            return False
    return True
```
You can see how this approach guarantuees that there will be no _false negatives_, but that there might be _false positives_; especially in our toy example with the small bit array, the more elements you add to the filter, the more likely it gets that the three bits we hash an element to are set other elements (running one of the hash functions on the string `world` will also set the bit at index 6 to 1):
```
In [4]: mmh3.hash('world', 0) % 15
Out[4]: 6

In [5]: mmh3.hash('world', 1) % 15
Out[5]: 4

In [6]: mmh3.hash('world', 2) % 15
Out[6]: 8
```
We can actually [compute the probability](https://en.wikipedia.org/wiki/Bloom_filter#Probability_of_false_positives) of our Bloom filter returning a false positive, as it is a function of the number of bits used in the bit array divided by the length of the bit array (`m`) to the power of hash functions we're using `k` (we'll leave that for a future post though). The more values we add, the higher the probability of false positives becomes.

<a name="interactive_example"></a>Interactive example
-------------------
To further drive home how Bloom filters work, I've hacked together a Bloom filter in JavaScript that uses the cells in the table below as a "bit array" to visualise how adding more values will fill up the filter and increase the probability of a false positive (a full Bloom filter will always return "yes" for whatever value you throw at it).

<table id="bitvector" border="1">
    <tbody>
        <tr id="bits"></tr>
        <tr id="labels"></tr>
    </tbody>
</table>
<div class="input-container">
    <input placeholder="Add an element" id="bloom_input" class="input">
    <button id="add_value_to_bloom_filter">Add</button>
</div>
<div id="hashes">
    <b>Hash value 1:</b> <span id="hash0"></span><br>
    <b>Hash value 2:</b> <span id="hash1"></span><br>
    <b>Hash value 3:</b> <span id="hash2"></span><br><br>
    <b>Elements in the filter:</b> [<span id="elements"></span>]<br>
    <b>Probability of false positives:</b> <span id="false_positive_probability">0%</span>
</div>
<div class="input-container">
    <input placeholder="Element in filter?" id="bloom_input_test" class="input">
    <button id="test_value_in_bloom_filter">Test</button>
</div>
<div id="in_bloom_filter">
    <b>In Bloom filter:</b> <span></span>
</div>

**N.B.:** Note that there's a slight difference between the Python and Javascript Murmurhash implementation in the libraries I've used (`"hello"` hashes to `[1, 6, 9]` in the Python example, and `[1, 7, 10]` in the Javascript example); that is because the [Javascript library I used](http://pid.github.io/murmurHash3js/) returns a 32 bit _unsigned_ integer, where the [Python library](https://github.com/hajimes/mmh3) returns a 32 bit _signed_ integer by default. This doesn't affect the working of the Bloom filter.

[^BigO]: The runtime for both inserting and checking is defined by the number of hash functions (`k`) we have to execute. So, `O(k)`. Space complexity is more difficult to quantify, because that depends on how many false positives you're willing to tolerate; allocating more space will lower the false positive rate.
[^optimal_hash_functions]: Going over the math is a bit much for this post, so check [Wikipedia](https://en.wikipedia.org/wiki/Bloom_filter#Optimal_number_of_hash_functions) for all the formulas 😄.
[^akamai_ref]: Maggs, Bruce M.; Sitaraman, Ramesh K. (July 2015), "Algorithmic nuggets in content delivery", _SIGCOMM Computer Communication Review_, New York, NY, USA: ACM, 45 (3): 52–66, [`doi:10.1145/2805789.2805800`](https://doi.org/10.1145%2F2805789.2805800)
[^medium_bloom]: Read the article. It's really good.
[^bloom_gist]: Full implementation on [GitHub](https://gist.github.com/bartdegoede/42ef7a265d946a9a75617a89ecbaf674).
[^bitarraydisclaimer]: Our implementation won't use an actual bit array but a Python list containing Booleans for the sake of readability.
