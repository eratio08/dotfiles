---
description: Create an Intent Layer node (AGENTS.md) for the current directory
model: github-copilot/claude-opus-4.5
---

# Create Intent Node

Create an AGENTS.md file that compresses this directory's code into high-signal context for AI agents. Capture the mental model senior engineers have—not what the code does, but WHY, invariants, gotchas, and hidden contracts.

## Expected Outcome

After running this command, you will have:
- ✅ An AGENTS.md file in the target directory
- ✅ 500-1500 token document (typically ~800 tokens)
- ✅ 10:1 or better compression ratio vs source code
- ✅ Documented invariants, gotchas, and boundaries specific to this directory
- ✅ Clear entry points and anti-patterns for working in this area
- ✅ (Non-leaf nodes) Links to child Intent Nodes if they exist

**Time estimate:** 2-5 minutes for leaf nodes, 5-10 minutes for non-leaf nodes with existing children.

## Invocation

```
/create-intent-node [directory] [--interactive] [--force]
```

- `directory`: Target directory (default: current working directory)
- `--interactive`: Conduct SME interview to capture tribal knowledge
- `--force`: Overwrite existing AGENTS.md without prompting

## Execution Steps

### Step 0: Setup & Validation

1. **Parse arguments** and determine target directory (default: current working directory)

2. **Validate target directory exists:**
   ```bash
   ls -la [target_directory]
   ```
   If command fails, report error: "Directory not found: [target_directory]" and exit

3. **Create TodoWrite tracker**:
   ```
   - [ ] Analyze directory structure (leaf vs non-leaf)
   - [ ] Load ancestor Intent Nodes
   - [ ] Analyze code in target directory
   - [ ] Discover child Intent Nodes (if non-leaf)
   - [ ] Generate AGENTS.md content
   - [ ] Write file and report results
   ```

4. **Check for existing AGENTS.md**:
   - If exists and `--force` not set: Ask user "(a) Overwrite, (b) Enhance existing, (c) Cancel"
   - If exists and `--force` set: Backup to `AGENTS.md.bak`, proceed

### Step 1: Directory Structure Analysis

**Run using Bash tool:**
```bash
pwd
```

**Run using Bash tool:**
```bash
ls -la [target_directory]
```

**Count code files in current directory using Bash tool:**
```bash
find [target_directory] -maxdepth 1 -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.java" -o -name "*.go" -o -name "*.rs" -o -name "*.rb" -o -name "*.c" -o -name "*.cpp" \) | wc -l
```

**Find subdirectories using Bash tool:**
```bash
find [target_directory] -mindepth 1 -maxdepth 1 -type d ! -name "node_modules" ! -name "dist" ! -name "build" ! -name ".git" ! -name "__pycache__"
```

**Determine node type using this decision tree:**

```
IS NON-LEAF if ANY:
├─ Has ≥2 subdirectories each containing ≥3 code files
├─ Has existing child AGENTS.md files in subdirectories
├─ Subdirectories represent distinct domains (e.g., services/, models/, utils/)
└─ Total estimated tokens in subdirs > 40k

IS LEAF if:
├─ Contains only code files (no meaningful subdirs)
├─ Single cohesive purpose/responsibility
└─ Total code < 30k tokens
```

**Mark Step 1 complete in TodoWrite.**

### Step 2: Load Ancestor Context

**Find parent Intent Nodes using Glob tool:**

Use pattern: `**/AGENTS.md` starting from parent of target directory, searching upward toward repository root (up to 5 levels).

**For each ancestor AGENTS.md found, read the file.** These provide context that should NOT be duplicated in the new node.

Extract from ancestors:
- Project-wide conventions
- Shared invariants
- Cross-cutting concerns already documented

**Key principle:** Use Least Common Ancestor (LCA) - don't duplicate information that's already in parent nodes. This new node should only add information specific to this directory level.

**Mark Step 2 complete in TodoWrite.**

### Step 3: Code Analysis

**Discover code files using Glob tool:**
- **Pattern:** `**/*.{ts,tsx,js,jsx,py,java,go,rs,rb,c,cpp,h,hpp}`
- **Path:** `[target_directory]`
- **Automatically excludes:** node_modules, dist, build, .git, __pycache__, target, .next, .cache directories

**IMPORTANT:** Use the Glob tool, not bash find/ls commands. Glob automatically handles exclusions.

**Count the discovered files and select strategy:**

| File Count | Strategy |
|------------|----------|
| <20 files | Read all files directly using Read tool |
| 20-50 files | Read key files only using priority order below |
| 50+ files | Use agent workflow below + read top 5-10 priority files |

---

**For directories with 50+ files, use this agent workflow:**

**Step 3a: Launch `codebase-analyzer` agent using Task tool:**

Prompt:
```
Analyze [target_directory] to help create an AGENTS.md Intent Node. Return:

1. PRIMARY RESPONSIBILITY: What is this directory's single main purpose? (1-2 sentences)

2. ENTRY POINTS: What files/functions does external code call into this directory? List with file paths.

3. INTERNAL ARCHITECTURE: How do the main components relate to each other? (brief description)

4. INVARIANTS: What rules or constraints must always hold in this code? (things that would break if violated)

5. HIDDEN DEPENDENCIES: Any env vars, config files, or external services this code requires?

Focus on architecture and contracts, not line-by-line code description. Be specific with file:line references.
```

**Step 3b: Launch `codebase-pattern-finder` agent using Task tool (sequential - after Step 3a completes):**

Prompt:
```
Find patterns and conventions in [target_directory] for an AGENTS.md Intent Node. Return:

1. CODE PATTERNS: How are similar things done? (e.g., error handling, data validation, API calls)

2. ANTI-PATTERNS: What approaches exist in the codebase that should NOT be copied? Why?

3. NAMING CONVENTIONS: Any conventions not enforced by types or linters?

4. GOTCHAS: What would confuse someone unfamiliar with this code?

Return concrete examples with file:line references for each finding.
```

**Step 3c: Evaluate agent responses:**

If either agent returns insufficient information (vague answers, "I couldn't determine", or missing sections):

→ **Ask user:** "The [agent-name] agent couldn't fully analyze [target_directory]. It returned: [brief summary of gaps]. Should I:
   (a) Read more files directly to fill gaps (slower, uses more context)
   (b) Proceed with partial information (I'll note gaps in the AGENTS.md)
   (c) Provide guidance on where to look"

**Step 3d: Read priority files:**

After agent analysis, read **top 5-10 files** based on priority order:
1. Entry points: `index.ts`, `main.py`, `mod.rs`, `lib.rs`, `__init__.py`, `app.ts`, `server.ts`
2. Core logic: `*Service.*`, `*Controller.*`, `*Handler.*`, `*Manager.*`
3. Contracts: `types.ts`, `interfaces.*`, `models.*`, `schema.*`, `*.d.ts`
4. Config: `*.config.*` (in root only)

---

**For directories with <50 files:**

Read files in priority order until you have enough context:
1. Entry points: `index.ts`, `main.py`, `mod.rs`, `lib.rs`, `__init__.py`, `app.ts`, `server.ts`
2. Core logic: `*Service.*`, `*Controller.*`, `*Handler.*`, `*Manager.*`, `*Processor.*`
3. Contracts: `types.ts`, `interfaces.*`, `models.*`, `schema.*`, `*.d.ts`
4. Config: `*.config.*`, `*.yml`, `*.yaml`, `*.json` (in root)
5. Existing docs: `README.md`, `CONTRIBUTING.md`
6. Tests: `*.test.*`, `*.spec.*`, `*_test.*` (for usage patterns)

---

**While analyzing (from agents or direct reading), identify:**
- [ ] Primary responsibility (1-2 sentences max)
- [ ] What this area explicitly DOES NOT do
- [ ] Entry points and public API surface
- [ ] Key invariants (things that must always be true)
- [ ] Non-obvious patterns (conventions not enforced by types)
- [ ] Anti-patterns (things that look right but are wrong)
- [ ] Hidden dependencies (config files, environment, external services)
- [ ] Gotchas (things that confused you or would confuse agents)

**Mark Step 3 complete in TodoWrite.**

### Step 4: Discover Child Nodes (Non-Leaf Only)

**Skip this step if determined to be a leaf node in Step 1.**

If non-leaf node:

**Find child Intent Nodes using Glob tool:**
- Pattern: `*/AGENTS.md`
- Path: `[target_directory]`
- This finds immediate child directories with AGENTS.md files

**For each child node found:**
1. Read the file
2. Extract: directory name, Purpose & Scope section (first 2 sentences)
3. Prepare downlink with 1-sentence summary

**Mark Step 4 complete in TodoWrite.**

### Step 5: Generate AGENTS.md Content

**Use this exact template structure:**

```markdown
# [Directory Name]

> [One-line description: what this area is and its primary responsibility]

## Scope

**Owns:** [What this code is responsible for]

**Does NOT own:** [Explicit boundaries - what goes elsewhere]

## Contracts

[Key invariants and rules that must hold. Use bullet points.]

- All X must go through Y
- Never call Z directly; use W instead
- [Constraint]: [Reason if not obvious]

## Entry Points

| Entry | Purpose | Notes |
|-------|---------|-------|
| `function/class` | What it does | Constraints or gotchas |

## Patterns

[How to correctly work in this area. Include minimal code examples.]

```language
// Example: [What this demonstrates]
[Minimal code showing the pattern]
```

## Anti-Patterns

[What NOT to do. Be specific.]

- ❌ Don't: [Bad pattern] → ✅ Do: [Correct approach]
- ❌ [Another anti-pattern] — [Why it's wrong]

## Dependencies

**Requires:**
- `path/to/dependency` — [What for]

**Required by:**
- `path/to/dependent` — [What for]

[NON-LEAF ONLY]
## Child Areas

- `./subdir/` — [1-sentence summary] → [`AGENTS.md`](./subdir/AGENTS.md)

## Gotchas

[Non-obvious things that will trip up agents or new engineers]

- [Gotcha]: [Explanation]
- [Config/env dependency]: [Where it lives, what happens if missing]
```

**Content Guidelines:**

| Guideline | Target |
|-----------|--------|
| Total length | 500-1500 tokens (aim for 800) |
| Compression ratio | 10:1 or better |
| Purpose section | ≤3 sentences |
| Each contract | 1 line, actionable |
| Code examples | ≤10 lines each, max 2 examples |
| No duplication | Don't repeat ancestor node content |

**Critical: Focus on what code CAN'T express:**
- Intent and "why" decisions were made
- Invariants not enforced by types
- Historical context ("we tried X, it failed because Y")
- Gotchas from production incidents
- Non-obvious dependencies
- Performance characteristics
- Security boundaries

**Mark Step 5 complete in TodoWrite.**

### Step 6: Interactive Interview (If --interactive flag provided)

**Only run this step if user explicitly provided `--interactive` flag.**

Ask these targeted questions to capture tribal knowledge:

1. "What's the #1 thing an agent working here MUST NOT do?"

2. "Is there any 'tribal knowledge' about this code that isn't in comments or docs?"

3. "What usually breaks when someone unfamiliar modifies this code?"

4. "Are there any non-obvious dependencies (env vars, config files, external services)?"

**Format questions with context from your code analysis:**
```
I analyzed [directory] and noticed [specific observation].

Question: [One of the above questions, tailored to context]

My current understanding: [What you think based on code]
```

**Incorporate answers into the AGENTS.md content before writing in Step 7.**

### Step 7: Write & Report

1. **Verify using quality checklist** (see Quality Checklist section below)

2. **Write AGENTS.md using Write tool:**
   - File path: `[target_directory]/AGENTS.md`
   - Content: Generated content from Step 5

3. **Mark Step 7 complete in TodoWrite**

4. **Report results to user:**

```
✅ Created: [path]/AGENTS.md

Summary:
- Type: [Leaf/Non-leaf] node
- Scope: [1-line purpose]
- Contracts: [N] invariants documented
- Gotchas: [N] pitfalls captured
[If non-leaf]
- Outlinks: [N] child nodes linked

Token estimate: ~[X] tokens (covering ~[Y]k tokens of code, [Z]:1 compression)

Next steps:
[If children exist without AGENTS.md]
- Consider creating Intent Nodes for: ./child1/, ./child2/
[If this is deep in hierarchy]
- Parent node at [path] may need downlink to this node
```

## Edge Cases

| Situation | Action |
|-----------|--------|
| Empty directory | Report error: "No code files found in [dir]" |
| Only config files | Create minimal node focused on configuration purpose |
| Monorepo root | Create high-level navigation node with downlinks only |
| Test directory | Focus on test patterns, fixtures, and how to add new tests |
| Generated code | Note "DO NOT EDIT" prominently, document generation source |
| Existing AGENTS.md is comprehensive | Ask user preference: overwrite, enhance, or cancel |
| User provides directory that doesn't exist | Report error: "Directory not found: [dir]" |
| Very large directory (>200 files) | Follow Step 3 agent workflow (codebase-analyzer + codebase-pattern-finder), warn about limited coverage, read only top 5 priority files |

## Quality Checklist (Verify Before Writing)

Before writing the AGENTS.md file, verify:

- [ ] Purpose fits in ≤3 sentences
- [ ] At least 1 concrete contract/invariant stated
- [ ] At least 1 anti-pattern or gotcha documented
- [ ] No content duplicated from ancestor nodes
- [ ] All paths in outlinks are correct and files exist
- [ ] Total length < 1500 tokens (estimate: 1 token ≈ 4 characters)
- [ ] Answers: "How do I work here safely?"
- [ ] Focuses on WHY and hidden context, not WHAT code does
- [ ] Uses specific file:line references where helpful
- [ ] Code examples are minimal and illustrate key patterns

## Reference: What Makes a Good Intent Node

**Good Intent Nodes:**
- Answer "what must I never break here?" in <30 seconds
- Compress 20k+ tokens of code into <1k tokens
- Capture knowledge that ISN'T in the code
- Use specific file:line references where helpful
- Provide escape hatches ("if X doesn't apply, see Y")
- Focus on invariants, gotchas, and boundaries
- Use progressive disclosure (summary + downlinks)

**Bad Intent Nodes:**
- Describe what code does (that's what code is for)
- Duplicate README content
- Exceed 2k tokens for a single directory
- Use vague language ("be careful with X")
- List every file/function (use code navigation for that)
- Duplicate information from ancestor nodes
- Lack concrete examples or specific guidance

**Remember: The Intent Layer is for AGENTS, not humans. Optimize for token efficiency and immediate actionability.**

## Examples

### Example 1: Leaf Node (Validation Module)

```markdown
# Validators

> Input validation layer for payment requests. Only enforcement point for business rules before settlement.

## Scope

**Owns:** Pre-settlement validation (amounts, currencies, regions, fraud checks)

**Does NOT own:** Settlement logic (see `../settlement/`), billing rules (see `../../billing/`)

## Contracts

- All validations flow through `ValidatorChain.validate()` - never call validators directly
- Validators MUST be stateless and idempotent
- Validators MUST return `ValidationResult`, never throw exceptions
- Validators MUST complete in <100ms (monitored in production)

## Entry Points

| Entry | Purpose | Notes |
|-------|---------|-------|
| `ValidatorChain.validate()` | Main validation entry point | Runs all registered validators in order |
| `Validator` interface | Base for all validators | Implement `validate(PaymentRequest): ValidationResult` |

## Patterns

```typescript
// Adding a new validator
class RegionValidator implements Validator {
  validate(req: PaymentRequest): ValidationResult {
    if (!SUPPORTED_REGIONS.includes(req.region)) {
      return ValidationResult.fail('UNSUPPORTED_REGION');
    }
    return ValidationResult.success();
  }
}

// Register in ValidatorChain (see validators/index.ts:23)
chain.register(new RegionValidator());
```

## Anti-Patterns

- ❌ Don't call validators directly → ✅ Always use `ValidatorChain`
- ❌ Don't add stateful checks (e.g., rate limiting) → ✅ Use middleware layer
- ❌ Don't call external APIs in validators → ✅ Breaks <100ms contract

## Dependencies

**Requires:**
- `platform-config/validation-rules.yml` — Business rule thresholds
- `types/PaymentRequest.ts` — Request schema

**Required by:**
- `../PaymentService.ts:142` — Calls before settlement

## Gotchas

- Currency validation uses ISO 4217 codes (`USD`), NOT symbols (`$`)
- Amount limits are per-transaction, not per-session (session tracking is in `PaymentService`)
- Validator order matters: `RegionValidator` must run before `AmountValidator` (region affects limits)
- Config is cached for 5min - restart required for immediate rule changes in dev
```

### Example 2: Non-Leaf Node (Services Directory)

```markdown
# Services

> Business logic layer containing all core service implementations. Each service owns a bounded context.

## Scope

**Owns:** Business logic, orchestration, transaction management

**Does NOT own:** HTTP routing (see `../api/`), data access primitives (see `../repositories/`)

## Contracts

- Services MUST NOT call other services directly - use event bus or API clients
- All database transactions MUST be managed by service methods (repository methods are non-transactional)
- Services MUST validate inputs even if API layer validated (defense in depth)
- Services MUST return domain errors, never throw exceptions for business rule violations

## Entry Points

Each service exports a class with public methods:
- `PaymentService` - Payment processing
- `BillingService` - Invoice generation
- `NotificationService` - User notifications

Services are dependency-injected via `container.ts`

## Patterns

```typescript
// Service pattern
class PaymentService {
  async processPayment(req: PaymentRequest): Promise<Result<Payment, PaymentError>> {
    // 1. Validate (even if API layer validated)
    const validation = await this.validator.validate(req);
    if (!validation.isValid) {
      return Err(PaymentError.validation(validation.errors));
    }

    // 2. Begin transaction
    return this.db.transaction(async (tx) => {
      // 3. Business logic
      const payment = await this.createPayment(req, tx);

      // 4. Emit event (don't await - event bus handles delivery)
      this.events.emit('payment.created', payment);

      return Ok(payment);
    });
  }
}
```

## Anti-Patterns

- ❌ Services calling other services directly → ✅ Use event bus or API clients
- ❌ Catching all exceptions and returning success → ✅ Let unexpected errors bubble
- ❌ Business logic in repositories → ✅ Keep repos for data access only

## Dependencies

**Requires:**
- `../repositories/` — Data access layer
- `../events/` — Event bus
- `../config/` — Configuration

## Child Areas

- `./payment/` — Payment processing service → [`AGENTS.md`](./payment/AGENTS.md)
- `./billing/` — Billing and invoicing service → [`AGENTS.md`](./billing/AGENTS.md)
- `./notification/` — User notification service → [`AGENTS.md`](./notification/AGENTS.md)

## Gotchas

- Service methods that emit events are eventually consistent - don't assume synchronous processing
- Transaction isolation level is READ_COMMITTED - phantom reads are possible
- Services share database but each service owns specific tables (see `docs/schema-ownership.md`)
- Event bus delivery is at-least-once - handlers must be idempotent
```
