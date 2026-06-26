export const baseCss = `
:root {
  color-scheme: dark;
  --bg: #050505;
  --panel: #0a0a0a;
  --panel-2: #111111;
  --border: #262626;
  --border-soft: #1a1a1a;
  --text: #fafafa;
  --muted: #a3a3a3;
  --dim: #737373;
  --focus: #8ab4ff;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-width: 320px;
  background: var(--bg);
  color: var(--text);
  scroll-behavior: smooth;
}

h1,
h2 {
  margin: 0;
  letter-spacing: 0;
}

h1 { font-size: clamp(28px, 4vw, 44px); }
h2 { font-size: 18px; }

.eyebrow {
  margin: 0 0 6px;
  color: var(--dim);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}
`;
