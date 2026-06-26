export const responsiveCss = `
@media (max-width: 880px) {
  .app-shell { grid-template-columns: 1fr; }

  .rail {
    position: static;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border-soft);
  }

  .nav-list {
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    overflow-x: auto;
  }

  .workspace { padding: 18px; }
  .topbar { flex-direction: column; }

  .metric-grid,
  .grid.two,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .span-2 { grid-column: auto; }
}
`;
