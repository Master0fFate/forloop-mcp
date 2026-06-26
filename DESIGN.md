# Design System

ForLoop's web console is a dark, local-first operations surface inspired by Vercel and shadcn/ui.

## Principles

- Dense, scan-friendly workspace UI before marketing copy.
- Dark neutral base with restrained accents and clear borders.
- Small radius panels and controls, consistent with shadcn defaults.
- Content-led sections: runtime status, provider config, session memory, governed shell, deployment.
- Responsive layout that keeps form labels, buttons, and record text inside their containers.

## Tokens

- Background: `#050505`
- Panel: `#0a0a0a`
- Elevated panel: `#111111`
- Border: `#262626`
- Text: `#fafafa`
- Muted text: `#a3a3a3`
- Focus: `#8ab4ff`
- Good: `#3ddc97`
- Warning: `#f5c451`
- Bad: `#ff6b6b`

## Component Rules

- Radius stays at 8px or below except status pills.
- Page sections are not nested cards; panels represent concrete tools.
- Forms use labels, native controls, and visible focus states.
- The first viewport is the working console, not a landing page.
