---
title: "Free SSL with a custom domain on GitHub Pages"
date: 2018-03-28T23:55:40+02:00
draft: false
slug: "free-ssl-on-github-pages-with-a-custom-domain"
categories: ["ssl", "hugo", "how-to", "gh-pages", "https"]
keywords: ["ssl", "hugo", "github pages", "https", "free ssl", "cloudflare"]
---

[GitHub Pages](https://pages.github.com/) is pretty awesome. It lets you push a bunch of static HTML (and/or CSS and Javascript) to a GitHub repository, and they'll host and serve it for you. For free!<!--more-->

{{< audio src="/audio/2018-03-28-free-ssl-on-github-pages-with-a-custom-domain.mp3" type="mp3" backup_src="/audio/2018-03-28-free-ssl-on-github-pages-with-a-custom-domain.ogg" backup_type="ogg">}}

You basically set up a specific repository (you have to name it `<your_username>.github.io`), you push your HTML there, and they will be available at `https://<your_username>.github.io`. Did I mention that this is free?

While you can perfectly write and push HTML files straight to your GitHub repository, there's a whole [bunch](https://jekyllrb.com/docs/home/) of open source [static](https://gohugo.io/) [site](https://hyde.github.io/) generators available that provide a structured way of organising content, in formats ([Markdown](https://daringfireball.net/projects/markdown/) 🙌) that are easier to work with[^staticsitegenerators]. GitHub even supports one of them ([Jekyll](https://github.com/jekyll/jekyll)) out of the box, so you can just push your project as is and they'll take care of building of your HTML too[^jekyllvshugo].

You can even set up your own custom domain! Register your domain at your favourite registrar, and change a setting for your repository:

![GitHub settings](/img/2018-03-28-free-ssl-on-github-pages-with-a-custom-domain/github-repository-settings.png)

There, you fill out the custom domain you want your site to be available at (in my case that's `bart.degoe.de`).

![GitHub custom domain settings](/img/2018-03-28-free-ssl-on-github-pages-with-a-custom-domain/github-pages-settings-custom-domain.png)

Before you rush off to your registrar to point your domain (or subdomain, in my case[^confession]), make sure you add a `CNAME` file to the root of your repository. The [`CNAME` file](https://github.com/bartdegoede/bartdegoede.github.io/blob/master/CNAME) should contain the URL your website should be displaying in the browser (this is important for redirects). In my case, the file contains `bart.degoe.de`, because that's the URL I want my site to be published under.

# Setting up CloudFlare and SSL

Then, all you need to do is add a `CNAME` entry to your domain settings settings. Right? Well, yes and no. Yes, setting up a `CNAME` DNS record will get your website working under the proper URL (it might take a while for the DNS change to propagate).

![Registrar CNAME](/img/2018-03-28-free-ssl-on-github-pages-with-a-custom-domain/registrar-cname.png)

However, serving your static files from GitHub under your own domain name does pose a problem; GitHub Pages only supports SSL for the `github.io` domain, not for custom domains (they have a wildcard certificate for their own domain, but supporting HTTPS on custom domains is not trivial[^opengithubissue]).

That means that your website can't take advantage of [HTTP/2 speedups](https://www.mnot.net/blog/2014/01/04/strengthening_http_a_personal_view), it will have negative impact on your [Google ranking](https://webmasters.googleblog.com/2014/08/https-as-ranking-signal.html), [Chrome](https://developers.google.com/web/updates/2016/10/avoid-not-secure-warn) will show your visitors that your website is [not secure](https://security.googleblog.com/2016/09/moving-towards-more-secure-web.html) and even for your static site with [fancy Javascript features](https://bart.degoe.de/searching-your-hugo-site-with-lunr/) you do want to protect your users when they're reading your posts on unsecured Wi-Fi networks.

## CloudFlare

Fortunately, there's a way to get this coveted green secure lock on your static website. [CloudFlare](https://www.cloudflare.com/)[^cloudflare] provides the (free) feature "Universal SSL" that will allow your users to access your website over SSL. Sign up for a free account, and enter the (non-SSL-ized) domain name of your website in their scanning tool:

![CloudFlare setup](/img/2018-03-28-free-ssl-on-github-pages-with-a-custom-domain/cloudflare.png)

CloudFlare will fetch your current DNS configuration, and will provide you with instructions on how to enable CloudFlare for your (sub-)domain(s). The idea is that CloudFlare will act as a proxy between your GitHub hosted site and the user. This will allow them to encrypt traffic between _their_ servers and your users (the traffic between GitHub and CloudFlare is also encrypted, but doesn't require you to install an SSL certificate on the GitHub servers; added bonus is that they can cache your content on servers close to your visitors increasing the page speed of your website).

Enable CloudFlare for the (sub)domain you're hosting your website on:

![CloudFlare DNS](/img/2018-03-28-free-ssl-on-github-pages-with-a-custom-domain/cloudflare-dns.png)

## Enabling SSL

CloudFlare's Universal SSL lets you provide your website's users with a valid signed SSL certificate. There's several configuration options for Universal SSL (find it in the "Crypto" tab), and make sure your SSL mode is set to `Full SSL` (but not `Full SSL (Strict)`!).

![CloudFlare DNS](/img/2018-03-28-free-ssl-on-github-pages-with-a-custom-domain/cloudflare-ssl.png)

Do note it may take a while (up to 24 hours) for CloudFlare to set you up with your SSL certificates. They will send you an email once they're provisioned and ready to go.

Next, create a Page Rule. Page rules are, surprisingly, rules that apply to a page or a collection of pages. These rules can do a lot of cool things, such as automatically obfuscating emails on the page, control cache settings or add geolocation information to the requests. The rule you're looking for is "Always Use HTTPS", which will enforce all requests for pages matching the URL pattern you provide to use SSL:

![CloudFlare pagerule](/img/2018-03-28-free-ssl-on-github-pages-with-a-custom-domain/cloudflare-pagerule.png)

In my case, I only have one URL for my website. However, if you use the `www` subdomain (i.e. `www.example.com`), you might want to add a Page Rule that redirects users that type `example.com` to `www.example.com`, where you enforce HTTPS to ensure all users benefit from encrypted requests. However, if you add more Page Rules, make sure that the HTTPS rule is the primary (first) page rule. Only one rule will trigger per URL, so you'll want to make sure that this one is listed first!

# Profit! Right?

This article has gotten quite meaty for the steps you have to follow, so if you're looking for a more concise set of steps, this Gist by [@cvan](https://github.com/cvan) is great:

{{< gist cvan 8630f847f579f90e0c014dc5199c337b >}}

There's a lot more you can do with CloudFlare and your static site (you could set up caching on CloudFlare's content distribution network, for example), but be aware that even though you've encrypted your traffic, you should still be [careful](https://help.github.com/articles/what-is-github-pages/) in submitting sensitive data to (third-party) APIs with Javascript; "GitHub Pages sites shouldn't be used for sensitive transactions like sending passwords or credit card numbers". Your website's source code is publicly available in your GitHub repository, so be mindful of any scripts and content you publish there.

[^staticsitegenerators]: I use [Hugo](https://gohugo.io) for this website, which is written in Golang ("fast" and "easy" are keywords I like). There's [a lot](https://www.staticgen.com/) of [different static site generators](https://myles.github.io/awesome-static-generators/) out there, each with their own focuses, advantages and trade-offs.
[^jekyllvshugo]: In my setup, I have two [separate](https://github.com/bartdegoede/blog) [repositories](https://github.com/bartdegoede/bartdegoede.github.io), where I maintain the Hugo project structure in one (the `blog` repository), and build and push the static files to the other (the `bartdegoede.github.io` repository). What I like about that is that it gives me a ["deploy" step](https://github.com/bartdegoede/blog/blob/master/deploy.sh), so I don't accidentally push something that's not finished yet.
[^confession]: Skipping this step took me a lot longer to figure out than I'm willing to admit.
[^opengithubissue]: There's been disscusions about this for [a while](https://github.com/isaacs/github/issues/156).
[^cloudflare]: CloudFlare is a company that provides a content-delivery network ([CDN](https://en.wikipedia.org/wiki/Content_delivery_network)), [DDoS](https://en.wikipedia.org/wiki/Denial-of-service_attack#Distributed_attack) protection services, DNS and a whole slew of other services for websites.
