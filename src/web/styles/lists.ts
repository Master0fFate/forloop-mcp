export const listsCss = `
.memory-list,
.deploy-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.memory-item,
.deploy-list div {
  display: grid;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: #070707;
}

.memory-item p {
  margin: 0;
  overflow-wrap: anywhere;
  line-height: 1.45;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 7px;
  color: var(--muted);
  font-size: 11px;
}
`;
