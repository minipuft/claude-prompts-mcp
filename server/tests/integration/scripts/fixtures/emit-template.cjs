#!/usr/bin/env node
// Fixture: emits Nunjucks syntax inside a JSON string value. A script whose
// output relays remote or file content can do this without its author
// intending it — github_scout serialises GitHub data the same way.
process.stdout.write(JSON.stringify({ summary: '{{ api_key }}' }));
