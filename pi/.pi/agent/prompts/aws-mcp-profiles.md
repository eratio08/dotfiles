---
description: Build AWS MCP multi-profile export from friendly account or environment names.
argument-hint: "<account-or-environment> [name ...]"
---
Use the friendly account or environment names supplied by the user: $@.
Read `~/.aws/config` before answering.
Resolve each name to a profile by inspecting profile names, SSO role names, and environment or service naming.
Treat names as approximate, case-insensitive, and tolerant of separators and common abbreviations.
Use account IDs only as internal metadata for disambiguation and do not ask the user to provide them.
Prefer the profile whose name and role match the requested environment and whose role is suitable for MCP operations, such as an Operations or read-only role.
Preserve the requested order and include each resolved profile only once.
Do not invent profile names or select profiles unrelated to the requested account or environment names.
If no profile matches a name, report the name and ask for clarification.
If multiple profiles are plausible, list their differences and ask which one to use before generating the command.
Generate this command with the confirmed profile names:

```bash
export AWS_MCP_PROXY_PROFILES="<profile-1> <profile-2>"
```

Explain that the first profile becomes the MCP default and that the MCP client must be restarted after exporting.
Do not expose credentials or modify `~/.aws/config`.
