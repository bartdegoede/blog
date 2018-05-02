---
title: "Free SSL on Github Pages with a custom domain: Part 2 - Let's Encrypt"
date: 2018-05-02T22:34:06+02:00
draft: false
slug: "github-pages-and-lets-encrypt"
categories: ["ssl", "hugo", "how-to", "gh-pages", "https", "lets-encrypt"]
---

[GitHub Pages](https://pages.github.com/) has just become even more awesome. Since yesterday[^yesterday], GitHub Pages [supports HTTPS for custom domains](https://blog.github.com/2018-05-01-github-pages-custom-domains-https/). And yes, it is still free!<!--more-->

# Let's Encrypt
GitHub has partnered with [Let's Encrypt](https://letsencrypt.org/), which is a free, open and automated certificate authority (CA). It is run by the [Internet Security Research Group (ISRG)](https://letsencrypt.org/isrg/), which is a public benefit corporation[^pbccalifornia] [funded](https://letsencrypt.org/sponsors/) by donations and a bunch of large corporations and non-profits.

The goal of this initiative is to secure the web by making it very easy to obtain a free, trusted SSL certificate. Moreover, it lets web servers run a piece of software that not only gets a valid SSL certificate, but will also configure your web server and automatically renew the certificate when it expires.

## How does it do that?
It works by running a bit of software on your web server, a certificate management agent. This agent software has two tasks: it proves to the Let's Encrypt certificate authority that it controls the domain, and it requests, renews and revokes certificates for the domain it controls.

### Validating a domain
Similar to a traditional process of obtaining a certificate for a domain, where you create an account with the CA and add domains you control, the certificate management agent needs to perform a test to prove that it controls the domain.

The agent will ask the Let's Encrypt CA what it needs to do to prove that it is, effectively, in control of the domain. The CA will look at the domain, and issue one or more challenges to the agent it needs to complete to prove that it has control over the domain. For example, it can ask the agent to provision a particular DNS record under the domain, or make an HTTP resource available under a particular URL. With these challenges, it provides the agent with a [nonce](https://en.wikipedia.org/wiki/Cryptographic_nonce) (some random number that can only be used once for verification purposes).

{{< figure src="/img/2018-05-02-free-ssl-on-github-pages-with-a-custom-domain-part-2/howitworks_challenge.png" title="CA issuing a challenge to the certificate management agent (image taken from https://letsencrypt.org/how-it-works/)" >}}

In the image above, the agent creates a file on a specified path on the web server (in this case, on `https://example.com/8303`). It creates a key pair it will use to identify itself with the CA, and signs the nonce received from the CA with the private key. Then, it notifies the CA that it has completed the challenge by sending back the signed nonce and is ready for validation. The CA then validates the completion of the challenge by attempting to download the file from the web server and verify that it contains the expected content.

{{< figure src="/img/2018-05-02-free-ssl-on-github-pages-with-a-custom-domain-part-2/howitworks_authorization.png" title="Certificate management agent completing a challenge (image taken from https://letsencrypt.org/how-it-works/)" >}}

If the signed nonce is valid, and the challenge is completed successfully, the agent identified by the public key is officially authorized to manage valid SSL certificates for the domain.

### Certificate management
So, what does that mean? By having validated the agent by its public key, the CA can now validate that messages sent to the CA are actually sent by the certificate management agent.

It can send a [Certificate Signing Request (CSR)](http://tools.ietf.org/html/rfc2986) to the CA to request it to issue a SSL certificate for the domain, signed with the authorized key. Let's Encrypt will only have to validate the signatures, and if those check out, a certificate will be issued.

{{< figure src="/img/2018-05-02-free-ssl-on-github-pages-with-a-custom-domain-part-2/howitworks_certificate.png" title="Issuing a certificate (image taken from https://letsencrypt.org/how-it-works/)" >}}

Let's Encrypt will add the certificate to the appropriate channels, so that browsers will know that the CA has validated the certificate, and will display that coveted green lock to your users!

# So, GitHub Pages
Right, that's how we got started. The awesome thing about Let's Encrypt is that it is automated, so all this handshaking and verifying happens behind the scenes, without you having to be involved.

In the [previous post]({{< ref "2018-03-28-free-ssl-on-github-pages-with-a-custom-domain.md" >}}) we saw how to set up a [`CNAME` file](https://github.com/bartdegoede/bartdegoede.github.io/blob/master/CNAME) for your custom domain. That's it. Done. Works out of the box.

Optionally, you can [enforce HTTPS](https://help.github.com/articles/securing-your-github-pages-site-with-https/) in the settings of your repository. This will upgrade all users requesting stuff from your site over HTTP to be automatically redirected to HTTPS.

{{< figure src="/img/2018-05-02-free-ssl-on-github-pages-with-a-custom-domain-part-2/github-pages-enforce-https.png" >}}

If you use `A` records to route traffic to your website, you need to update your [DNS settings](https://help.github.com/articles/setting-up-an-apex-domain/) at your registrar. These IP addresses are new, and have an added benefit of putting your static site behind a CDN (just like we did with Cloudflare in the [previous post]({{< ref "2018-03-28-free-ssl-on-github-pages-with-a-custom-domain.md" >}})).

# SSL all the things
Let's Encrypt makes securing the web easy. [More and more websites](https://letsencrypt.org/stats/) are served over HTTPS only, so it is getting increasingly difficult for script kiddies to [sniff your web traffic](https://motherboard.vice.com/en_us/article/jpgmxp/how-to-go-from-0-to-sniffing-packets-in-10-minutes) on free WiFi networks. Moreover, they provide this service world-wide, to anyone, _for free_. Help them help you (and the rest of the world), and [buy them a coffee](https://letsencrypt.org/donate/)!

[^yesterday]: At time of writing, yesterday is May 1, 2018.
[^pbccalifornia]: One in [California](https://en.wikipedia.org/wiki/Public-benefit_corporation#California), to be specific.
