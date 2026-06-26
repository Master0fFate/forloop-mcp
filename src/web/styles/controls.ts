export const controlsCss = `
.metric,
.panel {
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 8px;
}

.metric {
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 16px;
}

.status-strip,
.pill {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--muted);
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  white-space: nowrap;
}

.label,
label span,
.deploy-list span {
  color: var(--muted);
  font-size: 12px;
}

.metric strong,
.deploy-list strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 14px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

label {
  display: grid;
  gap: 7px;
  min-width: 0;
}

.span-2 { grid-column: 1 / -1; }

input,
select,
textarea,
button {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #050505;
  color: var(--text);
  font: inherit;
  font-size: 14px;
}

input,
select,
textarea {
  min-height: 38px;
  padding: 9px 10px;
}

textarea { resize: vertical; }

button {
  align-self: end;
  min-height: 38px;
  padding: 9px 12px;
  background: var(--text);
  color: #050505;
  font-weight: 650;
  cursor: pointer;
}

button:hover { background: #d4d4d4; }

button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.output {
  min-height: 92px;
  max-height: 220px;
  overflow: auto;
  margin: 14px 0 0;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: #050505;
  color: var(--muted);
  font-size: 12px;
  white-space: pre-wrap;
}
`;
