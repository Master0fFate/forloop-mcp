export const layoutCss = `
.app-shell {
  display: grid;
  grid-template-columns: 248px 1fr;
  min-height: 100vh;
}

.rail {
  position: sticky;
  top: 0;
  height: 100vh;
  border-right: 1px solid var(--border-soft);
  background: #070707;
  padding: 22px 16px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 650;
}

.nav-list {
  display: grid;
  gap: 4px;
  margin-top: 28px;
}

.nav-list a {
  color: var(--muted);
  text-decoration: none;
  padding: 9px 10px;
  border-radius: 6px;
  font-size: 14px;
}

.nav-list a:hover,
.nav-list a:focus-visible {
  color: var(--text);
  background: var(--panel-2);
  outline: none;
}

.workspace {
  width: min(1180px, 100%);
  margin: 0 auto;
  padding: 28px;
  padding-bottom: max(28px, 60vh);
}

.topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 22px;
  border-bottom: 1px solid var(--border-soft);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 22px 0;
}

.grid {
  display: grid;
  gap: 14px;
  margin-bottom: 14px;
}

.grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.panel {
  padding: 18px;
  min-width: 0;
  scroll-margin-top: 20px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
`;
