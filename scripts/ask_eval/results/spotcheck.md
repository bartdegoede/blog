# Spot-check sheet

Label each answer: faithful / unsupported / non-answer (or f / u / n).

## 1

**Question:** Why did the blog switch to the PaperMod theme?

1. Gaslighting After switching to the 1M context window model to fit everything in, I asked it to write an outline for a post (it wrote a whole post), and specifically to list what it did and didn't do well. Oh boy.
2. It helps avoiding using older versions of libraries (i.e. that were current when it was trained), and makes it more likely to find viable alternatives to outdated stuff. It came back with actual data about Hugo still being viable, PaperMod being the most popular theme, and Pagefind being a more modern alternative to Lunr.js (ended up using Fuse.js for simplicity).
3. For example, it really likes to commit everything all at once, so after I told it to break down the changes into sensible commits, it decided to describe what it had done as follows: > The best part? Claude created sensible git commits with clear messages: \- "Add PaperMod theme and convert config to YAML" \- "Modernize bloom filter JavaScript" \- "Add custom CSS styling" \- "Improve deploy script" Not a single "fix stuff" or "more changes" commit in sight. It even wrote a comprehensive PR description. It did write a comprehensive PR description, I guess I'll have to give it that.
4. What shipped, and how to steal it The search box on the homepage now runs keyword, semantic, and hybrid search, with a toggle so you can compare and watch them disagree. Type pydub and flip to semantic mode to see it get the answer wrong; flip to hybrid to see it get it right again. The whole thing is a 4 MB lookup table, a tiny document index, and about 300 lines of dependency-free JavaScript, lazy-loaded only when you focus the search box so the page itself pays nothing.

**Answer:**

The blog switched to the PaperMod theme because it wanted to make sure it could use newer versions of libraries like PaperMod, which are currently maintained by the community. This allowed it to avoid using older versions of libraries like PaperMod, which would be less reliable if they weren't actively maintained. Additionally, the blog's new version of PaperMod included features such as a modernized Bloom Filter JavaScript, improved CSS styles, and better support for modern themes like Pagefind. These updates made the Blog more appealing to users who preferred these features over older ones.

label: n

---

## 2

**Question:** How do I get an HTTPS certificate for my own domain on free static hosting?

1. Validating a domain Similar to a traditional process of obtaining a certificate for a domain, where you create an account with the CA and add domains you control, the certificate management agent needs to perform a test to prove that it controls the domain. The agent will ask the Let's Encrypt CA what it needs to do to prove that it is, effectively, in control of the domain. The CA will look at the domain, and issue one or more challenges to the agent it needs to complete to prove that it has control over the domain.
2. The CA will look at the domain, and issue one or more challenges to the agent it needs to complete to prove that it has control over the domain. For example, it can ask the agent to provision a particular DNS record under the domain, or make an HTTP resource available under a particular URL. With these challenges, it provides the agent with a nonce (some random number that can only be used once for verification purposes). In the image above, the agent creates a file on a specified path on the web server (in this case, on https://example.com/8303).
3. Optionally, you can enforce HTTPS in the settings of your repository. This will upgrade all users requesting stuff from your site over HTTP to be automatically redirected to HTTPS. If you use A records to route traffic to your website, you need to update your DNS settings at your registrar. These IP addresses are new, and have an added benefit of putting your static site behind a CDN (just like we did with Cloudflare in the previous post).
4. How does it do that? It works by running a bit of software on your web server, a certificate management agent. This agent software has two tasks: it proves to the Let's Encrypt certificate authority that it controls the domain, and it requests, renews and revokes certificates for the domain it controls.

**Answer:**

To obtain an HTTPS certificate for your own domain using a free static host such as Google Domains, you'll first need to set up a Certificate Authority (CA) provider. You can then request a certificate through the CA. Once you've obtained the certificate, you'll need to configure it on your domain.

label: u

---

## 3

**Question:** How do I add OpenSearch support to my website?

1. Make sure your OpenSearch XML file is available and can be loaded from your webserver, and refresh the page containing the link. This will tell the browser where to look, and enable custom search! The OpenSearch specification supports a lot more features than this, ranging from Tags to help plugins generated from these standardized descriptions be found better in search plugin aggregators, what Language the search engine supports, or whether the search results may contain AdultContent.
2. Others don't Not all browsers do this out of the box, so you need to provide them with a more formalized configuration. Most browsers find out about the search functionality of a website through an OpenSearch XML file that directs them to the right page.
3. The OpenSearch specification supports a lot more features than this, ranging from Tags to help plugins generated from these standardized descriptions be found better in search plugin aggregators, what Language the search engine supports, or whether the search results may contain AdultContent. There are many ways to configure and customize OpenSearch that go way beyond the basic example described here, but for my little blog this is more than enough 😄.
4. Almost all modern browsers enable websites to customize the built-in search feature to let the user access their search features directly, without going to your website first and finding the search input box. If your website has search functionality accessible through a basic GET request, it's surprisingly simple to enable this for your website too.

**Answer:**

To enable custom search from the URL bar, you need to make sure your OpenSearch XML file is available on your webserver and refresh the page containing the link. This allows the browser to direct users to the correct page for searching.

label: f

---

## 4

**Question:** How is MurmurHash used in the blog's examples?

1. Closing thoughts There are a lot more applications for Bloom filters out there, and I can't list them all here. I hope a gave you a whirlwind overview of how Bloom filters work and how they might be useful to you. Feel free to drop me a line or comment below if you have nice examples of where they're used, or if you have any feedback, comments, or just want to say hi :-) [^BigO]: The runtime for both inserting and checking is defined by the number of hash functions (k) we have to execute. So, O(k).
2. We'll use the mmh3 library to hash our element, and use the amount of hash functions we want to apply as a seed to give us different hashes for each of them. Finally, we compute the remainder of the hash divided by the size of the bit array to obtain the position we want to set.[^signedisfalse] In our case (m=15 and k=3), we would set the bits at index 1, 7 and 10 to one for the string hello. Now, to determine if an element is in the bloom filter, we apply the same hash functions to the element, and see whether the bits at the resulting indices are all 1.
3. For simplicity's sake, we'll use a bit array[^bitarraydisclaimer] with 15 bits (m=15) and 3 hashing functions (k=3) for the running example. To add elements to the array, our add method needs to run k hashing functions on the input that each will almost randomly pick an index in our bit array. We'll use the mmh3 library to hash our element, and use the amount of hash functions we want to apply as a seed to give us different hashes for each of them.
4. [^infinite_dial]: https://www.edisonresearch.com/infinite-dial-2019/ [^accessibility]: Not to mention that audio content is more easily accessible for people that suffer from dyslexia or poor sight, or seems to be a lot better for user engagement. [^gcloud]: It has all kinds of funky stuff, like multiple languages, API clients in your favorite programming language, pitch, speaking rates and volume controls, and even optimizations around where your audio is going to play, such as headphones or phone lines. [^free]: Free is my favorite price.

**Answer:**

MurmurHash is mentioned in the blog examples as being used for generating random numbers and hashing strings, which aligns with its role in Bloom Filters. However, specific details about MurmurHash usage within the blog examples aren’t explicitly detailed in the provided passages.

label: f

---

## 5

**Question:** How can I make an audio version of a blog post?

1. Consuming audio content is easier to consume and more engaging than written content while you're on the go, exercising, commuting or doing household chores[^accessibility]. But what do you do if you're like me and don't have the time or recording equipment to ride this podcasting wave, and just write the occasional blog post? Well, you can always use a sophisticated deep learning text-to-speech model, train it on thousands of hours of audio content and endlessly tweak the model parameters, create an audio version of those occassional blog posts and host them on your website.
2. This snippet will give us access to a shortcode that injects some HTML into our post, and accepts a couple of parameters so we can include the appropriate audio file, the appropriate backup file, and override styling should we so choose. This file should be stored in layouts/shortcodes/audio.html, and can be included in your posts as follows: This will include an audio player looking like this in your blog post. I've added some bells and whistles to mine, with some additional styling for all the UX points.
3. Audio is big. Like, really big, and growing fast, to the tune of "two-thirds of the population listens to online audio" and "weekly online listeners reporting an average nearly 17 hours of listening in the last week"[^infinite_dial]. These numbers include all kinds of audio, from online radio stations, audiobooks, streaming services and podcasts (hi Spotify!). It makes sense too. Consuming audio content is easier to consume and more engaging than written content while you're on the go, exercising, commuting or doing household chores[^accessibility].
4. Seven years ago I used Google's text-to-speech API to create audio versions of my posts. There was a Python script that parsed the Markdown file, cleaned it up, chunked it to stay under Google's 5000 byte limit, convert each chunk to an MP3, stitch them together, and finally embed the resulting file with a Hugo shortcode that is essentiall a fancy audio tag. It worked, it was free[^free], and I was pretty pleased with it. The little audio player has been sitting at the top of my posts ever since. However, it does sound a little like 2010.

**Answer:**

You can create an audio version of a blog post by using a text-to-speech service, such as Google Cloud Text-to-Speech, to convert the post's text into audio files and then embedding them in the post with an audio player shortcode. The author also describes a Python script that parses the Markdown, splits it into chunks under the API's size limit, converts each chunk to MP3, and stitches them together

label: f

---

## 6

**Question:** What are the best day trips from Amsterdam?

1. Relevance When thinking about search, the most important question is what users want to find. This sounds very much like an open door, but you'd be surprised how often this gets overlooked; what are we looking for (tweets, products, (the fastest route to) a destination?), who is doing the search (lawyers, software engineers, my mom?), what do we hope to get out of it (money, page views?).
2. But it has absolutely no context of what words mean. Not a single result, even though the London Beer Flood is sitting right there. For context, the London Beer Flood is an accident that occurred at a London brewery in 1814 where a giant vat of beer burst and flooded the surrounding streets. That's very much an "alcoholic beverage disaster in England", but our keyword search engine doesn't know that "beer" and "alcoholic beverage" are similar concepts, or that "London" is in "England," or that a "flood" is a type of "disaster." It only knows how to match strings [^natural_language_parsing].
3. Giving it some brains The SDK has some example agents for Anthropic, OpenAI, and local models. Let's walk through the Claude one, because that's what I had lying around[^tokens].
4. Others don't Not all browsers do this out of the box, so you need to provide them with a more formalized configuration. Most browsers find out about the search functionality of a website through an OpenSearch XML file that directs them to the right page.

**Answer:**

Okay, I understand. I will use the provided text as input to answer the question. Based on the information given, I will try to determine if the blog covers any relevant aspects of online travel, such as booking accommodations, attractions, food recommendations, and pricing. I will then attempt to identify whether the key elements mentioned in the passage are common features of these activities.

label: n

---

## 7

**Question:** How do I set up an Elasticsearch cluster for my site search?

1. Elasticsearch stores it's data as plain old JSON on disk, and only stores indexed data in Lucene (the underlying search and indexing library) itself, and many other search engines will simply return an ordered list of document IDs which are then used to retrieve the data to display to users from a database or other service. This is especially relevant for large corpora, where doing a full reindex of all your data is expensive, and you generally only want to store data relevant to relevancy in your search engine (and not attributes that are only relevant for presentation purposes).
2. What's next: hybrid search We now have two search engines: one that matches keywords, and one that understands meaning. What if we combined them? Use keyword search for precision on exact terms, semantic search for understanding meaning, and blend the scores together. That's actually what modern search engine implementations like Elasticsearch, Vespa, and Pinecone do under the hood. It's called hybrid search, and it's what we'll build in part 3. Stay tuned.
3. OpenSearch OpenSearch is a standard that was developed by A9, an Amazon subsidiary developing search engine and search advertising technology, and has been around since Jeff Bezos unveiled it in 2005 at a conference on emerging technologies. It is nothing more than an XML specification that lets a website describe a search engine for itself, and where a user or browser might find and use it. Firefox, Chrome, Edge, Internet Explorer and Safari all support the OpenSearch standard, with Firefox even supporting features that are not in the standard, such as search suggestions.
4. It runs entirely in memory on my laptop, whereas libraries like Lucene utilize hyper-efficient data structures and even optimize disk seeks, and software like Elasticsearch and Solr scale Lucene to hundreds if not thousands of machines. That doesn't mean that we can't think about fun expansions on this basic functionality though; for example, we assume that every field in the document has the same contribution to relevancy, whereas a query term match in the title should probably be weighted more strongly than a match in the description.

**Answer:**

I am currently using a basic Elasticsearch cluster setup with a simple index. The key assumption is that the data is stored in a known, consistent format (e.g., a table of dictionaries, a JSON file, or a regular expression). The core logic involves querying the index for a given pattern. The following steps would involve:

1.  **Data Ingestion:** Accessing the index' Subset (usually a table of dictionaries) to retrieve the desired data.
2.  **Data Filtering/Searching:** Filtering the data based on the specified pattern.
3.  **Data Analysis

label: u

---

## 8

**Question:** How do I fine-tune Kokoro to speak in my own voice?

1. The 2010 sound of 2019 Here is the main argument for doing this at all. This is a paragraph of that 2019 post, read by Google's Wavenet, exactly as it has sounded on the live site since I published it: And here is the same post, re-narrated today by Kokoro running locally on my laptop: I also added a script that samples the audio and creates an actual image of the shape of the soundwave; look at the difference between the nasal Wavenet voice and the Kokoro one.
2. Apply the lexicon so the jargon is spelled the way it should sound. 3. Chunk the prose on sentence boundaries into bite-sized pieces. 4. Synthesize each chunk with Kokoro. 5. Stitch the pieces into one MP3. A click CLI wraps it, with an --all flag that backs up the existing audio and re-renders every post behind a progress bar: "Runs on your laptop" always has an asterisk or two; Python 3.13 removed the audioop module that pydub needs, so there is a backport pinned in. Kokoro's English G2P needs a couple of extra packages that aren't installed by default.
3. This is a paragraph of that 2019 post, read by Google's Wavenet, exactly as it has sounded on the live site since I published it: And here is the same post, re-narrated today by Kokoro running locally on my laptop: I also added a script that samples the audio and creates an actual image of the shape of the soundwave; look at the difference between the nasal Wavenet voice and the Kokoro one. It puts stress in roughly the right places, pauses at clause boundaries instead of on a fixed timer, and doesn't have that metallic edge.
4. The 82 million parameters matter: the weights are a few hundred megabytes, not the tens of gigabytes a large speech model requires. And it was trained mostly on long-form reading, which is exactly the job here. It is a narrator, not a chatbot voice. The thing that makes it practical on ~a~ my laptop is MLX-Audio, which runs Kokoro on Apple's MLX framework; natively on the Apple Silicon GPU, no PyTorch, no CUDA, no ONNX runtime. The whole "install" is: and then, in Python, the entire synthesis step is: Kokoro ships with 54 voices; I settled on af_heart for narration[^kokoro_compare].

**Answer:**

A good start! You've done well breaking down the different parts of the process using the following steps:

1. Apply the lexicon to the pre-written content (the first part).

2. Run the pre-built narrative through the pipeline.
3. Add the additional noise/noise effects via the C++ code snippet you found.
4. Test the results against the live stream before publishing the final piece.
5. Refine the performance based on the feedback from the test section.

label: n

---

## 9

**Question:** How did the blog use Lunr to add search?

1. We depend on the users' browser to run Javascript[^my_users] and download the searchable data in order to run queries against it, but the upside is that you can control how data is processed and how that data is queried. Fortunately for us, Atwood's Law holds true; there's a full-text search library inspired by Lucene/Solr written in Javascript we can use to implement our search engine: Lunr.js.
2. The lunr index will return a ranked list of refs (these are the identifiers we assigned to the documents in the Gruntfile). The second part of this method maps these identifiers to the original documents we stored in the pagesIndex variable. The snippet above lists two methods. The first shows an example of a search using the default lunr.Index#search method, which uses the lunr query syntax. In my case, I want to support a typeahead search, where we show the user results for partial queries too; if the user types "pyth", we should display results that have the word "python" in the post.
3. In my case, I want to start searching once a user has typed at least two characters, and support a typeahead style of searching, so everytime a character is entered, I want to empty the current search results (if any), run the searchSite function with whatever is in the input box, and render the results. The searchSite function will take the query_string the user typed in and build a lunr.Query object and run it against the index (stored in the searchIndex variable). The lunr index will return a ranked list of refs (these are the identifiers we assigned to the documents in the Gruntfile).
4. To do that, we tell Lunr to combine two queries: the first q.term provides exact matches with a high boost to relevance (because we it's likely that these matches are relevant to the user), the second appends a trailing wildcard to the query[^trie], providing prefix matches with a (lower) boost. Finally, given the ranked list of results (containing all pages in the content/ directory), we want to render those somewhere on the page.

**Answer:**

The blog used Lunr.js, a Lucene/Solr-inspired full-text search library in JavaScript, running in the user's browser against a searchable index of the site's content. For typeahead, it runs a search after each keystroke (once at least two characters are typed), combining exact term matches with a higher boost and trailing-wildcard prefix matches with a lower boost.

label: f

---

## 10

**Question:** How do I store embeddings in Postgres with pgvector?

1. The implementation on GitHub processes documents in groups of 10,000, saving intermediate embeddings as checkpoints. I got sick of having to start over while I was writing this because something crashed halfway through. If you'd rather skip the multi-hour encoding step, I've uploaded the pre-computed embeddings to Hugging Face 🤗 so you can download them and start searching right away. Just move the JSON and .npy files into data/checkpoints and run uv run python run_semantic.py.
2. It also comes with batch encoding, which we're going to need when we're embedding 6.4 million documents: This will embed our documents in batches of 256, showing a pretty progress bar so you know roughly how long your coffee break should be[^gpu_note]. We're going to process our 6.4 million documents in chunks rather than loading everything into memory at once. The implementation on GitHub processes documents in groups of 10,000, saving intermediate embeddings as checkpoints. I got sick of having to start over while I was writing this because something crashed halfway through.
3. So, GitHub Pages Right, that's how we got started. The awesome thing about Let's Encrypt is that it is automated, so all this handshaking and verifying happens behind the scenes, without you having to be involved. In the previous post we saw how to set up a CNAME file for your custom domain. That's it. Done. Works out of the box. Optionally, you can enforce HTTPS in the settings of your repository. This will upgrade all users requesting stuff from your site over HTTP to be automatically redirected to HTTPS.
4. Install them with npm: $ npm install --save-dev grunt string gray-matter This is my Gruntfile.js that lives in the root of my project. It will walk through the content/ directory and parse all the markdown files it finds. It will parse out title, categories and href (this will be the reference to the post; i.e. the URL of the page we want to point to) from the front matter, and the content from the rest of the post. It also skips posts that are labeled draft, because I don't want the posts I'm still working on to already show up in the search results.

**Answer:**

The provided passages do not contain information on how to store embeddings in Postgres with pgvector.

label: f

---

## 11

**Question:** How do I fine-tune Kokoro to speak in my own voice?

1. The 2010 sound of 2019 Here is the main argument for doing this at all. This is a paragraph of that 2019 post, read by Google's Wavenet, exactly as it has sounded on the live site since I published it: And here is the same post, re-narrated today by Kokoro running locally on my laptop: I also added a script that samples the audio and creates an actual image of the shape of the soundwave; look at the difference between the nasal Wavenet voice and the Kokoro one.
2. Apply the lexicon so the jargon is spelled the way it should sound. 3. Chunk the prose on sentence boundaries into bite-sized pieces. 4. Synthesize each chunk with Kokoro. 5. Stitch the pieces into one MP3. A click CLI wraps it, with an --all flag that backs up the existing audio and re-renders every post behind a progress bar: "Runs on your laptop" always has an asterisk or two; Python 3.13 removed the audioop module that pydub needs, so there is a backport pinned in. Kokoro's English G2P needs a couple of extra packages that aren't installed by default.
3. This is a paragraph of that 2019 post, read by Google's Wavenet, exactly as it has sounded on the live site since I published it: And here is the same post, re-narrated today by Kokoro running locally on my laptop: I also added a script that samples the audio and creates an actual image of the shape of the soundwave; look at the difference between the nasal Wavenet voice and the Kokoro one. It puts stress in roughly the right places, pauses at clause boundaries instead of on a fixed timer, and doesn't have that metallic edge.
4. The 82 million parameters matter: the weights are a few hundred megabytes, not the tens of gigabytes a large speech model requires. And it was trained mostly on long-form reading, which is exactly the job here. It is a narrator, not a chatbot voice. The thing that makes it practical on ~a~ my laptop is MLX-Audio, which runs Kokoro on Apple's MLX framework; natively on the Apple Silicon GPU, no PyTorch, no CUDA, no ONNX runtime. The whole "install" is: and then, in Python, the entire synthesis step is: Kokoro ships with 54 voices; I settled on af_heart for narration[^kokoro_compare].

**Answer:**

To fine-tune Kokoro to speak in your own voice, you need to adjust its parameters. You can use the `--voice` option to specify the desired voice. For example, if you want to match your own voice, you can set the `gender` parameter to 'male' or 'female'. Additionally, you can adjust the `rate`, `duration`, and `pitch` parameters to tailor the tone and pitch to your speaking style. You'll also need to adjust the `gender` parameter to match your own gender. By adjusting these parameters, you can create a more natural-

label: u

---

## 12

**Question:** How can I find documents by their meaning rather than by matching keywords?

1. Keyword search is precise -- when your query matches the words used in the documents, it's fast and reliable. Semantic search understands meaning -- it bridges the vocabulary gap between how you phrase your query and how the document was written. "Alcoholic beverage disaster" finds beer poisoning articles. "Large constricting reptiles" finds squamates. Neither query shares a single word with the documents it found. They're not competing approaches. They're complementary. So what's next?
2. Two search engines that are each blind in a different way Before adding semantic search, I figured I'd do the responsible thing and measured how bad the existing keyword search actually was, so I'd have a baseline to beat. I had Claude create a set of thirty test queries and split them into three kinds: - Exact tokens: pydub, lunr, mmh3, papermod. Words that literally appear in a post. - Paraphrases: "find documents by what they mean instead of which words they contain." Concepts, in different words than the post uses. - Navigational: "how do I add search to a static site." Broad intent.
3. Especially for large result sets, that is painful or just impossible (in our OR example, there are almost 50,000 results). This is where the idea of relevancy comes in; what if we could assign each document a score that would indicate how well it matches the query, and just order by that score? A naive and simple way of assigning a score to a document for a given query is to just count how often that document mentions that particular word. After all, the more that document mentions that term, the more likely it is that it is about our query!
4. Practically, what this means is that we're going to create a dictionary where we map all the words in our corpus to the IDs of the documents they occur in. That will look something like this: Note that in the example above the words in the dictionary are lowercased; before building the index we are going to break down or analyze the raw text into a list of words or tokens. The idea is that we first break up or tokenize the text into words, and then apply zero or more filters (such as lowercasing or stemming) on each token to improve the odds of matching queries to text.

**Answer:**

The passage suggests using semantic search to bridge the difference between keyword-based searches and semantic search, focusing on understanding meaning rather than literal word matches. By doing so, one can identify documents based on concepts rather than specific terms.

label: n

---

## 13

**Question:** What are the best day trips from Amsterdam?

1. Relevance When thinking about search, the most important question is what users want to find. This sounds very much like an open door, but you'd be surprised how often this gets overlooked; what are we looking for (tweets, products, (the fastest route to) a destination?), who is doing the search (lawyers, software engineers, my mom?), what do we hope to get out of it (money, page views?).
2. But it has absolutely no context of what words mean. Not a single result, even though the London Beer Flood is sitting right there. For context, the London Beer Flood is an accident that occurred at a London brewery in 1814 where a giant vat of beer burst and flooded the surrounding streets. That's very much an "alcoholic beverage disaster in England", but our keyword search engine doesn't know that "beer" and "alcoholic beverage" are similar concepts, or that "London" is in "England," or that a "flood" is a type of "disaster." It only knows how to match strings [^natural_language_parsing].
3. Giving it some brains The SDK has some example agents for Anthropic, OpenAI, and local models. Let's walk through the Claude one, because that's what I had lying around[^tokens].
4. Others don't Not all browsers do this out of the box, so you need to provide them with a more formalized configuration. Most browsers find out about the search functionality of a website through an OpenSearch XML file that directs them to the right page.

**Answer:**

The best day trips from Amsterdam include visiting the Amalfi Coast, exploring the scenic towns of Ravenna, and enjoying the coastal charm of Capri. These destinations offer stunning beaches, historic sites, and relaxation opportunities.

label: u

---

## 14

**Question:** How much does Algolia cost per month?

1. Term frequency Let's expand our Abstract dataclass to compute and store it's term frequencies when we index it. That way, we'll have easy access to those numbers when we want to rank our unordered list of documents: We need to make sure to generate these frequency counts when we index our data: We'll modify our search function so we can apply a ranking to the documents in our result set. We'll fetch the documents using the same Boolean query from the index and document store, and then we'll for every document in that result set, we'll simply sum up how often each term occurs in that document
2. That doesn't mean that we can't think about fun expansions on this basic functionality though; for example, we assume that every field in the document has the same contribution to relevancy, whereas a query term match in the title should probably be weighted more strongly than a match in the description. Another fun project could be to expand the query parsing; there's no reason why either all or just one term need to match. Why not exclude certain terms, or do AND and OR between individual terms? Can we persist the index to disk and make it scale beyond the confines of my laptop RAM?
3. It runs entirely in memory on my laptop, whereas libraries like Lucene utilize hyper-efficient data structures and even optimize disk seeks, and software like Elasticsearch and Solr scale Lucene to hundreds if not thousands of machines. That doesn't mean that we can't think about fun expansions on this basic functionality though; for example, we assume that every field in the document has the same contribution to relevancy, whereas a query term match in the title should probably be weighted more strongly than a match in the description.
4. Inverse Document Frequency That's already a lot better, but there are some obvious short-comings. We're considering all query terms to be of equivalent value when assessing the relevancy for the query. However, it's likely that certain terms have very little to no discriminating power when determining relevancy; for example, a collection with lots of documents about beer would be expected to have the term "beer" appear often in almost every document (in fact, we're already trying to address that by dropping the 25 most common English words from the index).

**Answer:**

The passage does not answer the question about Algolia pricing.

label: f

---

## 15

**Question:** How do I get an HTTPS certificate for my own domain on free static hosting?

1. Validating a domain Similar to a traditional process of obtaining a certificate for a domain, where you create an account with the CA and add domains you control, the certificate management agent needs to perform a test to prove that it controls the domain. The agent will ask the Let's Encrypt CA what it needs to do to prove that it is, effectively, in control of the domain. The CA will look at the domain, and issue one or more challenges to the agent it needs to complete to prove that it has control over the domain.
2. The CA will look at the domain, and issue one or more challenges to the agent it needs to complete to prove that it has control over the domain. For example, it can ask the agent to provision a particular DNS record under the domain, or make an HTTP resource available under a particular URL. With these challenges, it provides the agent with a nonce (some random number that can only be used once for verification purposes). In the image above, the agent creates a file on a specified path on the web server (in this case, on https://example.com/8303).
3. Optionally, you can enforce HTTPS in the settings of your repository. This will upgrade all users requesting stuff from your site over HTTP to be automatically redirected to HTTPS. If you use A records to route traffic to your website, you need to update your DNS settings at your registrar. These IP addresses are new, and have an added benefit of putting your static site behind a CDN (just like we did with Cloudflare in the previous post).
4. How does it do that? It works by running a bit of software on your web server, a certificate management agent. This agent software has two tasks: it proves to the Let's Encrypt certificate authority that it controls the domain, and it requests, renews and revokes certificates for the domain it controls.

**Answer:**

To verify that the Let's Encrypt certificate was properly issued, you would run a bit of software on your web server to check if the cert exists there. Here's how to do it:

1. Open a terminal window using the command line. You may also want to set up a virtual environment so you don't have to worry about installing any dependencies yourself. Run the following commands into the terminal window:

   ```
   python /path/to/.gitlab-server/vhost_name@mydomain.org/certificate

    # Verify that the cert exists
    .gitlab

label: n

---

## 16

**Question:** What has the blog written about hashing and bit arrays?

1. For simplicity's sake, we'll use a bit array[^bitarraydisclaimer] with 15 bits (m=15) and 3 hashing functions (k=3) for the running example. To add elements to the array, our add method needs to run k hashing functions on the input that each will almost randomly pick an index in our bit array. We'll use the mmh3 library to hash our element, and use the amount of hash functions we want to apply as a seed to give us different hashes for each of them.
2. We'll use the mmh3 library to hash our element, and use the amount of hash functions we want to apply as a seed to give us different hashes for each of them. Finally, we compute the remainder of the hash divided by the size of the bit array to obtain the position we want to set.[^signedisfalse] In our case (m=15 and k=3), we would set the bits at index 1, 7 and 10 to one for the string hello. Now, to determine if an element is in the bloom filter, we apply the same hash functions to the element, and see whether the bits at the resulting indices are all 1.
3. How does it work? An empty Bloom filter is a bit array of a particular size (let's call that size m) where all the bits are set to 0. In addition, there must be a number (let's call the number k) of hashing functions defined. Each of these functions hashes a value to one of the positions in our array m, distributing the values uniformly over the array. We'll do a very simple Python implementation[^bloom_gist] of a Bloom filter. For simplicity's sake, we'll use a bit array[^bitarraydisclaimer] with 15 bits (m=15) and 3 hashing functions (k=3) for the running example.
4. You can see how this approach guarantuees that there will be no false negatives, but that there might be false positives; especially in our toy example with the small bit array, the more elements you add to the filter, the more likely it gets that the three bits we hash an element to are set other elements (running one of the hash functions on the string world will also set the bit at index 6 to 1): We can actually compute the probability of our Bloom filter returning a false positive, as it is a function of the number of bits used in the bit array divided by the length of the bit array (m) to the power of hash functions we're using k (we'll leave that for a future post though).

**Answer:**

The blog discusses how a bit array works within a Bloom filter, explaining its basic operation through examples like setting specific bits or determining membership based on randomness. It highlights the importance of choosing appropriate parameters such as `m` (size of the array) and `k` (number of hashing functions) while emphasizing the trade-off between false positives and false negatives. The article also references practical considerations, including increasing the number of bits (`m`) and hashing functions (`k`) to improve accuracy without significantly affecting performance.

label: f

---

## 17

**Question:** How is MurmurHash used in the blog's examples?

1. Closing thoughts There are a lot more applications for Bloom filters out there, and I can't list them all here. I hope a gave you a whirlwind overview of how Bloom filters work and how they might be useful to you. Feel free to drop me a line or comment below if you have nice examples of where they're used, or if you have any feedback, comments, or just want to say hi :-) [^BigO]: The runtime for both inserting and checking is defined by the number of hash functions (k) we have to execute. So, O(k).
2. We'll use the mmh3 library to hash our element, and use the amount of hash functions we want to apply as a seed to give us different hashes for each of them. Finally, we compute the remainder of the hash divided by the size of the bit array to obtain the position we want to set.[^signedisfalse] In our case (m=15 and k=3), we would set the bits at index 1, 7 and 10 to one for the string hello. Now, to determine if an element is in the bloom filter, we apply the same hash functions to the element, and see whether the bits at the resulting indices are all 1.
3. For simplicity's sake, we'll use a bit array[^bitarraydisclaimer] with 15 bits (m=15) and 3 hashing functions (k=3) for the running example. To add elements to the array, our add method needs to run k hashing functions on the input that each will almost randomly pick an index in our bit array. We'll use the mmh3 library to hash our element, and use the amount of hash functions we want to apply as a seed to give us different hashes for each of them.
4. [^infinite_dial]: https://www.edisonresearch.com/infinite-dial-2019/ [^accessibility]: Not to mention that audio content is more easily accessible for people that suffer from dyslexia or poor sight, or seems to be a lot better for user engagement. [^gcloud]: It has all kinds of funky stuff, like multiple languages, API clients in your favorite programming language, pitch, speaking rates and volume controls, and even optimizations around where your audio is going to play, such as headphones or phone lines. [^free]: Free is my favorite price.

**Answer:**

The blog's examples use the mmh3 library to hash elements, with the number of hash functions used as the seed so each hash function produces a different result. The remainder of each hash divided by the bit array size then gives the index to set (for example, in its m=15, k=3 example, the string "hello" sets bits at indices 1, 7 and 10).

label: f

---

## 18

**Question:** How do I fine-tune Kokoro to speak in my own voice?

1. The 2010 sound of 2019 Here is the main argument for doing this at all. This is a paragraph of that 2019 post, read by Google's Wavenet, exactly as it has sounded on the live site since I published it: And here is the same post, re-narrated today by Kokoro running locally on my laptop: I also added a script that samples the audio and creates an actual image of the shape of the soundwave; look at the difference between the nasal Wavenet voice and the Kokoro one.
2. Apply the lexicon so the jargon is spelled the way it should sound. 3. Chunk the prose on sentence boundaries into bite-sized pieces. 4. Synthesize each chunk with Kokoro. 5. Stitch the pieces into one MP3. A click CLI wraps it, with an --all flag that backs up the existing audio and re-renders every post behind a progress bar: "Runs on your laptop" always has an asterisk or two; Python 3.13 removed the audioop module that pydub needs, so there is a backport pinned in. Kokoro's English G2P needs a couple of extra packages that aren't installed by default.
3. This is a paragraph of that 2019 post, read by Google's Wavenet, exactly as it has sounded on the live site since I published it: And here is the same post, re-narrated today by Kokoro running locally on my laptop: I also added a script that samples the audio and creates an actual image of the shape of the soundwave; look at the difference between the nasal Wavenet voice and the Kokoro one. It puts stress in roughly the right places, pauses at clause boundaries instead of on a fixed timer, and doesn't have that metallic edge.
4. The 82 million parameters matter: the weights are a few hundred megabytes, not the tens of gigabytes a large speech model requires. And it was trained mostly on long-form reading, which is exactly the job here. It is a narrator, not a chatbot voice. The thing that makes it practical on ~a~ my laptop is MLX-Audio, which runs Kokoro on Apple's MLX framework; natively on the Apple Silicon GPU, no PyTorch, no CUDA, no ONNX runtime. The whole "install" is: and then, in Python, the entire synthesis step is: Kokoro ships with 54 voices; I settled on af_heart for narration[^kokoro_compare].

**Answer:**

The blog does not seem to cover fine-tuning Kokoro on your own voice. The passages only describe using Kokoro's built-in voices, such as af_heart, which the author chose for narration.

label: f

---

## 19

**Question:** How does BM25 ranking improve on TF-IDF?

1. In the original post, we built an inverted index with TF-IDF ranking, and recently the project underwent some modernization with Hugging Face datasets and proper tooling. The core search engine hasn't changed: tokenize, stem, look up matching documents, rank by term frequency weighted by inverse document frequency. It works great when your query uses the same words as the documents. But when you don't know the right words to search for, you end up with empty results and sad emojis.
2. We'll compute the inverse document frequency for a term by dividing the number of documents (N) in the index by the amount of documents that contain the term, and take a logarithm of that. We'll then simply multiple the term frequency with the inverse document frequency during our ranking, so matches on terms that are rare in the corpus will contribute more to the relevancy score[^moretfidf]. We can easily compute the inverse document frequency from the data available in our index:
3. Once upon a time I wrote a post about building a toy TF-IDF keyword search engine. It has been one of the more popular posts I've written, and in this age of AI I felt a sequel has been long overdue. It's pretty fast (even though it's written in pure Python), it ranks results with TF-IDF, and it can rank 6.4 million Wikipedia articles for a given query in milliseconds. But it has absolutely no context of what words mean. Not a single result, even though the London Beer Flood is sitting right there.
4. This is especially relevant for large corpora, where doing a full reindex of all your data is expensive, and you generally only want to store data relevant to relevancy in your search engine (and not attributes that are only relevant for presentation purposes). [^moretfidf]: For a more in-depth post about the algorithm, I recommend reading https://monkeylearn.com/blog/what-is-tf-idf/ and https://nlp.stanford.edu/IR-book/html/htmledition/term-frequency-and-weighting-1.html

**Answer:**

The key improvement lies in using the "inverse document frequency" (IDF) metric to further refine the search relevance score. By performing a full-text similarity measure (like the Times Ontology or similar) on the resulting list of queries, we can identify which words have been used in the corresponding documents. This information is then used to determine if the query is indeed being matched to a known set of words. The formula is:
    *   `Relevancy Score = (Normalized Difference Pairs Count - TF-IDF)`
    *   `Relevancy Score = (Normalized Difference Pairs Count

label: u

---

## 20

**Question:** What does the blog use the mmh3 library for?

1. Same model, same machine, matched settings: | Server | tok/s | multi-line edits | setup | |--------|-------|------------------|-------| | my patched mlx-lm | ±85 | works after a patch | an evening of yak-shaving | | LM Studio | ±80 | works | three checkboxes | So here's my actual recommendation: If you want a local coding agent, use Pi + LM Studio. Download LM Studio, pull Qwen3-Coder-30B-A3B, turn on 8-bit KV cache in the load dialog, start its server. Then point Pi at it: That's the whole thing. No patches, no rabbit hole. Would I do the mlx-lm version again? Absolutely.
2. We could use the collection frequency of a term (i.e. how often does this term occur across all documents), but in practice the document frequency is used instead (i.e. how many documents in the index contain this term). We're trying to rank documents after all, so it makes sense to have a document level statistic. We'll compute the inverse document frequency for a term by dividing the number of documents (N) in the index by the amount of documents that contain the term, and take a logarithm of that.
3. We'll compute the inverse document frequency for a term by dividing the number of documents (N) in the index by the amount of documents that contain the term, and take a logarithm of that. We'll then simply multiple the term frequency with the inverse document frequency during our ranking, so matches on terms that are rare in the corpus will contribute more to the relevancy score[^moretfidf]. We can easily compute the inverse document frequency from the data available in our index:
4. LM Studio's MLX runtime parses Qwen3-Coder's tool calls correctly out of the box; the bug that took down my toy server simply isn't there. Same model, same machine, matched settings: | Server | tok/s | multi-line edits | setup | |--------|-------|------------------|-------| | my patched mlx-lm | ±85 | works after a patch | an evening of yak-shaving | | LM Studio | ±80 | works | three checkboxes | So here's my actual recommendation: If you want a local coding agent, use Pi + LM Studio. Download LM Studio, pull Qwen3-Coder-30B-A3B, turn on 8-bit KV cache in the load dialog, start its server.

**Answer:**

The blog does not seem to cover this. None of the provided passages mention the mmh3 library.

label: n

---
