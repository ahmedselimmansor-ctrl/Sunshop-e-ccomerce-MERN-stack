import { Check, Star, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Pagination } from '@/components/common/Pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useFormat } from '@/lib/format';
import { useAdminReviews, useModerateReview } from '@/lib/queries';
import { useAuthStore } from '@/stores/auth';

import type { Review } from '@sunshop/shared';

/**
 * Moderation queue.
 *
 * Defaults to the pending tab, because that is the only view with work in it.
 * An unmoderated review feed becomes a spam channel within days of launch, so
 * this page is meant to be checked, not admired.
 */
export function ReviewsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.reviews'));
  const format = useFormat();
  const can = useAuthStore((state) => state.can);

  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAdminReviews({ page, limit: 20, status });
  const moderate = useModerateReview();

  function decide(review: Review, next: 'approved' | 'rejected') {
    moderate.mutate(
      { id: review.id, status: next },
      {
        onSuccess: () => toast.success(next),
        onError: (error: Error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t('nav.reviews')}</h1>

      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="pending">pending</TabsTrigger>
          <TabsTrigger value="approved">approved</TabsTrigger>
          <TabsTrigger value="rejected">rejected</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : (data?.data.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground p-10 text-center text-sm">
            {t('common.noResults')}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {data!.data.map((review) => (
            <li key={review.id}>
              <Card>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-warning inline-flex" aria-label={`${review.rating}/5`}>
                      {Array.from({ length: 5 }, (_, index) => (
                        <Star
                          key={index}
                          className="size-3.5"
                          fill={index < review.rating ? 'currentColor' : 'none'}
                          strokeWidth={index < review.rating ? 0 : 1.5}
                          aria-hidden
                        />
                      ))}
                    </span>

                    <span className="text-sm font-medium">{review.user.name}</span>

                    {review.isVerifiedPurchase && (
                      <Badge variant="success" className="text-[10px]">
                        verified
                      </Badge>
                    )}

                    <span className="numeric text-muted-foreground ms-auto text-xs">
                      {format.date(review.createdAt, { dateStyle: 'medium' })}
                    </span>
                  </div>

                  {review.title && <p className="font-medium">{review.title}</p>}
                  <p className="text-muted-foreground text-sm">{review.body}</p>

                  {can('review:moderate') && status !== 'approved' && (
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" onClick={() => decide(review, 'approved')}>
                        <Check aria-hidden />
                        approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={() => decide(review, 'rejected')}
                      >
                        <X aria-hidden />
                        reject
                      </Button>
                    </div>
                  )}

                  {can('review:moderate') && status === 'approved' && (
                    <div className="pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={() => decide(review, 'rejected')}
                      >
                        <X aria-hidden />
                        reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {data && (
        <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
      )}
    </div>
  );
}
