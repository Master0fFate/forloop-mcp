export interface RepoMcpServerOptions {
  allowMutations?: boolean;
  allowShell?: boolean;
  allowArbitraryShell?: boolean;
  allowShellMode?: boolean;
  shellAllowedCommands?: string[];
  allowedTools?: string[];
  sessionId?: string;
}
