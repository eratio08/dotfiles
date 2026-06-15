---
description: Create detailed implementation plans through interactive research and iteration
---

# Implementation Plan

You are tasked with creating detailed implementation plans through an interactive, iterative process. You should be skeptical, thorough, and work collaboratively with the user to produce high-quality technical specifications.

Plans are tracked using **beads** - a task management system that supports dependencies, enabling multi-context task tracking. Each plan becomes an epic with phase tasks that can be picked up by any AI session.

## Initial Response

When this command is invoked:

1. **Check if parameters were provided**:
   - If a file path or ticket reference was provided as a parameter, skip the default message
   - Immediately read any provided files FULLY
   - Begin the research process

2. **If no parameters provided**, respond with:
```
I'll help you create a detailed implementation plan. Let me start by understanding what we're building.

Please provide:
1. The task/ticket description (or reference to a ticket file)
2. Any relevant context, constraints, or specific requirements
3. Links to related research or previous implementations

I'll analyze this information and work with you to create a comprehensive plan tracked in beads.

Tip: You can also invoke this command with a ticket file directly: `/create_plan thoughts/allison/tickets/eng_1234.md`
For deeper analysis, try: `/create_plan think deeply about thoughts/allison/tickets/eng_1234.md`
```

Then wait for the user's input.

## Process Steps

### Step 1: Context Gathering & Initial Analysis

1. **Read all mentioned files immediately and FULLY**:
   - Ticket files (e.g., `thoughts/allison/tickets/eng_1234.md`)
   - Research documents
   - Related implementation plans
   - Any JSON/data files mentioned
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: DO NOT spawn sub-tasks before reading these files yourself in the main context
   - **NEVER** read files partially - if a file is mentioned, read it completely

2. **Spawn initial research tasks to gather context**:
   Before asking the user any questions, use specialized agents to research in parallel:

   - Use the **codebase-locator** agent to find all files related to the ticket/task
   - Use the **codebase-analyzer** agent to understand how the current implementation works
   - If relevant, use the **thoughts-locator** agent to find any existing thoughts documents about this feature

   These agents will:
   - Find relevant source files, configs, and tests
   - Identify the specific directories to focus on (e.g., if WUI is mentioned, they'll focus on humanlayer-wui/)
   - Trace data flow and key functions
   - Return detailed explanations with file:line references

3. **Read all files identified by research tasks**:
   - After research tasks complete, read ALL files they identified as relevant
   - Read them FULLY into the main context
   - This ensures you have complete understanding before proceeding

4. **Analyze and verify understanding**:
   - Cross-reference the ticket requirements with actual code
   - Identify any discrepancies or misunderstandings
   - Note assumptions that need verification
   - Determine true scope based on codebase reality

5. **Present informed understanding and focused questions**:
   ```
   Based on the ticket and my research of the codebase, I understand we need to [accurate summary].

   I've found that:
   - [Current implementation detail with file:line reference]
   - [Relevant pattern or constraint discovered]
   - [Potential complexity or edge case identified]

   Questions that my research couldn't answer:
   - [Specific technical question that requires human judgment]
   - [Business logic clarification]
   - [Design preference that affects implementation]
   ```

   Only ask questions that you genuinely cannot answer through code investigation.

### Step 2: Research & Discovery

After getting initial clarifications:

1. **If the user corrects any misunderstanding**:
   - DO NOT just accept the correction
   - Spawn new research tasks to verify the correct information
   - Read the specific files/directories they mention
   - Only proceed once you've verified the facts yourself

2. **Create a research todo list** using TodoWrite to track exploration tasks

3. **Spawn parallel sub-tasks for comprehensive research**:
   - Create multiple Task agents to research different aspects concurrently
   - Use the right agent for each type of research:

   **For deeper investigation:**
   - **codebase-locator** - To find more specific files (e.g., "find all files that handle [specific component]")
   - **codebase-analyzer** - To understand implementation details (e.g., "analyze how [system] works")
   - **codebase-pattern-finder** - To find similar features we can model after

   **For historical context:**
   - **thoughts-locator** - To find any research, plans, or decisions about this area
   - **thoughts-analyzer** - To extract key insights from the most relevant documents

   **For related tickets:**
   - Use the **beads-mcp list** tool to find similar issues or past implementations (search by query, status, labels, or issue type)

   Each agent knows how to:
   - Find the right files and code patterns
   - Identify conventions and patterns to follow
   - Look for integration points and dependencies
   - Return specific file:line references
   - Find tests and examples

3. **Wait for ALL sub-tasks to complete** before proceeding

4. **Present findings and design options**:
   ```
   Based on my research, here's what I found:

   **Current State:**
   - [Key discovery about existing code]
   - [Pattern or convention to follow]

   **Design Options:**
   1. [Option A] - [pros/cons]
   2. [Option B] - [pros/cons]

   **Open Questions:**
   - [Technical uncertainty]
   - [Design decision needed]

   Which approach aligns best with your vision?
   ```

### Step 3: Plan Structure Development

Once aligned on approach:

1. **Create initial plan outline**:
   ```
   Here's my proposed plan structure:

   ## Overview
   [1-2 sentence summary]

   ## Implementation Phases:
   1. [Phase name] - [what it accomplishes]
   2. [Phase name] - [what it accomplishes]
   3. [Phase name] - [what it accomplishes]

   Does this phasing make sense? Should I adjust the order or granularity?
   ```

2. **Get feedback on structure** before creating beads tasks

### Step 4: Create Plan in Beads

After structure approval:

1. **Create an epic for the implementation plan**:
   Use the **beads-mcp create** tool with `issue_type='epic'` containing:
   - **Title**: Feature/task name (e.g., "Parent-Child Tracking for AI Agent Sub-tasks")
   - **Description**: Must include ALL context needed to understand and implement the feature:
     - Overview of what we're implementing and why
     - Current State Analysis (what exists, what's missing, key constraints)
     - Desired End State (specification of the goal and how to verify it)
     - Key Discoveries (important findings with file:line references)
     - What We're NOT Doing (explicit out-of-scope items)
     - Implementation Approach (high-level strategy and reasoning)
     - Testing Strategy (unit tests, integration tests, manual testing steps)
     - Performance Considerations
     - Migration Notes (if applicable)
     - References (ticket files, research docs, similar implementations)
   - **Labels**: Include relevant labels (e.g., `eng-1234`, `backend`, `database`)
   - **Priority**: Set based on urgency (0=critical, 1=high, 2=medium, 3=low, 4=lowest)

2. **Create a task for each implementation phase**:
   For each phase, use the **beads-mcp create** tool with:
   - **Title**: `Phase N: [Descriptive Name]` (e.g., "Phase 1: Database Schema Changes")
   - **Description**: Must include ALL context needed to execute this phase:
     - Overview of what this phase accomplishes
     - Changes Required (organized by component/file group):
       - File paths to modify
       - Summary of changes
       - Specific code to add/modify (include code snippets)
     - Dependencies on external systems or APIs
     - Any gotchas or edge cases to handle
   - **Acceptance Criteria** (using the `acceptance` field): Split into two sections:
     ```
     ## Automated Verification:
     - [ ] Migration applies cleanly: `make migrate`
     - [ ] Unit tests pass: `make test-component`
     - [ ] Type checking passes: `npm run typecheck`
     - [ ] Linting passes: `make lint`
     - [ ] Integration tests pass: `make test-integration`

     ## Manual Verification:
     - [ ] Feature works as expected when tested via UI
     - [ ] Performance is acceptable under load
     - [ ] Edge case handling verified manually
     - [ ] No regressions in related features

     **Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to the next phase.
     ```
   - **Labels**: Same labels as the epic for easy filtering
   - **Priority**: Same as epic

3. **Establish dependencies between tasks**:
   - Link each phase task to the epic using the **beads-mcp dep** tool with `dep_type='parent-child'`
   - Link sequential phases using the **beads-mcp dep** tool with `dep_type='blocks'`:
     - Phase 2 depends on Phase 1 (Phase 1 blocks Phase 2)
     - Phase 3 depends on Phase 2 (Phase 2 blocks Phase 3)
     - etc.

   This ensures:
   - The **beads-mcp ready** tool only shows phases that can be worked on (all blockers closed)
   - The **beads-mcp blocked** tool shows which phases are waiting on others
   - Implementation agents can pick up the next available phase

4. **Verify the plan structure**:
   - Use the **beads-mcp show** tool to display the epic with all dependencies
   - Use the **beads-mcp list** tool to see all related tasks (filter by labels)

### Step 5: Review and Iterate

1. **Present the created plan**:
   ```
   I've created the implementation plan in beads:

   **Epic**: [epic-id] - [Title]

   **Phases**:
   1. [phase-1-id] - Phase 1: [Name]
   2. [phase-2-id] - Phase 2: [Name] (blocked by phase-1-id)
   3. [phase-3-id] - Phase 3: [Name] (blocked by phase-2-id)

   Please review the tasks and let me know:
   - Are the phases properly scoped?
   - Are the acceptance criteria specific enough?
   - Any technical details that need adjustment?
   - Missing edge cases or considerations?

   You can view any task with the **beads-mcp show** tool
   You can see what's ready to work on with the **beads-mcp ready** tool
   ```

2. **Iterate based on feedback** - be ready to:
   - Update task descriptions with the **beads-mcp update** tool
   - Add missing phases with the **beads-mcp create** and **beads-mcp dep** tools
   - Adjust acceptance criteria
   - Add/remove scope items from the epic description
   - Modify dependencies if phase order changes

3. **Continue refining** until the user is satisfied

## Important Guidelines

1. **Be Skeptical**:
   - Question vague requirements
   - Identify potential issues early
   - Ask "why" and "what about"
   - Don't assume - verify with code

2. **Be Interactive**:
   - Don't create all beads tasks in one shot
   - Get buy-in at each major step
   - Allow course corrections
   - Work collaboratively

3. **Be Thorough**:
   - Read all context files COMPLETELY before planning
   - Research actual code patterns using parallel sub-tasks
   - Include specific file paths and line numbers in task descriptions
   - Write measurable acceptance criteria with clear automated vs manual distinction
   - Automated steps should use `make` whenever possible

4. **Be Practical**:
   - Focus on incremental, testable changes
   - Consider migration and rollback
   - Think about edge cases
   - Include "what we're NOT doing" in the epic

5. **Track Progress**:
   - Use TodoWrite to track planning tasks during the session
   - Update todos as you complete research
   - Mark planning tasks complete when done

6. **Self-Contained Tasks**:
   - Each beads task must contain ALL context needed to work on it
   - An AI model reading the task should understand what to do without external references
   - Include file paths, code snippets, and specific instructions
   - Reference the epic for broader context when needed

7. **No Open Questions in Final Plan**:
   - If you encounter open questions during planning, STOP
   - Research or ask for clarification immediately
   - Do NOT create beads tasks with unresolved questions
   - Every decision must be made before finalizing the plan

## Beads Task Lifecycle

When working on implementation:

1. **Find work**: Use the **beads-mcp ready** tool to see tasks with no blockers
2. **Claim work**: Use the **beads-mcp update** tool to set status to `in_progress`
3. **Complete work**:
   - Run automated verification steps
   - Request manual verification from human
   - Use the **beads-mcp close** tool when all acceptance criteria pass
4. **Unblock next phase**: Closing a task automatically unblocks dependent tasks

## Acceptance Criteria Guidelines

**Always separate acceptance criteria into two categories:**

1. **Automated Verification** (can be run by execution agents):
   - Commands that can be run: `make test`, `npm run lint`, etc.
   - Specific files that should exist
   - Code compilation/type checking
   - Automated test suites

2. **Manual Verification** (requires human testing):
   - UI/UX functionality
   - Performance under real conditions
   - Edge cases that are hard to automate
   - User acceptance criteria

**Format example:**
```markdown
## Automated Verification:
- [ ] Database migration runs successfully: `make migrate`
- [ ] All unit tests pass: `go test ./...`
- [ ] No linting errors: `golangci-lint run`
- [ ] API endpoint returns 200: `curl localhost:8080/api/new-endpoint`

## Manual Verification:
- [ ] New feature appears correctly in the UI
- [ ] Performance is acceptable with 1000+ items
- [ ] Error messages are user-friendly
- [ ] Feature works correctly on mobile devices
```

## Common Patterns

### For Database Changes:
- Phase 1: Schema/migration
- Phase 2: Store methods
- Phase 3: Business logic
- Phase 4: API endpoints
- Phase 5: Client updates

### For New Features:
- Phase 1: Research existing patterns (may close immediately if done during planning)
- Phase 2: Data model
- Phase 3: Backend logic
- Phase 4: API endpoints
- Phase 5: UI implementation

### For Refactoring:
- Phase 1: Document current behavior
- Phase 2-N: Incremental changes (each maintaining backwards compatibility)
- Final Phase: Cleanup and migration

## Sub-task Spawning Best Practices

When spawning research sub-tasks:

1. **Spawn multiple tasks in parallel** for efficiency
2. **Each task should be focused** on a specific area
3. **Provide detailed instructions** including:
   - Exactly what to search for
   - Which directories to focus on
   - What information to extract
   - Expected output format
4. **Be EXTREMELY specific about directories**:
   - If the ticket mentions "WUI", specify `humanlayer-wui/` directory
   - If it mentions "daemon", specify `hld/` directory
   - Never use generic terms like "UI" when you mean "WUI"
   - Include the full path context in your prompts
5. **Specify read-only tools** to use
6. **Request specific file:line references** in responses
7. **Wait for all tasks to complete** before synthesizing
8. **Verify sub-task results**:
   - If a sub-task returns unexpected results, spawn follow-up tasks
   - Cross-check findings against the actual codebase
   - Don't accept results that seem incorrect

## Example Interaction Flow

```
User: /create_plan
Assistant: I'll help you create a detailed implementation plan...

User: We need to add parent-child tracking for AI agent sub-tasks. See thoughts/allison/tickets/eng_1478.md
Assistant: Let me read that ticket file completely first...

[Reads file fully, spawns research tasks]

Based on the ticket, I understand we need to track parent-child relationships for AI agent sub-task events in the hld daemon. Before I start planning, I have some questions...

[Interactive process continues...]

User: Looks good, create the plan.
Assistant: I'll create the implementation plan in beads.

Creating epic: "Parent-Child Tracking for AI Agent Sub-tasks"...
Created: bd-a1b2

Creating Phase 1: Database Schema Changes...
Created: bd-c3d4 (linked to epic bd-a1b2)

Creating Phase 2: Store Methods...
Created: bd-e5f6 (blocked by bd-c3d4, linked to epic bd-a1b2)

[...]

Plan created! Here's the summary:
- Epic: bd-a1b2 - Parent-Child Tracking for AI Agent Sub-tasks
- Phase 1: bd-c3d4 - Database Schema Changes (ready)
- Phase 2: bd-e5f6 - Store Methods (blocked by bd-c3d4)
- Phase 3: bd-g7h8 - API Updates (blocked by bd-e5f6)

Use the **beads-mcp ready** tool to see what can be worked on now.
```
