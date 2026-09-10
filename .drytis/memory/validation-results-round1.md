
═══════════════════════════════════════════════════════════════════
  QASE REAL APPLICATION VALIDATION
═══════════════════════════════════════════════════════════════════


── Exploring Wikipedia (https://en.wikipedia.org) ────────────────────────
  Purpose: ✅ expected=content detected=content (40%)
  Pages explored: 7 | Exploration confidence: 40%
  Gaps: 2 (0 workflow, 2 feature)
  Top gaps:
    [FT] Table of contents / navigation (low, 10%)
    [FT] Categories / tags (low, 10%)

── Exploring Hacker News (https://news.ycombinator.com) ────────────────────────
  Purpose: ✅ expected=content detected=content (7%)
  Pages explored: 2 | Exploration confidence: 20%
  Gaps: 4 (0 workflow, 4 feature)
  Top gaps:
    [FT] Logout / sign out (high, 1%)
    [FT] Search functionality (medium, 1%)
    [FT] Table of contents / navigation (low, 1%)

── Exploring Example.com (https://www.example.com) ────────────────────────
  Purpose: ✅ expected=marketing detected=marketing (7%)
  Pages explored: 1 | Exploration confidence: 20%
  Gaps: 5 (3 workflow, 2 feature)
  Top gaps:
    [FT] Contact form (medium, 1%)
    [WF] Workflow step missing: Learn more / features (medium, 1%)
    [WF] Workflow step missing: View pricing (medium, 1%)

── Exploring Vue.js Docs (https://vuejs.org) ────────────────────────
  Purpose: ✅ expected=content detected=content (40%)
  Pages explored: 8 | Exploration confidence: 40%
  Gaps: 2 (0 workflow, 2 feature)
  Top gaps:
    [FT] Table of contents / navigation (low, 10%)
    [FT] Categories / tags (low, 10%)

── Exploring Ghost Blog Demo (https://demo.ghost.io) ────────────────────────
  Purpose: ✅ expected=content detected=content (20%)
  Pages explored: 4 | Exploration confidence: 20%
  Gaps: 2 (0 workflow, 2 feature)
  Top gaps:
    [FT] Table of contents / navigation (low, 2%)
    [FT] Categories / tags (low, 2%)

── Exploring Vue Storefront (https://demo.storefrontcloud.io) ────────────────────────
  Purpose: ✅ expected=ecommerce detected=ecommerce (7%)
  Pages explored: 1 | Exploration confidence: 20%
  Gaps: 5 (0 workflow, 5 feature)
  Top gaps:
    [FT] Product catalog browsing (critical, 1%)
    [FT] Shopping cart (critical, 1%)
    [FT] Checkout / payment flow (critical, 1%)

── Exploring Strapi (https://strapi.io) ────────────────────────
  Purpose: ❌ expected=marketing detected=content (40%)
  Pages explored: 9 | Exploration confidence: 40%
  Gaps: 2 (0 workflow, 2 feature)
  Top gaps:
    [FT] Table of contents / navigation (low, 10%)
    [FT] Categories / tags (low, 10%)


═══════════════════════════════════════════════════════════════════
  VALIDATION RESULTS
═══════════════════════════════════════════════════════════════════

App                      Expected       Detected            Conf    Result
─────────────────────────────────────────────────────────────────────────────────────
Wikipedia                content        content             40%     ✅
Hacker News              content        content             7%      ✅
Example.com              marketing      marketing           7%      ✅
Vue.js Docs              content        content             40%     ✅
Ghost Blog Demo          content        content             20%     ✅
Vue Storefront           ecommerce      ecommerce           7%      ✅
Strapi                   marketing      content             40%     ❌

─── METRICS ───────────────────────────────────────────────────

Purpose Detection Accuracy:   6/7 (86%)
Apps Tested:                  7
Avg Exploration Confidence:   29%
Total Gaps Found:             22
  Workflow Gaps:              3
  Feature Gaps:               19

─── DETAILED GAPS PER APP ─────────────────────────────────────

Wikipedia:
  [FEATURE] Table of contents / navigation (low, 10%)
  [FEATURE] Categories / tags (low, 10%)

Hacker News:
  [FEATURE] Logout / sign out (high, 1%)
  [FEATURE] Search functionality (medium, 1%)
  [FEATURE] Table of contents / navigation (low, 1%)
  [FEATURE] Categories / tags (low, 1%)

Example.com:
  [FEATURE] Contact form (medium, 1%)
  [WORKFLOW] Workflow step missing: Learn more / features (medium, 1%)
  [WORKFLOW] Workflow step missing: View pricing (medium, 1%)
  [WORKFLOW] Workflow step missing: Contact form (medium, 1%)
  [FEATURE] Privacy policy link (low, 1%)
  Journey: ✅Landing page → ❌Learn more / features → ❌View pricing → ❌Contact form → ❌Call to action → sign up

Vue.js Docs:
  [FEATURE] Table of contents / navigation (low, 10%)
  [FEATURE] Categories / tags (low, 10%)

Ghost Blog Demo:
  [FEATURE] Table of contents / navigation (low, 2%)
  [FEATURE] Categories / tags (low, 2%)

Vue Storefront:
  [FEATURE] Product catalog browsing (critical, 1%)
  [FEATURE] Shopping cart (critical, 1%)
  [FEATURE] Checkout / payment flow (critical, 1%)
  [FEATURE] Product search (high, 1%)
  [FEATURE] Order history (medium, 1%)
  Journey: ❌Browse product catalog → ❌View product details → ❌Search products → ❌Add to cart → ❌Checkout → ❌Order confirmation → ❌Account registration → ❌Order history

Strapi:
  [FEATURE] Table of contents / navigation (low, 10%)
  [FEATURE] Categories / tags (low, 10%)


─── JSON OUTPUT ───────────────────────────────────────────────

[
  {
    "app": "Wikipedia",
    "url": "https://en.wikipedia.org",
    "description": "Content / Encyclopedia",
    "expectedPurpose": "content",
    "detectedPurpose": "content",
    "detectedPurposeName": "Content / Blog / Documentation / Wiki",
    "purposeConfidence": 40,
    "purposeCorrect": true,
    "purposeSignals": [
      "article",
      "help",
      "wiki",
      "encyclopedia",
      "news",
      "read",
      "search",
      "many pages, no auth"
    ],
    "pagesExplored": 7,
    "explorationConfidence": 40,
    "stepsDetected": [],
    "journeySteps": 0,
    "gapsFound": 2,
    "workflowGaps": 0,
    "featureGaps": 2,
    "gapDetails": [
      {
        "feature": "Table of contents / navigation",
        "severity": "low",
        "confidence": 10,
        "workflow": false
      },
      {
        "feature": "Categories / tags",
        "severity": "low",
        "confidence": 10,
        "workflow": false
      }
    ],
    "journeyDetail": []
  },
  {
    "app": "Hacker News",
    "url": "https://news.ycombinator.com",
    "description": "Content / News Aggregator",
    "expectedPurpose": "content",
    "detectedPurpose": "content",
    "detectedPurposeName": "Content / Blog / Documentation / Wiki",
    "purposeConfidence": 7,
    "purposeCorrect": true,
    "purposeSignals": [
      "news"
    ],
    "pagesExplored": 2,
    "explorationConfidence": 20,
    "stepsDetected": [],
    "journeySteps": 0,
    "gapsFound": 4,
    "workflowGaps": 0,
    "featureGaps": 4,
    "gapDetails": [
      {
        "feature": "Logout / sign out",
        "severity": "high",
        "confidence": 1,
        "workflow": false
      },
      {
        "feature": "Search functionality",
        "severity": "medium",
        "confidence": 1,
        "workflow": false
      },
      {
        "feature": "Table of contents / navigation",
        "severity": "low",
        "confidence": 1,
        "workflow": false
      },
      {
        "feature": "Categories / tags",
        "severity": "low",
        "confidence": 1,
        "workflow": false
      }
    ],
    "journeyDetail": []
  },
  {
    "app": "Example.com",
    "url": "https://www.example.com",
    "description": "Marketing / Landing Page",
    "expectedPurpose": "marketing",
    "detectedPurpose": "marketing",
    "detectedPurposeName": "Marketing / Landing Page",
    "purposeConfidence": 7,
    "purposeCorrect": true,
    "purposeSignals": [
      "few pages, no auth"
    ],
    "pagesExplored": 1,
    "explorationConfidence": 20,
    "stepsDetected": [
      "landing"
    ],
    "journeySteps": 5,
    "gapsFound": 5,
    "workflowGaps": 3,
    "featureGaps": 2,
    "gapDetails": [
      {
        "feature": "Contact form",
        "severity": "medium",
        "confidence": 1,
        "workflow": false
      },
      {
        "feature": "Workflow step missing: Learn more / features",
        "severity": "medium",
        "confidence": 1,
        "workflow": true
      },
      {
        "feature": "Workflow step missing: View pricing",
        "severity": "medium",
        "confidence": 1,
        "workflow": true
      },
      {
        "feature": "Workflow step missing: Contact form",
        "severity": "medium",
        "confidence": 1,
        "workflow": true
      },
      {
        "feature": "Privacy policy link",
        "severity": "low",
        "confidence": 1,
        "workflow": false
      }
    ],
    "journeyDetail": [
      {
        "step": "Landing page",
        "detected": true
      },
      {
        "step": "Learn more / features",
        "detected": false
      },
      {
        "step": "View pricing",
        "detected": false
      },
      {
        "step": "Contact form",
        "detected": false
      },
      {
        "step": "Call to action → sign up",
        "detected": false
      }
    ]
  },
  {
    "app": "Vue.js Docs",
    "url": "https://vuejs.org",
    "description": "Documentation / Content",
    "expectedPurpose": "content",
    "detectedPurpose": "content",
    "detectedPurposeName": "Content / Blog / Documentation / Wiki",
    "purposeConfidence": 40,
    "purposeCorrect": true,
    "purposeSignals": [
      "docs",
      "guide",
      "reference",
      "search",
      "many pages, no auth"
    ],
    "pagesExplored": 8,
    "explorationConfidence": 40,
    "stepsDetected": [],
    "journeySteps": 0,
    "gapsFound": 2,
    "workflowGaps": 0,
    "featureGaps": 2,
    "gapDetails": [
      {
        "feature": "Table of contents / navigation",
        "severity": "low",
        "confidence": 10,
        "workflow": false
      },
      {
        "feature": "Categories / tags",
        "severity": "low",
        "confidence": 10,
        "workflow": false
      }
    ],
    "journeyDetail": []
  },
  {
    "app": "Ghost Blog Demo",
    "url": "https://demo.ghost.io",
    "description": "Blog / Content",
    "expectedPurpose": "content",
    "detectedPurpose": "content",
    "detectedPurposeName": "Content / Blog / Documentation / Wiki",
    "purposeConfidence": 20,
    "purposeCorrect": true,
    "purposeSignals": [
      "blog",
      "search",
      "many pages, no auth"
    ],
    "pagesExplored": 4,
    "explorationConfidence": 20,
    "stepsDetected": [],
    "journeySteps": 0,
    "gapsFound": 2,
    "workflowGaps": 0,
    "featureGaps": 2,
    "gapDetails": [
      {
        "feature": "Table of contents / navigation",
        "severity": "low",
        "confidence": 2,
        "workflow": false
      },
      {
        "feature": "Categories / tags",
        "severity": "low",
        "confidence": 2,
        "workflow": false
      }
    ],
    "journeyDetail": []
  },
  {
    "app": "Vue Storefront",
    "url": "https://demo.storefrontcloud.io",
    "description": "E-commerce Demo",
    "expectedPurpose": "ecommerce",
    "detectedPurpose": "ecommerce",
    "detectedPurposeName": "E-commerce / Online Store",
    "purposeConfidence": 7,
    "purposeCorrect": true,
    "purposeSignals": [
      "store"
    ],
    "pagesExplored": 1,
    "explorationConfidence": 20,
    "stepsDetected": [],
    "journeySteps": 8,
    "gapsFound": 5,
    "workflowGaps": 0,
    "featureGaps": 5,
    "gapDetails": [
      {
        "feature": "Product catalog browsing",
        "severity": "critical",
        "confidence": 1,
        "workflow": false
      },
      {
        "feature": "Shopping cart",
        "severity": "critical",
        "confidence": 1,
        "workflow": false
      },
      {
        "feature": "Checkout / payment flow",
        "severity": "critical",
        "confidence": 1,
        "workflow": false
      },
      {
        "feature": "Product search",
        "severity": "high",
        "confidence": 1,
        "workflow": false
      },
      {
        "feature": "Order history",
        "severity": "medium",
        "confidence": 1,
        "workflow": false
      }
    ],
    "journeyDetail": [
      {
        "step": "Browse product catalog",
        "detected": false
      },
      {
        "step": "View product details",
        "detected": false
      },
      {
        "step": "Search products",
        "detected": false
      },
      {
        "step": "Add to cart",
        "detected": false
      },
      {
        "step": "Checkout",
        "detected": false
      },
      {
        "step": "Order confirmation",
        "detected": false
      },
      {
        "step": "Account registration",
        "detected": false
      },
      {
        "step": "Order history",
        "detected": false
      }
    ]
  },
  {
    "app": "Strapi",
    "url": "https://strapi.io",
    "description": "Marketing / Landing Page",
    "expectedPurpose": "marketing",
    "detectedPurpose": "content",
    "detectedPurposeName": "Content / Blog / Documentation / Wiki",
    "purposeConfidence": 40,
    "purposeCorrect": false,
    "purposeSignals": [
      "blog",
      "help",
      "search",
      "many pages, no auth"
    ],
    "pagesExplored": 9,
    "explorationConfidence": 40,
    "stepsDetected": [],
    "journeySteps": 0,
    "gapsFound": 2,
    "workflowGaps": 0,
    "featureGaps": 2,
    "gapDetails": [
      {
        "feature": "Table of contents / navigation",
        "severity": "low",
        "confidence": 10,
        "workflow": false
      },
      {
        "feature": "Categories / tags",
        "severity": "low",
        "confidence": 10,
        "workflow": false
      }
    ],
    "journeyDetail": []
  }
]
