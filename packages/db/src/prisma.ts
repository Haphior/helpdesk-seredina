import { PrismaClient } from '@prisma/client';
import { requireTenantId } from './tenant-context';

/**
 * Second, independent defense layer on top of Postgres RLS (see prisma/rls/policies.sql
 * and tenant-context.ts). Every tenant-scoped model is mapped to the column that holds
 * its tenant scope -- `id` for Tenant itself (a tenant may only see its own registry
 * row), `tenantId` for everything else. On every query this extension:
 *   - requires a tenantId to be bound via withTenantTx()'s AsyncLocalStorage context,
 *     throwing rather than running unscoped if it's missing (fails closed);
 *   - injects/overrides the scope column on writes, so a bug in calling code can never
 *     plant a row under the wrong tenant even before RLS's WITH CHECK gets a chance to;
 *   - merges the scope column into `where` on reads/updates/deletes as a plain sibling
 *     field (Prisma implicitly ANDs top-level `where` keys), so a bug in calling code
 *     can never read past its own tenant even before RLS gets a chance to. This has to
 *     be a merge, not an `AND: [...]` wrapper -- `findUnique`'s extendedWhereUnique
 *     validation requires the unique selector at the top level of `where`, and nesting
 *     it inside an AND array fails that validation even though the query would have
 *     been logically equivalent.
 *
 * A cross-tenant leak now requires BOTH this extension AND the RLS policy to fail at
 * the same time -- see test/tenant-isolation.test.ts, which proves neither layer is a
 * silently-redundant no-op by disabling each one independently.
 */
const TENANT_SCOPE_FIELD: Record<string, string> = {
  Tenant: 'id',
  Role: 'tenantId',
  RolePermission: 'tenantId',
  User: 'tenantId',
  Team: 'tenantId',
  Contact: 'tenantId',
  TicketStatus: 'tenantId',
  Ticket: 'tenantId',
  Message: 'tenantId',
  ApiKey: 'tenantId',
  Asset: 'tenantId',
  TicketAsset: 'tenantId',
  DiscoveryJob: 'tenantId',
  EmailChannel: 'tenantId',
  CustomFieldDefinition: 'tenantId',
  Manufacturer: 'tenantId',
  AssetModel: 'tenantId',
  ProcessTemplate: 'tenantId',
  ProcessStepTemplate: 'tenantId',
  ProcessInstance: 'tenantId',
  ProcessStepInstance: 'tenantId',
  Webhook: 'tenantId',
  Macro: 'tenantId',
  SlaPolicy: 'tenantId',
  BusinessHours: 'tenantId',
  DashboardWidget: 'tenantId',
  Problem: 'tenantId',
  ServiceCatalogItem: 'tenantId',
  Service: 'tenantId',
  ServiceAsset: 'tenantId',
};

const WRITE_OPERATIONS = new Set(['create']);
const WRITE_MANY_OPERATIONS = new Set(['createMany']);
const FILTER_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

function withTenantGuard(client: PrismaClient) {
  return client.$extends({
    name: 'tenant-guard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const scopeField = model ? TENANT_SCOPE_FIELD[model] : undefined;
          if (!scopeField) {
            // Not a tenant-scoped model (e.g. the global `Permission` catalog) --
            // pass through untouched.
            return query(args);
          }

          const tenantId = requireTenantId();
          const typedArgs = args as Record<string, unknown>;

          if (WRITE_OPERATIONS.has(operation)) {
            typedArgs.data = { ...(typedArgs.data as object), [scopeField]: tenantId };
          } else if (WRITE_MANY_OPERATIONS.has(operation)) {
            const data = typedArgs.data as unknown[];
            typedArgs.data = data.map((row) => ({ ...(row as object), [scopeField]: tenantId }));
          } else if (operation === 'upsert') {
            typedArgs.where = { ...(typedArgs.where as object), [scopeField]: tenantId };
            typedArgs.create = { ...(typedArgs.create as object), [scopeField]: tenantId };
            typedArgs.update = { ...(typedArgs.update as object), [scopeField]: tenantId };
          } else if (FILTER_OPERATIONS.has(operation)) {
            typedArgs.where = { ...(typedArgs.where as object), [scopeField]: tenantId };
          } else {
            throw new Error(
              `tenant-guard: unhandled Prisma operation "${operation}" on tenant-scoped model "${model}" -- add explicit handling instead of letting it run unscoped.`,
            );
          }

          return query(typedArgs);
        },
      },
    },
  });
}

// $extends() propagates the extension into the client returned by $transaction(), so
// the `tx` that withTenantTx()'s callers receive is ALSO guarded -- this must stay the
// client passed to withTenantTx, never the unwrapped `new PrismaClient()`, or every
// query inside a tenant transaction would silently skip this whole second layer.
export const prisma = withTenantGuard(new PrismaClient()) as unknown as PrismaClient;

/**
 * The raw, unguarded client -- deliberately exported ONLY so
 * test/tenant-isolation.test.ts can prove Postgres RLS blocks cross-tenant access
 * even with this whole extension bypassed entirely. Application code must never
 * import this; there is no code path where skipping the guard is correct.
 */
export const uncheckedPrisma = new PrismaClient();
