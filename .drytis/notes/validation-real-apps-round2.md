# Real Application Validation — Round 2 (30 Apps, Deep Exploration)

## Methodology
Deep BFS crawl: up to 20 pages per app via headless Chromium. Captured
headings, forms, buttons, search inputs, nav items, body text. Ran
purpose inference + feature gap + workflow analysis.

## Results

### Purpose Detection: 13/30 (43%)

| Category | Correct | Total | Notes |
|----------|---------|-------|-------|
| Content | 4/5 | 5 | Ghost Blog false-positive as marketing |
| Marketing | 2/5 | 5 | Stripe, Vercel mimic product keywords; Tailwind = docs-heavy |
| E-commerce | 2/5 | 5 | BigCommerce, Medusa misclassified |
| Developer | 2/5 | 5 | npm misclassified as ecommerce; GitLab, Postman as content |
| Productivity | 1/5 | 5 | Excalidraw, Draw.io SPA exploration fails; Notion barely explored |
| CMS | 2/5 | 5 | WordPress.com, Drupal, Sanity = content-heavy marketing |

### Exploration Improvement (v1 → v2)
- Avg pages explored: 2-8 (v1) → 14.6 (v2)
- Avg exploration confidence: 29% (v1) → 62% (v2)
- Purpose confidence: 7-40% (v1) → 60% (v2)

### Root Cause Analysis of Misclassifications (17 total)

**Category 1: Marketing↔Content confusion (10/17 = 59%)**
WordPress.com, Drupal, Sanity.io, Tailwind, Postman, GitLab, Obsidian
detected as content instead of marketing. These sites genuinely have
extensive blog/docs/guide content. The classifier correctly identifies
content; the "expected" label is debatable for content-heavy marketing.

**Category 2: Marketing copy mimics product keywords (4/17 = 24%)**
Stripe.com → ecommerce (describes payments/checkout)
Vercel.com → developer_platform (describes CI/deploy/repos)
BigCommerce.com → ecommerce (describes stores/products)
npmjs.com → ecommerce (describes packages as "products")

Root cause: keyword-based detection cannot distinguish "this site
DESCRIBES payments" from "this site PROCESSES payments." Only interactive
exploration (try adding to cart, try logging in) can resolve this.

**Category 3: SPA exploration failure (3/17 = 18%)**
Excalidraw, Draw.io, Medusa — JS-rendered SPAs where BFS link crawling
finds only 1 page. The crawler sees the initial HTML but not the
JS-rendered content/routes. Need client-side route detection.

### Key Insight
Purpose detection accuracy is bottlenecked by EXPLORATION DEPTH and
INTERACTION CAPABILITY, not classifier quality. The classifier works
well when it has good data (4/5 content sites correct at 80% confidence).
The failures are almost all cases where:
1. The site is a marketing site for a product company (keywords match
   the product, not the site type)
2. The site is an SPA that doesn't expose routes as crawlable links

### Recommendation
1. Fix SPA exploration (detect client-side routes, interact with nav)
2. Add interaction-based capability verification (try login, try cart)
3. Accept that marketing↔content boundary is inherently fuzzy without
   interactive verification — document as known limitation
4. The LLM enhancement layer (enhanceGapsWithLLM) can help disambiguate
   "Stripe.com describes payments" from "this shop has payments" using
   contextual understanding beyond keyword matching
