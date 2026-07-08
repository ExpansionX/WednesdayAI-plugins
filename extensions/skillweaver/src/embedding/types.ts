export interface EmbeddingBackend {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
  embedSingle(text: string): Promise<Float32Array>;
  dispose(): void | Promise<void>;
}

export interface SkillEntry {
  name: string;
  description: string;
  location: string;
  source: string;
  category?: string;
}

export interface IndexedSkill extends SkillEntry {
  vector: Float32Array;
}

export interface SearchResult {
  name: string;
  description: string;
  location: string;
  source: string;
  score: number;
}

export interface DecompositionResult {
  subTasks: string[];
  pass: 1 | 2;
}

export interface HintEntry {
  name: string;
  description: string;
}
