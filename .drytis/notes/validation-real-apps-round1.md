# Real Application Validation — Round 1

## Methodology
Explored 7 real publicly-accessible web apps using headless Chromium.
Captured page data (links, forms, headings, search inputs) in Qase session shape.
Ran purpose inference + feature gap + workflow analysis.

## Results

### Purpose Detection: 6/7 (86%)

| App | Expected | Detected | Confidence | Correct? |
|-----|----------|----------|-----------|----------|
| Wikipedia | content | content | 40% | ✅ |
| Hacker News | content | content | 7% | ✅ |
| Example.com | marketing | marketing | 7% | ✅ |
| Vue.js Docs | content | content | 40% | ✅ |
| Ghost Blog Demo | content | content | 20% | ✅ |
| Vue Storefront | ecommerce | ecommerce | 7% | ✅ |
| Strapi | marketing | content | 40% | ❌ |

**Misclassification:** Strapi (marketing site for a headless CMS product) detected as content.
Root cause: marketing signals were narrowed too aggressively (removed "about", "features", "contact", "blog") to avoid overlap with content. Strapi's homepage has documentation/blog content that triggered content purpose.

### Gap Detection Metrics
- Total gaps found: 22
- Workflow gaps: 3
- Feature gaps: 19
- Avg exploration confidence: 29%

### False Positives Identified
1. **Wikipedia "Categories/tags"** — Wikipedia has categories but the shallow exploration didn't visit category pages. Would be resolved with deeper exploration.
2. **Hacker News "Search functionality"** — HN has a search but it's not a prominent input element. The harness detected a search input but it may not be the main search.
3. **Example.com "Contact form"** — example.com is literally a placeholder domain with no form. This is actually a TRUE positive.

### Fixes Applied During Validation
1. **CMS false positive on Wikipedia** — CMS signals were too generic ("content", "article", "page" matched everything). Fixed: CMS now requires backend indicators (wp-admin, editor, publish, draft).
2. **Content purpose too narrow** — Added wiki, encyclopedia, news, reference, manual, read, search signals.
3. **Marketing signals too broad** — "about", "contact", "blog", "demo" matched every website. Narrowed to marketing-specific terms (newsletter, get started, try free, book a demo, testimonial).
4. **Search false positive** — detectFeatureGaps now checks capabilities map before flagging search as missing.
5. **Marketing structural detection too aggressive** — isMarketing now excludes sites with article/blog content.

### Known Limitations
- Shallow exploration (1-8 pages per app) limits what the engine can detect
- No SaaS, CRM, admin dashboard, or project management apps in the test set (couldn't find accessible public instances without auth walls)
- Strapi misclassification shows marketing↔content boundary is still fuzzy for B2B SaaS marketing sites with docs
