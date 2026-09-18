import { prisma, withTenantTx } from '@seredina/db';
import { TOOL_CATALOG } from './catalog';

export interface AutonomyPolicySettings {
  autoExecuteTools: string[];
  maxActionsPerDay: number;
}

// "No row = default" (same shape as escalation tiers, custom-field sort order):
// a tenant that never configured this gets the safest possible policy, not an
// error and not an accidental "everything auto-executes."
const DEFAULT_POLICY: AutonomyPolicySettings = { autoExecuteTools: [], maxActionsPerDay: 20 };

export async function getAutonomyPolicy(tenantId: string): Promise<AutonomyPolicySettings> {
  return withTenantTx(prisma, tenantId, async (tx) => {
    const row = await tx.autonomyPolicy.findUnique({ where: { tenantId } });
    if (!row) return DEFAULT_POLICY;
    return { autoExecuteTools: row.autoExecuteTools, maxActionsPerDay: row.maxActionsPerDay };
  });
}

export interface UpdateAutonomyPolicyInput {
  autoExecuteTools?: string[];
  maxActionsPerDay?: number;
}

const VALID_TOOL_NAMES = new Set(TOOL_CATALOG.filter((t) => t.mutating).map((t) => t.name));

export async function updateAutonomyPolicy(tenantId: string, input: UpdateAutonomyPolicyInput): Promise<AutonomyPolicySettings> {
  if (input.autoExecuteTools) {
    // Only mutating tools are ever gated (see executor.ts) -- listing a
    // read-only tool like get_ticket here would be meaningless, so it's
    // rejected up front rather than silently accepted and ignored.
    const unknown = input.autoExecuteTools.filter((name) => !VALID_TOOL_NAMES.has(name));
    if (unknown.length > 0) {
      throw new Error(`unknown or non-mutating tool name(s): ${unknown.join(', ')}`);
    }
  }

  const row = await withTenantTx(prisma, tenantId, (tx) =>
    tx.autonomyPolicy.upsert({
      where: { tenantId },
      create: {
        tenantId,
        autoExecuteTools: input.autoExecuteTools ?? [],
        maxActionsPerDay: input.maxActionsPerDay ?? DEFAULT_POLICY.maxActionsPerDay,
      },
      update: {
        autoExecuteTools: input.autoExecuteTools,
        maxActionsPerDay: input.maxActionsPerDay,
      },
    }),
  );
  return { autoExecuteTools: row.autoExecuteTools, maxActionsPerDay: row.maxActionsPerDay };
}
