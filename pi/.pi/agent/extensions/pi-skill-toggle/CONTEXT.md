# Pi Skill Toggle

This context defines the terms for skills managed by Pi Skill Toggle.

## Language

**Skill**:
A reusable set of instructions and supporting files that Pi loads for related work.

**Invocation mode**:
Whether Pi can select a loaded skill automatically or the user must invoke it directly.
_Avoid_: Enablement, availability, enabled, disabled

**Agent-invocable**:
An invocation mode that lets Pi select a loaded skill automatically.

**Manual-only**:
An invocation mode that requires an explicit `/skill:name` command but still loads the skill.
_Avoid_: Disabled

**Enablement**:
The user's choice to include or exclude a skill through Pi Skill Toggle.
_Avoid_: Invocation mode, availability

**Availability**:
Whether Pi loads a skill after applying all Pi filters and project trust.
_Avoid_: Enablement, invocation mode

**Skill source**:
The Pi scope that supplies a skill: user, global, project, or project-legacy.
