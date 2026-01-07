---
description: Implement technical plans tracked in beads with verification
---

# Implement Plan

You are tasked with implementing an approved technical plan tracked in beads. Plans are organized as epics with phase tasks containing specific changes and acceptance criteria.

## Getting Started

When given a task ID or asked to work on a plan:

1. **Find work to do**:
   - Use the **beads-mcp ready** tool to find tasks with no blockers
   - Or use the **beads-mcp show** tool if given a specific task ID
   - Use the **beads-mcp list** tool to see all tasks for a feature (filter by labels or status)

2. **Understand the context**:
   - Read the phase task description fully - it contains all implementation details
   - If the task has a parent epic, use **beads-mcp show** to read the epic for broader context
   - Read all files mentioned in the task description
   - **Read files fully** - never use limit/offset parameters, you need complete context

3. **Claim and track the work**:
   - Use the **beads-mcp update** tool to set status to `in_progress`
   - Create a todo list to track your progress within the phase
   - Start implementing if you understand what needs to be done

If no task ID provided and no ready tasks found, ask for guidance.

## Implementation Philosophy

Plans are carefully designed, but reality can be messy. Your job is to:
- Follow the task's intent while adapting to what you find
- Implement each phase fully before moving to the next
- Verify your work makes sense in the broader codebase context
- Use the **beads-mcp update** tool with `notes` to record progress or issues

When things don't match the task description exactly, think about why and communicate clearly. The task is your guide, but your judgment matters too.

If you encounter a mismatch:
- STOP and think deeply about why the task can't be followed as described
- Present the issue clearly:
  ```
  Issue in [task-id]:
  Expected: [what the task description says]
  Found: [actual situation]
  Why this matters: [explanation]

  How should I proceed?
  ```

## Verification Approach

After implementing a phase:

1. **Run automated verification**:
   - Execute the automated verification steps from the task's acceptance criteria
   - Usually `make check test` covers most automated checks
   - Fix any issues before proceeding

2. **Update progress**:
   - Use the **beads-mcp update** tool with `notes` to record what was completed
   - Update your local todo list

3. **Pause for human verification**:
   After completing all automated verification, pause and inform the human:
   ```
   [task-id] Phase Complete - Ready for Manual Verification

   Automated verification passed:
   - [List automated checks that passed]

   Please perform the manual verification steps from the acceptance criteria:
   - [List manual verification items from the task]

   Let me know when manual testing is complete so I can close this task and proceed.
   ```

4. **Complete the task**:
   - Once manual verification is confirmed, use the **beads-mcp close** tool
   - This automatically unblocks any tasks that depend on this one
   - Use the **beads-mcp ready** tool to find the next task to work on

If instructed to execute multiple phases consecutively, skip the pause until the last phase. Otherwise, assume you are doing one phase at a time.

Do not close tasks until manual verification is confirmed by the user.

## Beads Task Lifecycle

When working on implementation:

1. **Find work**: Use the **beads-mcp ready** tool to see tasks with no blockers
2. **Claim work**: Use the **beads-mcp update** tool to set status to `in_progress`
3. **Implement**: Follow the task description and make the required changes
4. **Verify**: Run automated checks from acceptance criteria
5. **Request review**: Pause for human manual verification
6. **Complete**: Use the **beads-mcp close** tool when all acceptance criteria pass
7. **Continue**: Closing unblocks dependent tasks; use **beads-mcp ready** to find the next one

## If You Get Stuck

When something isn't working as expected:
- First, make sure you've read and understood all the relevant code
- Consider if the codebase has evolved since the task was created
- Use the **beads-mcp update** tool to add notes about what you've tried
- Present the issue clearly and ask for guidance

Use sub-tasks sparingly - mainly for targeted debugging or exploring unfamiliar territory.

## Resuming Work

To resume work on an existing plan:

1. **Check for in-progress work**:
   - Use the **beads-mcp list** tool with `status='in_progress'` to find tasks that were started
   - If found, use **beads-mcp show** to read the task and any notes from previous sessions

2. **Find the next task**:
   - Use the **beads-mcp ready** tool to find tasks with no blockers
   - Use the **beads-mcp blocked** tool to see what's waiting on other work

3. **Trust completed work**:
   - Closed tasks are considered done
   - Verify previous work only if something seems off

Remember: You're implementing a solution, not just checking boxes. Keep the end goal in mind and maintain forward momentum.
