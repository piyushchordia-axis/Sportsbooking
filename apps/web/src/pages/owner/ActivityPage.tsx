import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../../api/client';
import {
  Card,
  EmptyState,
  PageHeader,
  Select,
  useLoad,
} from '../../components/common';
import { Button } from '../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { SearchableSelect } from '../../components/ui/combobox';
import { Skeleton } from '../../components/ui/skeleton';

const PAGE_SIZE = 20;

/** Verb → label + tone for the action badge. */
const ACTION_META: Record<string, { label: string; cls: string }> = {
  create: { label: 'Created', cls: 'bg-primary/15 text-primary' },
  update: { label: 'Updated', cls: 'bg-blue-500/15 text-blue-400' },
  delete: { label: 'Deleted', cls: 'bg-destructive/15 text-destructive' },
};

const ACTION_OPTS = [
  { value: '', label: 'All actions' },
  { value: 'create', label: 'Created' },
  { value: 'update', label: 'Updated' },
  { value: 'delete', label: 'Deleted' },
];

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Owner: ACTIVITY LOG — the read side of the audit trail. Lists every management
 * mutation (who did what, to which entity, when) recorded by the global audit
 * interceptor, tenant-scoped to this owner. Filterable by action + entity,
 * paginated.
 */
export function ActivityPage() {
  const entityList = useLoad(() => api.auditLogEntities());

  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);

  // Any filter change returns to the first page.
  useEffect(() => {
    setPage(1);
  }, [action, entity]);

  const result = useLoad(
    () =>
      api.listAuditLogs({
        action: action || undefined,
        entity: entity || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [action, entity, page],
  );

  const entityOpts = useMemo(
    () => [
      { value: '', label: 'All items' },
      ...(entityList.data ?? []).map((e) => ({ value: e, label: e })),
    ],
    [entityList.data],
  );

  const items = result.data?.items ?? [];
  const total = result.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(action || entity);

  return (
    <div className="container">
      <PageHeader
        title="Activity log"
        subtitle="Every change made across your console — who did what, to which item, and when."
      />

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:max-w-xl">
          <Select
            label="Action"
            value={action}
            onChange={setAction}
            options={ACTION_OPTS}
          />
          <SearchableSelect
            label="Item"
            value={entity}
            onChange={setEntity}
            options={entityOpts}
            placeholder="All items"
            searchPlaceholder="Find an item type"
          />
        </div>
      </Card>

      {result.loading && items.length === 0 ? (
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </Card>
      ) : result.error ? (
        <Card>
          <EmptyState title="Couldn't load activity" hint={result.error} />
          <div className="flex justify-center pb-4">
            <Button variant="outline" onClick={result.reload}>
              Try again
            </Button>
          </div>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title={hasFilters ? 'No activity matches these filters' : 'No activity yet'}
            hint={
              hasFilters
                ? 'Try a different action or item type.'
                : 'Changes made by you and your staff will show up here.'
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="pr-5">Item</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e) => {
                  const meta = ACTION_META[e.action] ?? {
                    label: e.action,
                    cls: 'bg-muted text-muted-foreground',
                  };
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="pl-5 whitespace-nowrap text-sm text-muted-foreground">
                        {fmtWhen(e.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="text-foreground">
                          {e.actorName ?? 'Unknown'}
                        </span>
                        <span className="ml-1.5 text-xs capitalize text-muted-foreground">
                          {e.actorRole}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            'inline-block rounded-md px-2 py-0.5 text-xs font-medium ' +
                            meta.cls
                          }
                        >
                          {meta.label}
                        </span>
                      </TableCell>
                      <TableCell className="pr-5 text-sm">
                        <span className="text-foreground">{e.entity}</span>
                        {e.entityId && (
                          <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                            {e.entityId.slice(0, 8)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination footer */}
          <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-5 py-3.5 sm:flex-row">
            <p className="text-xs text-muted-foreground">
              Page <span className="font-medium text-foreground">{page}</span> of{' '}
              <span className="font-medium text-foreground">{pageCount}</span>
              <span className="mx-1.5 opacity-40">·</span>
              {total} {total === 1 ? 'event' : 'events'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || result.loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount || result.loading}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
