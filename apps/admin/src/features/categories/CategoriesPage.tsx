import { ChevronRight, FolderTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { localized, useFormat } from '@/lib/format';
import { useCategoryTree } from '@/lib/queries';

import type { CategoryNode } from '@sunshop/shared';

/**
 * Category tree.
 *
 * Rendered as a nested list rather than a flat table because the hierarchy is
 * the information: a merchant needs to see that "Headphones" sits under
 * "Electronics" to understand why a product appears where it does.
 */
export function CategoriesPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.categories'));
  const format = useFormat();
  const { data: tree, isLoading } = useCategoryTree();

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  const totalProducts = (tree ?? []).reduce((total, node) => total + countProducts(node), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">{t('nav.categories')}</h1>
        <span className="text-muted-foreground text-sm">
          <span className="numeric">{format.number(totalProducts)}</span> {t('nav.products')}
        </span>
      </div>

      <Card>
        <CardContent className="p-2">
          <ul className="space-y-0.5">
            {(tree ?? []).map((node) => (
              <CategoryRow key={node.id} node={node} depth={0} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function countProducts(node: CategoryNode): number {
  return (
    (node.productCount ?? 0) +
    node.children.reduce((total, child) => total + countProducts(child), 0)
  );
}

function CategoryRow({ node, depth }: { node: CategoryNode; depth: number }) {
  const format = useFormat();
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-3 py-2 transition-colors"
        style={{ paddingInlineStart: `${depth * 20 + 12}px` }}
      >
        {hasChildren ? (
          <ChevronRight
            className="text-muted-foreground size-3.5 shrink-0 rtl:rotate-180"
            aria-hidden
          />
        ) : (
          <FolderTree className="text-muted-foreground size-3.5 shrink-0 opacity-40" aria-hidden />
        )}

        {node.imageUrl && (
          <img
            src={node.imageUrl}
            alt=""
            className="size-7 shrink-0 rounded object-cover"
            loading="lazy"
          />
        )}

        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {localized(node.name, format.locale)}
        </span>

        <code className="text-muted-foreground hidden text-xs sm:inline">{node.slug}</code>

        {!node.isActive && <Badge variant="secondary">off</Badge>}

        <Badge variant="outline" className="numeric">
          {node.productCount ?? 0}
        </Badge>
      </div>

      {hasChildren && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <CategoryRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
