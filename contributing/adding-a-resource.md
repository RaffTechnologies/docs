---
title: Adding a new resource to the public API
---

# Adding a new resource to the public API

Walks through adding a resource end-to-end. The chain is:

```
docs/api-reference/openapi.yaml  →  raff-go (codegen)  →  raff-cli  →  terraform-provider-raff
```

Sync is automated through `make sync` and codegen — when the spec changes, raff-go is regenerated and the consumers rebuild against it.

## Prerequisites

- The backend gateway already implements the endpoints you're about to expose. Validate first with `curl` against `https://api.rafftechnologies.com/api/v1/...` and a real API key.
- You're working from the workspace root `raff_technologies/` where all four repos live side by side.

## 1. Edit the OpenAPI spec

Edit `docs/api-reference/openapi.yaml`:

- Add a tag for the resource (e.g. `Volumes`) under `tags:` if it doesn't exist.
- Add each operation under `paths:` with a unique `operationId`. Use camelCase verb-resource form: `listVolumes`, `createVolume`, `getVolume`, `resizeVolume`.
- Reference request/response schemas with `$ref: '#/components/schemas/Xxx'`. Avoid inline `type: object` definitions — they generate ugly anonymous structs in Go.
- Add the resource and request/response schemas under `components/schemas/`.

Spec quality rules that affect codegen:

- **`required:` arrays** on response schemas matter. Fields marked required generate as non-pointer Go types (`Name string` instead of `*string`). Mark every field that is *always* present in API responses as required. Optional/nullable fields stay non-required.
- **Avoid schemas named `<OperationID>Response`** — codegen generates a wrapper type with that exact name and you'll get a name collision. If you need a result schema, name it `XxxResult`.
- **Use enums via `enum:`** for fixed value sets (e.g. `region: enum: [us-east]`). Codegen produces a typed string for each.

Lint the spec locally:

```bash
cd docs && npx --yes @redocly/cli lint api-reference/openapi.yaml
```

Or via the top-level Makefile:

```bash
make spec-lint
```

## 2. Add Mintlify navigation and MDX stubs

Add the new operation pages in `docs/docs.json` under the appropriate group, and create matching MDX stubs in `docs/api-reference/<resource>/`. Each stub needs only the frontmatter:

```mdx
---
openapi: GET /api/v1/volumes
---
```

Mintlify auto-renders the page from `openapi.yaml`.

## 3. Scaffold the Go side

From the workspace root:

```bash
scripts/new-resource.sh Volume volume
```

This creates:

- `raff-go/<resource>s.go` — thin idiomatic wrapper using generated `spec.*` types
- `raff-cli/internal/commands/<resource>.go` — Cobra command group
- `terraform-provider-raff/internal/provider/resource_<resource>.go` — Terraform resource

Each file has TODO markers for the resource-specific bits (schema attributes, flag wiring, etc.).

## 4. Regenerate raff-go from the spec

```bash
make generate
```

This runs `go generate` in `raff-go/spec/`, which calls oapi-codegen against `docs/api-reference/openapi.yaml` and writes `raff-go/spec/spec.gen.go`. Commit the regenerated file along with the spec change — they belong together.

## 5. Resolve the TODO markers

Open the three scaffolded files and fill in the resource-specific code:

- **raff-go**: confirm the type aliases match the generated names (the spec might generate `CreateVolumeRequest` but if your operationId is `createVolume`, the request body alias is `CreateVolumeJSONRequestBody = CreateVolumeRequest`). Implement any non-CRUD methods (`Attach`, `Detach`, `Resize`, etc.).
- **raff-cli**: define the flags, build the request from flags, render output (table + JSON).
- **terraform-provider-raff**: define the schema (required, optional, computed), implement Create/Read/Update/Delete, write `setResourceXxxState` to copy the API response into Terraform state.

## 6. Wire each piece into its entry point

- `raff-go/raff.go` — add the field on `Client`, initialize it in `New`:
  ```go
  Volumes VolumeService
  // ...
  c.Volumes = &VolumeServiceOp{client: c}
  ```
- `raff-cli/internal/commands/root.go` — `rootCmd.AddCommand(newVolumeCmd())`
- `terraform-provider-raff/internal/provider/provider.go` — `ResourcesMap["raff_volume"] = resourceVolume()`

## 7. Verify end-to-end

From the workspace root:

```bash
make sync
```

This regenerates raff-go, then builds + vets + tests raff-cli and terraform-provider-raff against it. If anything fails, fix and re-run.

Smoke-test the new commands against prod:

```bash
cd raff-cli && go build ./...
RAFF_API_KEY=raff_pub_xxx ./bin/raff volume list
```

For Terraform, build the provider locally and use a dev override:

```bash
cd terraform-provider-raff && go build -o ~/bin/terraform-provider-raff
# In ~/.terraformrc:
# provider_installation {
#   dev_overrides { "rafftechnologies/raff" = "/Users/you/bin" }
#   direct {}
# }
```

Then run `terraform plan` against a config that uses the new resource.

## 8. Update the changelog

Add a dated entry to `docs/api-reference/changelog.mdx`:

```markdown
### {Today's Date}

**Volumes — API**
- 🟢 **Added** — **List volumes** — `GET /api/v1/volumes`
- 🟢 **Added** — **Create volume** — `POST /api/v1/volumes`

**Volumes — CLI**
- 🟢 **Added** — `raff volume list`, `raff volume create`, `raff volume get`, `raff volume delete`

**Volumes — Terraform**
- 🟢 **Added** — `raff_volume` resource
```

Use the emoji legend: 🟢 Added, 🔵 Updated, 🟡 Deprecated, 🔴 Removed, 🟣 Fixed.

## 9. Commit

The spec, regenerated SDK, CLI commands, and Terraform resource all live in different repos. Commit each separately with a matching message, and reference the spec change PR/commit in the downstream commits. The order is:

1. `docs` — spec + MDX stubs + changelog
2. `raff-go` — regenerated spec.gen.go + new wrapper file
3. `raff-cli` — new command file + root.go registration
4. `terraform-provider-raff` — new resource file + provider.go registration

## CI drift guard

Each Go repo has a `make verify` (or the top-level `make verify-no-drift`) target that:

1. Runs `go generate` in `raff-go/spec/`
2. Fails if `git status` shows any change to `spec.gen.go`

This catches the case where someone edits the spec but forgets to regenerate. Wire it into the raff-go CI check on every PR. (Note: in CI, raff-go needs the docs repo checked out at `../docs` for the generate step to find the spec.)

## Reference

- Spec: `docs/api-reference/openapi.yaml`
- Generated client: `raff-go/spec/spec.gen.go` — never edit by hand
- Codegen config: `raff-go/spec/oapi-codegen.yaml`
- Templates: `scripts/templates/*.tmpl`
- Scaffolding: `scripts/new-resource.sh`
- Top-level orchestrator: `Makefile`
