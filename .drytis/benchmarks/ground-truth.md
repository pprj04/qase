# QASE Phase 7 — Benchmark Ground Truth

This document contains the KNOWN ground truth for each benchmark application.
QASE output will be compared against this document to measure accuracy.
This document was created BEFORE running QASE and is stored separately from QASE output.

---

## App 1: SalesFlow CRM (localhost:9901)
**Build Prompt:** "Build a CRM for a sales team with contacts, leads, pipeline, and settings"
**Category:** CRM

### Expected Features (should exist)
- [x] Dashboard with stats
- [x] Contacts list (view, add, delete)
- [x] Leads list (view, add, advance through stages)
- [x] Pipeline view
- [x] Settings page

### Expected Workflows
- Dashboard → Contacts → Add Contact → Verify appears in list
- Dashboard → Leads → Add Lead → Advance → Verify stage change
- Dashboard → Pipeline → View kanban stages

### Intentionally Broken Behaviors
- **Login link ("Sign In")** — does nothing (no login flow)
- **Settings save** — shows "Settings saved" toast but doesn't persist

### Intentionally Missing Features
- No reports/analytics section
- No user/team management
- No email integration
- No API settings
- No search functionality

### Known-Good Behaviors
- Add Contact (modal form, validation, adds to table, persists in session)
- Delete Contact (removes from table)
- Add Lead (modal form, adds to table)
- Advance Lead (stage transitions: New→Contacted→Negotiation→Won)
- Hash routing (dashboard, contacts, leads, pipeline, settings)
- Settings form renders correctly

---

## App 2: TaskBoard (localhost:9902)
**Build Prompt:** "Build a project management app with a kanban board, tasks, and team"
**Category:** Project Management / Productivity

### Expected Features
- [x] Kanban board with 4 columns (To Do, In Progress, Review, Done)
- [x] Task creation (modal form)
- [x] Task advancement (click to move)
- [x] Priority labels
- [x] Assignee display

### Expected Workflows
- Add Task → Verify appears in "To Do"
- Click Task → Verify moves to "In Progress"
- Click again → "Review" → Click → "Done"

### Intentionally Broken Behaviors
- **"Sign In" link** — navigates to #login but no login form exists
- **"Reports" nav link** — navigates to #reports but no reports section exists
- **"Team" nav link** — navigates to #team but no team section exists

### Intentionally Missing Features
- No search/filter
- No due dates
- No comments/activity on tasks
- No drag-and-drop
- No user authentication
- No notifications

### Known-Good Behaviors
- Task creation with title, priority, assignee
- Task advancement through stages
- Board renders with 5 initial tasks
- Column counts update

---

## App 3: ShopHub E-commerce (localhost:9903)
**Build Prompt:** "Build an e-commerce store with products, cart, and checkout"
**Category:** E-commerce

### Expected Features
- [x] Product grid (6 products)
- [x] Search (text filter)
- [x] Add to cart
- [x] Cart view with quantity management
- [x] Checkout form
- [x] Order placement

### Expected Workflows
- Browse → Add to Cart → View Cart → Checkout → Place Order → Success
- Search → Filter results → Add to Cart

### Intentionally Broken Behaviors
- **No login/auth at all** — not even a link

### Intentionally Missing Features
- No user account/registration
- No order history/tracking
- No product review submission
- No wishlist
- No product categories (text search only)
- No shipping calculator
- Cart not persisted (no localStorage)

### Known-Good Behaviors
- Product browsing (6 items render)
- Search filters by name
- Add to cart (quantity increments)
- Remove from cart
- Cart total calculation
- Checkout form validation
- Order placement shows success message
- Cart count badge updates

---

## App 4: MetricsPro Analytics Dashboard (localhost:9904)
**Build Prompt:** "Build a SaaS analytics dashboard with user management, revenue tracking, and settings"
**Category:** SaaS Dashboard / Admin Tool

### Expected Features
- [x] Dashboard with 4 stat cards
- [x] User management table
- [x] Revenue breakdown table
- [x] Settings page
- [x] Sidebar navigation
- [x] User invite modal

### Expected Workflows
- Dashboard → Users → Invite User → Verify modal
- Dashboard → Revenue → View table
- Dashboard → Settings → Generate API Key

### Intentionally Broken Behaviors
- **"Sign In" link** — no login form
- **API key generation** — generates key but doesn't persist
- **Settings save** — toast only, no persistence
- **Refresh button** — toast only, data doesn't change

### Intentionally Missing Features
- No real charts (placeholder only)
- No data export (CSV/PDF)
- No date range filter
- No user roles/permissions
- No notifications
- No webhook configuration

### Known-Good Behaviors
- Sidebar navigation (4 sections)
- User table renders (4 users)
- Revenue table renders (3 plans)
- Invite user modal (validates email)
- Hash routing works

---

## App 5: SaaSLaunch Marketing Site (localhost:9905)
**Build Prompt:** "Build a SaaS marketing website with hero, features, pricing, and testimonials"
**Category:** Marketing Site / Landing Page

### Expected Features
- [x] Hero section with CTAs
- [x] Features grid (6 features)
- [x] Pricing cards (3 tiers)
- [x] Testimonials (2)
- [x] Footer with links

### Expected Workflows
- Scroll through sections (hero → features → pricing → testimonials → footer)
- Click nav links → smooth scroll to sections

### Intentionally Broken Behaviors
- **"Get Started Free" button** — does nothing (no registration)
- **Hero "Get Started Free"** — does nothing
- **"Sign In" link** — does nothing
- **All pricing buttons** — do nothing

### Intentionally Missing Features
- No login/registration system
- No blog page (link in footer)
- No contact form (link in footer)
- No privacy policy page (link in footer)
- No terms of service page
- No user dashboard

### Known-Good Behaviors
- All sections render correctly
- Navigation links scroll to sections
- Pricing cards display correctly
- Testimonials render

---

## Measurement Definitions

- **True Positive (TP):** QASE reports a real bug/gap that exists in ground truth
- **False Positive (FP):** QASE reports a bug/gap that does NOT exist
- **False Negative (FN):** Real bug/gap exists but QASE doesn't report it
- **True Negative (TN):** QASE correctly does not report something that doesn't exist

- **Precision** = TP / (TP + FP)
- **Recall** = TP / (TP + FN)
- **Accuracy** = (TP + TN) / (TP + TN + FP + FN)
