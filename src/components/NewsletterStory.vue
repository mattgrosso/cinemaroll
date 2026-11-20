<template>
  <!-- One story in the issue, set like a magazine piece (Matt, 2026-11-20:
       "make this thing look more like an article in a magazine ... some
       pictures"): a full-width picture, a serif headline and deck, a drop cap,
       a pull quote and stills between the paragraphs. Which pictures, and
       where, is decided by the Lambda (the film's own TMDB stills) and
       newsletterStory.js; the model never names an image. -->
  <section class="newsletter-section newsletter-story">
    <h2 class="newsletter-section-title">{{ kicker }}</h2>

    <figure v-if="hero" class="newsletter-hero">
      <img :src="stillUrl(hero)" alt="" loading="lazy" draggable="false" />
      <figcaption v-if="heroCaption">{{ heroCaption }}</figcaption>
    </figure>

    <slot name="before"/>

    <div class="newsletter-story-head" :class="{ 'newsletter-story-head--portrait': headshot }">
      <img
        v-if="headshot"
        class="newsletter-headshot"
        :src="headshotUrl(headshot)"
        :alt="headshotAlt"
        loading="lazy"
        draggable="false"
      />
      <div>
        <h3 class="newsletter-story-headline">{{ headline }}</h3>
        <p v-if="hook" class="newsletter-hook">{{ hook }}</p>
      </div>
    </div>

    <slot name="meta"/>

    <div class="newsletter-story-body">
      <template v-for="block in blocks" :key="block.key">
        <p v-if="block.type === 'para'" class="newsletter-para" :class="{ 'newsletter-para--lead': block.lead }">{{ block.text }}</p>
        <blockquote v-else-if="block.type === 'quote'" class="newsletter-pullquote">{{ block.text }}</blockquote>
        <figure v-else-if="block.type === 'still'" class="newsletter-still">
          <img :src="stillUrl(block.path)" alt="" loading="lazy" draggable="false" />
          <figcaption v-if="stillCaption">{{ stillCaption }}</figcaption>
        </figure>
      </template>
    </div>

    <slot/>
  </section>
</template>

<script>
import { storyBlocks, stillUrl, headshotUrl } from '../assets/javascript/newsletterStory.js';

export default {
  name: 'NewsletterStory',
  props: {
    kicker: { type: String, required: true },
    headline: { type: String, default: '' },
    hook: { type: String, default: '' },
    article: { type: String, default: '' },
    hero: { type: String, default: null },
    heroCaption: { type: String, default: '' },
    stills: { type: Array, default: () => [] },
    stillCaption: { type: String, default: '' },
    pullQuote: { type: String, default: null },
    headshot: { type: String, default: null },
    headshotAlt: { type: String, default: '' }
  },
  computed: {
    blocks () {
      return storyBlocks(this.article, { stills: this.stills, pullQuote: this.pullQuote });
    }
  },
  methods: { stillUrl, headshotUrl }
};
</script>

<style lang="scss">
// The magazine voice: the serif stack Newsprinted sets its stories in, all of
// it already on an iPhone, so nothing extra is downloaded.
$newsletter-serif: 'Iowan Old Style', 'Palatino', 'Charter', 'Georgia', 'Times New Roman', serif;

.newsletter-story {
  margin-top: 2.75rem;
}

.newsletter-hero,
.newsletter-still {
  margin: 0 -1rem 1rem;

  img {
    aspect-ratio: 16 / 9;
    background: #2a2a2a;
    display: block;
    height: auto;
    object-fit: cover;
    width: 100%;
    -webkit-touch-callout: none;
    -webkit-user-drag: none;
  }

  figcaption {
    color: #ccc;   /* ~11:1 on the page; Bootstrap's muted grey would fail */
    font-size: 0.72rem;
    letter-spacing: 0.03em;
    padding: 0.35rem 1rem 0;
  }
}

.newsletter-still {
  margin: 1.5rem -1rem 1.5rem;
}

@media (min-width: 46rem) {
  .newsletter-hero,
  .newsletter-still {
    margin-left: 0;
    margin-right: 0;

    img { border-radius: 0.3rem; }
    figcaption { padding-left: 0; padding-right: 0; }
  }
}

.newsletter-story-head--portrait {
  align-items: center;
  display: flex;
  gap: 0.9rem;
}

.newsletter-headshot {
  aspect-ratio: 1;
  border-radius: 50%;
  flex: 0 0 84px;
  object-fit: cover;
  object-position: center 20%;
  width: 84px;
}

.newsletter-story-headline {
  font-family: $newsletter-serif;
  font-size: 1.6rem;
  font-weight: 700;
  line-height: 1.15;
  margin: 0.4rem 0 0.5rem;
}

.newsletter-hook {
  color: #ddd;
  font-family: $newsletter-serif;
  font-size: 1.05rem;
  font-style: italic;
  line-height: 1.4;
  margin-bottom: 1.1rem;
}

.newsletter-story-body .newsletter-para {
  font-family: $newsletter-serif;
  font-size: 1.08rem;
  line-height: 1.6;
  margin-bottom: 1rem;
}

// A drop cap on the opening paragraph, the most magazine thing there is.
.newsletter-para--lead::first-letter {
  color: #f0d68a;
  float: left;
  font-family: $newsletter-serif;
  font-size: 3.4rem;
  font-weight: 700;
  line-height: 0.85;
  margin: 0.3rem 0.45rem 0 0;
}

.newsletter-pullquote {
  border-bottom: 1px solid rgba(240, 214, 138, 0.5);
  border-top: 1px solid rgba(240, 214, 138, 0.5);
  color: #f0d68a;   /* pale gold on near-black, ~12:1 */
  font-family: $newsletter-serif;
  font-size: 1.4rem;
  font-style: italic;
  line-height: 1.3;
  margin: 1.5rem 0.5rem;
  padding: 0.9rem 0;
  text-align: center;
}
</style>
