# docs — Public Documentation Standards

Customer-facing docs and API reference. Hosted via Mintlify. These standards are NEW — existing pages may not follow them yet. **Reference pages that DO follow the standard: Catalog, Projects, Virtual Machines.** Use those as examples.

## Critical Rules

1. **`api-reference/openapi.yaml` is the single source of truth** — update FIRST, then sync to raff-go → raff-cli → terraform-provider-raff
2. **Never include admin/internal endpoints or fields** — public API only
3. **Auth: `X-API-Key` only** — no JWT, no `X-Account-ID`, no admin keys
4. **Verify before publishing** — check endpoint actually works, don't blindly document
5. **Direct language** — no marketing, no jargon, go straight to value. Short paragraphs (2-3 sentences max)
6. **Update changelog** — when adding/changing any API endpoint, add dated entry to the product's changelog page

## Writing Style

- **Direct** — "Create a VM" not "Virtual Machine Creation Guide"
- **Simple** — make complex things simple, but still comprehensive
- **Action-oriented** — lead with what the user can DO
- **No filler** — cut "In order to", "Please note that", "It is important to"
- **Code examples** — curl for API, yaml for Terraform, bash for CLI
- **Short paragraphs** — 2-3 sentences. If longer, break it up.

## 4 Product Pillars

| Pillar | Products |
|--------|----------|
| **Build** | Virtual Machines (incl. Snapshots, Backups as VM operations), Kubernetes, Raff Apps |
| **Store** | Volumes, Object Storage |
| **Network** | VPC, Floating IPs, Security Groups |
| **Manage** | Projects, Team & Access (Members, Roles, API Keys) |
| *Future* | *Automate, AI* |

Snapshots and Backups are point-in-time artifacts of a VM (and eventually a Volume), not standalone storage products — they live under Virtual Machines.

## Reference (3 sections)

| Section | Content | Inspiration |
|---------|---------|-------------|
| **API Reference** | OpenAPI-generated endpoints | [DigitalOcean API](https://docs.digitalocean.com/reference/api/reference/) |
| **CLI Reference** | raff-cli commands | [DigitalOcean doctl](https://docs.digitalocean.com/reference/doctl/) |
| **Terraform Reference** | Provider resources/datasources | [DigitalOcean Terraform](https://docs.digitalocean.com/reference/terraform/) |

## Product Page Template

Each product follows the same 5-section taxonomy: **Overview / Quickstart & guides / Concepts / Details / Troubleshooting**. New users follow Overview top-down; lookup users hit Details or Troubleshooting via search. Identical on every product so it stops being a design decision.

**Canonical copyable templates live at:**
- `docs/products/_template.mdx` — Overview page
- `docs/products/_template-quickstart.mdx` — task how-to
- `docs/products/_template-concept.mdx` — explainer
- `docs/products/_template-details.mdx` — spec sheet
- `docs/products/_template-troubleshooting.mdx` — issue list

### Sidebar rule — nested sub-groups, no products dropdown

The Products tab uses **nested sub-groups** in `docs.json`: pillar group → product group → section group → pages. Sub-pages are reachable directly from the sidebar, not just via cards on the Overview page. See `feedback_no_products_switcher.md` — we deliberately do NOT use Mintlify's `navigation.products` dropdown switcher.

### Overview page (`index.mdx`)
```
1. Frontmatter — title is always "Overview"; the sidebar shows the product name as the group header above it.
2. Updated date — <sub>Updated MONTH DAY, YEAR</sub>
3. One paragraph — what it is, key specs, who it's for. Direct, no marketing.
4. Hero <Frame> — /images/products/<pillar>/<product>/hero.png; alt text prefixed with "TODO:" until the real screenshot is dropped in.
5. ## Most viewed — 2x2 CardGroup linking to the 4 dashboard tasks users come for.
6. ## Browse — 2x3 CardGroup linking to the 5 sections (Quickstart & guides, Concepts, Details, Troubleshooting) plus API Reference and Changelog.
```

The sidebar nested groups + the global `Products` anchor handle navigation back; no inline back-link needed.

**Screenshot convention.** Every product Overview has a hero `<Frame>` and may add inline `<Frame>` blocks in quickstart/guide pages. Use the path `/images/products/<pillar>/<product>/<name>.png` and prefix the alt text with `TODO:` until the file exists. This makes outstanding screenshot work greppable.

### Standard files per product
```
products/{pillar}/{product}/
├── index.mdx                    # Overview (the per-product hub)
├── quickstart-guides/           # Dashboard task how-tos (one MDX per task)
│   ├── create-...mdx
│   ├── ...
│   └── delete-...mdx
├── concepts/                    # Explainers (what + why, not how-to)
│   └── ...mdx
├── details/                     # Spec sheets (features, limits, pricing, SLA)
│   ├── features-and-limits.mdx
│   └── pricing.mdx
└── troubleshooting.mdx          # Common issues + recovery (single file)
# NO per-product changelog — use global /api-reference/changelog
```

When a section has only 1 page, it can be a flat `.mdx` (e.g. `troubleshooting.mdx`); when it has multiple, it's a folder. Both render the same in the sidebar group.

### Changelog (single global page at `/api-reference/changelog`)

- **One changelog for everything** — not per-product. Grouped by date → product section.
- API version stays same until finalized (currently v1.0.0)
- Each change has a **date**, not a version bump
- When finalized → freeze, start next version
- This is NOT the app release log (`releases/vX.Y.Z.md`)
- **Every entry has an emoji tag:**
  - 🟢 **Added** — new endpoint or new parameter
  - 🔵 **Updated** — changed behavior or new param on existing endpoint (say WHICH part changed)
  - 🟡 **Deprecated** — still works but will be removed (warn users, tell them what to use instead)
  - 🔴 **Removed** — endpoint or parameter deleted, no longer available
  - 🟣 **Fixed** — bug fix on existing endpoint
- **Group by date → section (product + reference type):**
  ```
  ### March 15, 2026

  **Virtual Machines — API**
  - 🟢 **Added** — **Resize VM disk storage** — `POST /api/v1/vms/{id}/resize-disk`
  - 🔵 **Updated** — **Create VM** now accepts `enable_ipv6` — `POST /api/v1/vms`

  **Projects — CLI**
  - 🟢 **Added** — `raff project create` command
  ```
- **Section format:** `{Product} — {Reference Type}` where reference type is: API, CLI, or Terraform

## API Reference Rules

### Before Adding an Endpoint
1. Endpoint must actually work in the backend — don't document unimplemented features
2. Must be public (customer-facing) — no admin-only endpoints
3. If it returns internal fields, strip them first

### POST Endpoints — Prerequisites
Every POST endpoint must clearly state what the user needs to fetch first:
```markdown
<Note>
Before creating a VM, you need:
- A **template ID** — get from [List Templates](/api-reference/catalog/list-templates)
- A **pricing plan ID** — get from [List VM Pricing](/api-reference/catalog/list-vm-pricing)
- A **project ID** — get from [List Projects](/api-reference/projects/list-projects)
</Note>
```

### Each Endpoint Page
- Method + path
- Description (1-2 sentences)
- Prerequisites (what to fetch first)
- Parameters table (required/optional, type, description, example)
- Request example (curl)
- Response example (actual JSON)
- Error codes specific to this endpoint

## Mintlify Conventions

- Pages: `.mdx` format
- Navigation: `docs.json`
- API endpoints: auto-generated from `openapi.yaml`
- Components: `<Card>`, `<CardGroup>`, `<CodeGroup>`, `<Tabs>`, `<Accordion>`, `<Note>`, `<Warning>`
- Icons: use Mintlify icon names (e.g. `icon="plus"`, `icon="server"`)

## Quick Commands

```bash
npx mintlify dev     # Local preview at localhost:3000
```

## Sync Order

```
openapi.yaml (here) → MDX endpoint pages → raff-go → raff-cli → terraform-provider-raff
```

When you change the API spec:
1. Edit `api-reference/openapi.yaml`
2. Add/update MDX pages if needed
3. Update product changelog page with dated entry
4. Test locally: `npx mintlify dev`
5. After merging: sync downstream (raff-go → CLI → Terraform)
