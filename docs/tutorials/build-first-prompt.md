# Tutorial: Build Your First Prompt

Claude Code already follows whatever instructions you type. Claude Prompts adds
prompts you define once, run by name, and change with a preview and a version
history. In this tutorial you ask Claude Code to write a prompt, run it, change
it, and then read the files the server saved.

Every step is a message you type into Claude Code. Claude calls the Claude
Prompts tools and the server answers Claude, so you never call a tool yourself.

## Before you start

You need:

- Claude Code in the terminal, where the `/plugin` command is available
- Node.js 22.13.0 or later, which the plugin uses to start its server
- Python 3.10 or later, which runs the plugin's hooks, including the one that
  reads your `>>` lines

Check both versions in a terminal:

```bash
node --version
python3 --version
```

If Node.js prints a version lower than `v22.13.0`, or Python one lower than
`3.10`, upgrade it before you go on. The hooks look for `python3`, then
`python` (on Windows, `py -3` first), so if `python3` is not found, check
`python --version` instead.

## 1. Install the plugin

In Claude Code, send these two commands, one at a time:

```text
/plugin marketplace add minipuft/minipuft-plugins
```

```text
/plugin install claude-prompts@minipuft
```

If the install summary tells you to run `/reload-plugins`, run it.

The plugin adds the Claude Prompts server and a hook. The hook reads each
message you send, and when the message holds a `>>` command, it tells Claude
which tool call to make.

## 2. Ask Claude to write a prompt

Send this message:

```text
>>create_prompt purpose:'A prompt named release_note that turns a code change, given as an argument named change, into one release-note bullet'
```

`create_prompt` comes with the server. The hook turns your line into a
`prompt_engine` call, and the server answers with an authoring workflow that
Claude follows:

1. Claude drafts the prompt: an id, a description, a template, and its
   arguments.
2. Claude calls the `resource_manager` tool with `action:"validate"`. The
   server checks the draft and writes nothing.
3. Claude shows you the draft and asks you to confirm it.
4. Once you confirm, Claude sends the same draft with `action:"create"`, and
   the server writes the prompt.

If Claude proposes an id other than `release_note`, or an argument name other
than `change`, ask it to use those names so the rest of this tutorial matches
what you see.

You can also ask in plain words, such as "Write me a prompt called release_note
that turns a code change into one release-note bullet." The `resource_manager`
tool describes the same validate-then-create steps to Claude.

### Where your prompt is saved

The server answers `create` with a write receipt. It names the directory the
server writes prompts to and every file it wrote. Shortened, it reads:

```text
Write Receipt
- Resource root: <plugin data>/resources/prompts
- Refresh: loaded
- Current version: 1
- Affected files:
- <plugin data>/resources/prompts/general/release_note
- <plugin data>/resources/prompts/general/release_note/prompt.yaml
- <plugin data>/resources/prompts/general/release_note/user-message.md
```

`<plugin data>` stands for the folder Claude Code keeps for the plugin's data.
For the plugin you installed in step 1, that folder is
`~/.claude/plugins/data/claude-prompts-minipuft`.

The server files each prompt under a folder for its category, then a folder for
its id. You did not name a category, so the server used `general` and created
that folder on this first write.

Your prompt survives a plugin update. Each update replaces the folder Claude
Code installed the plugin into, but not its data folder, which holds your
prompts and their version history. The prompts that come with the server, such
as `create_prompt`, still load from the install folder, alongside yours.

To ask the server where a prompt lives, send:

```text
Inspect the release_note prompt and tell me its resource_root, source_root and edit_copies_on_write.
```

Claude calls `resource_manager` with `action:"inspect"`. The reply carries these
fields:

| Field                  | What it tells you                                                                |
| ---------------------- | -------------------------------------------------------------------------------- |
| `resource_root`        | The directory the server writes new and changed prompts to                       |
| `source_root`          | The directory this prompt was loaded from                                        |
| `edit_copies_on_write` | `true` when the two differ; a change then copies the prompt into `resource_root` |

For `release_note`, `resource_root` and `source_root` are both
`<plugin data>/resources/prompts`, so `edit_copies_on_write` is `false`. The
reply also carries `server_root`, the server's directory inside the install
folder, which changes when the plugin updates.

## 3. Run your prompt

<!-- illustrative-prompts: release_note -->

Send:

```text
>>release_note change:'Search results now load in pages of 50'
```

The hook turns the line into an instruction to call `prompt_engine` with that
command. Claude makes the call, and the server renders your template with
`change` filled in. The wording comes from the draft you confirmed, and the
rendered section looks like this:

```text
## Task Context

Write one release-note bullet for this change, in words a user of the software would recognize:

Search results now load in pages of 50
```

Around that section, the server can add guidance from its active reasoning
framework and a set of review criteria called gates. Claude writes the bullet,
reviews it against the gates, and sends its verdict back to the server.

If you mistype the id, the hook replies with the closest matching prompt ids
and does not ask Claude to call a tool.

## 4. Change your prompt

<!-- illustrative-prompts: release_note -->

Send:

```text
Update release_note so the bullet is at most 20 words. Show me a preview first.
```

Claude calls `resource_manager` with `action:"preview"` and
`preview_action:"update"`. The server returns the diff the update would make,
writes nothing, and records no version. Claude shows you the change. Once you
approve it, Claude sends the same change with `action:"update"`. The server
writes it, saves a new version in the prompt's history, and reloads the prompt
before it replies.

Run the prompt again:

```text
>>release_note change:'Search results now load in pages of 50'
```

The Task Context now carries the change you approved. You restarted nothing:
the server reloads prompts while it runs.

## 5. Read what the server wrote

Steps 2 to 4 maintained the prompt through Claude and `resource_manager`, and
that is how you keep changing it: each change can be previewed first and is
saved as a version. This section is for reading. It shows the files those steps
produced, the other file layout the server loads, and the call Claude made for
you.

### One folder per prompt

`create` wrote a folder with two files:

```text
<plugin data>/resources/prompts/general/release_note/
├── prompt.yaml
└── user-message.md
```

`prompt.yaml` holds the prompt's settings and names the template file:

```yaml
id: release_note
name: Release Note
description: Turns a code change into one release-note bullet
category: general
userMessageTemplateFile: user-message.md
arguments:
  - name: change
    type: string
    description: The change to describe
    required: true
```

`user-message.md` holds the template. `{{change}}` marks where the argument's
value goes:

```markdown
Write one release-note bullet of at most 20 words for this change, in words a user of the software would recognize:

{{change}}
```

### One file per prompt

The server also loads a prompt kept in a single file named after its id, with
the template inline. Here is the same prompt as one file,
`<plugin data>/resources/prompts/general/release_note.yaml`:

```yaml
id: release_note
name: Release Note
description: Turns a code change into one release-note bullet
userMessageTemplate: |
  Write one release-note bullet of at most 20 words for this change, in words a user of the software would recognize:

  {{change}}
arguments:
  - name: change
    type: string
    required: true
```

Prompts in either layout load from `<plugin data>/resources/prompts`.
Edits to these files also reload while the server runs, typically within a few
seconds, but they skip the preview, so keep making changes through Claude.

### The call Claude made

These are the arguments Claude sent with `action:"create"` in step 2, shown so
you can match them to the files above. You do not type them:

```json
{
  "resource_type": "prompt",
  "action": "create",
  "id": "release_note",
  "name": "Release Note",
  "description": "Turns a code change into one release-note bullet",
  "user_message_template": "Write one release-note bullet for this change, in words a user of the software would recognize:\n\n{{change}}",
  "arguments": [
    {
      "name": "change",
      "type": "string",
      "required": true,
      "description": "The change to describe"
    }
  ]
}
```

The server wrote `user_message_template` to `user-message.md` and the other
prompt fields to `prompt.yaml`.

## Next: write a gate

The review criteria in step 3's reply were gates. To add criteria of your own to
a run, or check a result with a shell command, read the
[Gates Guide](../guides/gates.md).
