---
name: repo-debugging
description: Debug a local repository with controlled repo tools and deterministic test verification.
---

# Repo Debugging

Use this skill when the user asks the loop to diagnose and fix failing tests in a local repository.

## Procedure

1. Reproduce the failure with `repo.run_tests` before changing code.
2. Inspect the smallest relevant files with `repo.read_file` or `repo.search_code`.
3. Propose one focused patch through `repo.apply_patch`.
4. Require approval before any file mutation.
5. Run the configured test command again after every patch.
6. Stop only when the latest test run passes or the loop budget is exhausted.

## Output Discipline

Return one JSON decision per turn. Do not claim tests passed unless a `repo.run_tests` result confirms it.

## Completion Criteria

- The configured test command passes.
- The final answer names what changed and how it was verified.
