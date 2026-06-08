import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface LoadedSkill {
  name: string;
  path: string;
  content: string;
}

export class SkillLoader {
  constructor(private readonly skillsDir: string) {}

  async load(name: string): Promise<LoadedSkill> {
    const skillPath = resolve(this.skillsDir, name, "SKILL.md");
    await access(skillPath);
    return {
      name,
      path: skillPath,
      content: await readFile(skillPath, "utf8")
    };
  }

  async list(): Promise<string[]> {
    const entries = await readdir(this.skillsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  }
}

export function defaultSkillsDir(cwd: string): string {
  return join(cwd, "skills");
}
