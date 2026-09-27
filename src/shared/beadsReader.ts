import { EnrichedCard, FullCard, validateIssueId } from './issueTypes';
import { mapBdListIssuesToEnrichedCards, mapBdShowIssueToFullCard } from './issueMapping';

export type BeadsReadExecutor = (args: string[]) => Promise<unknown>;

export interface BeadsReaderOptions {
  strict?: boolean;
  onNonArrayList?: () => void;
}

function validateEnvelope(value: unknown, command: string): asserts value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(issue =>
    issue === null || typeof issue !== 'object' || Array.isArray(issue) ||
    typeof issue.id !== 'string' || issue.id.length === 0
  )) {
    throw new Error(`Invalid bd ${command} response: expected an array of issue objects with non-empty string ids`);
  }
}

export class BeadsReader {
  constructor(private readonly execute: BeadsReadExecutor, private readonly options: BeadsReaderOptions = {}) {}

  async getBoardMinimal(limit: number = 5000): Promise<EnrichedCard[]> {
    const issues = await this.execute(['list', '--json', '--all', '--limit', limit.toString()]);
    if (this.options.strict) { validateEnvelope(issues, 'list'); }
    if (!Array.isArray(issues)) {
      this.options.onNonArrayList?.();
      return [];
    }
    return mapBdListIssuesToEnrichedCards(issues);
  }

  async getIssueFull(issueId: string): Promise<FullCard> {
    validateIssueId(issueId);
    let result;
    try {
      result = await this.execute(['show', '--json', issueId]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('no issue found')) {
        throw new Error(`Issue not found: ${issueId}`);
      }
      throw error;
    }
    if (this.options.strict) { validateEnvelope(result, 'show'); }
    if (!Array.isArray(result) || result.length === 0) {
      throw new Error(`Issue not found: ${issueId}`);
    }
    return mapBdShowIssueToFullCard(result[0] as Record<string, unknown>, issueId);
  }
}
