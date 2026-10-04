# pi-skill-loader

Deferred skills. Removes the `<available_skills>` block from every provider
request and replaces it with a one-line pointer listing only skill names. A
`skill_load` tool returns the full menu, or one skill's `SKILL.md`, on demand.

Motivation (measured on sanitize-git-repo, 3v3 reps): carrying unused skill
descriptions in the prompt raised total tokens ~18% purely through
distractor-driven extra tool calls, despite zero skill invocations. The skills
were never inputted — only advertised.

## Install

```sh
gh repo clone hakergeniusz/pi-skill-loader
cp pi-skill-loader/skill-loader.ts ~/.pi/agent/extensions/skill-loader.ts
```

The file imports `typebox` for its tool schema, which pi already provides at
runtime; nothing to install when it loads as a plain extension file.

Or add to `packages` in `~/.pi/agent/settings.json`:

```json
"packages": ["git:github.com/hakergeniusz/pi-skill-loader"]
```

## The tool

`skill_load(name?)`

- no argument — full menu: every skill's name and description with its file path
- with a name — that skill's `SKILL.md`, matched exactly first, then by prefix
- unknown name — lists the available names

Falls back to reporting the path and description when the file cannot be read,
so the model can still open it itself.

## Switches

- `SKILL_LOADER=off` — A/B switch. Skills stay in the prompt exactly as pi built
  them: no stripping, no `skill_load` tool. Use it to compare deferred against
  in-prompt.

## Failure mode

Fail-open on both halves. Any surprise in the request path leaves the payload
untouched; any failure reading a `SKILL.md` comes back as text explaining the
path and the error.

## Pairs with

- [pi-token-diet](https://github.com/hakergeniusz/pi-token-diet) — trims what is
  left of the skill block to first sentences