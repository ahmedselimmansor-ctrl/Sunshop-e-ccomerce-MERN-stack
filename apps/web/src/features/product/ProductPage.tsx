import { discountPercent, type ProductVariant } from '@sunshop/shared';
import { Check, Minus, Plus, ShieldCheck, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { EmptyState } from '@/components/common/EmptyState';
import { RatingStars } from '@/components/common/RatingStars';
import { ProductCard } from '@/components/product/ProductCard';
import { WishlistButton } from '@/components/product/WishlistButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { localized, useFormat } from '@/lib/format';
import { useAddToCart, useProduct, useRelatedProducts, useReviews } from '@/lib/queries';
import { cn, imageUrl, srcSet } from '@/lib/utils';
import { useUiStore } from '@/stores/ui';

/**
 * Product detail.
 *
 * Variant selection is derived, not stored twice: the selected option values
 * are the state, and the matching variant is computed from them. Storing the
 * variant id as well would let the two drift when a user changes one axis of a
 * two-axis product.
 */
export function ProductPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const format = useFormat();
  const setCartOpen = useUiStore((state) => state.setCartOpen);

  const { data: product, isLoading, isError } = useProduct(slug);
  const { data: related } = useRelatedProducts(product?.id);
  const { data: reviews } = useReviews(product?.id ?? '', 1);
  const addToCart = useAddToCart();

  // Derived here rather than from `name` below, which is computed after an
  // early return; the hook has to run on every render. `null` while loading
  // keeps the previous tab title rather than flashing the bare app name; a
  // missing product gets the same wording the page itself shows.
  useDocumentTitle(
    product ? localized(product.name, locale) : isError ? t('errors.notFound') : null,
  );

  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);

  /**
   * Defaults to the first in-stock variant so the page never opens showing
   * "out of stock" for a product that has stock in another size.
   */
  const defaultOptions = useMemo(() => {
    if (!product) return {};
    const firstAvailable =
      product.variants.find((variant) => variant.inStock) ?? product.variants[0];
    return firstAvailable?.optionValues ?? {};
  }, [product]);

  const options = Object.keys(selectedOptions).length > 0 ? selectedOptions : defaultOptions;

  const selectedVariant: ProductVariant | undefined = useMemo(() => {
    if (!product) return undefined;
    if (product.options.length === 0) return product.variants[0];
    return product.variants.find((variant) =>
      product.options.every((option) => variant.optionValues[option.code] === options[option.code]),
    );
  }, [product, options]);

  if (isLoading) return <ProductSkeleton />;
  if (isError || !product) {
    return (
      <div className="container py-16">
        <EmptyState
          titleAs="h1"
          title={t('errors.notFound')}
          description={t('errors.notFoundHint')}
        />
      </div>
    );
  }

  const name = localized(product.name, locale);
  const images = product.images.length > 0 ? product.images : [];
  const compareAt = selectedVariant?.compareAtPrice ?? null;
  const discount =
    compareAt && selectedVariant ? discountPercent(compareAt, selectedVariant.price) : 0;

  function add() {
    if (!selectedVariant || !product) return;
    addToCart.mutate(
      { productId: product.id, variantId: selectedVariant._id, quantity },
      {
        onSuccess: () => {
          toast.success(t('product.addedToCart'), { description: name });
          setCartOpen(true);
        },
        onError: (error: Error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="container py-8">
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          {/* Toggle buttons rather than a tablist. `role="tab"` promises
              arrow-key navigation and a matching tabpanel; with neither in
              place it told screen readers "tab 1 of 5" and then ignored the
              arrow keys. A short list of labelled buttons keeps the promise
              it makes. */}
          {images.length > 1 && (
            <ul className="flex gap-2 sm:flex-col" aria-label={t('product.gallery')}>
              {images.map((image, index) => (
                <li key={image.key}>
                  <button
                    type="button"
                    aria-pressed={index === activeImage}
                    // The thumbnail is decorative (alt=""), so the name lives here.
                    aria-label={t('product.showImage', {
                      index: index + 1,
                      total: images.length,
                    })}
                    onClick={() => setActiveImage(index)}
                    className={cn(
                      'size-16 overflow-hidden rounded-md border-2 transition-colors',
                      index === activeImage
                        ? 'border-primary'
                        : 'hover:border-border border-transparent',
                    )}
                  >
                    <img
                      src={imageUrl(image.key, 160) ?? undefined}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="bg-muted flex-1 overflow-hidden rounded-xl border">
            {images[activeImage] ? (
              <img
                src={imageUrl(images[activeImage]!.key, 960) ?? undefined}
                srcSet={srcSet(images[activeImage]!.key)}
                sizes="(min-width: 1024px) 45vw, 100vw"
                alt={localized(images[activeImage]!.alt, locale) || name}
                width={960}
                height={960}
                fetchpriority="high"
                className="aspect-square size-full object-cover"
              />
            ) : (
              <div className="aspect-square" />
            )}
          </div>
        </div>

        <div>
          {product.brand && (
            <span className="text-muted-foreground text-sm uppercase tracking-wide">
              {product.brand}
            </span>
          )}
          <h1 className="font-display mt-1 text-2xl font-bold md:text-3xl">{name}</h1>

          {product.rating.count > 0 && (
            <div className="mt-2">
              <RatingStars value={product.rating.average} count={product.rating.count} size="md" />
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-baseline gap-3">
            <span className="numeric text-2xl font-bold">
              {selectedVariant
                ? format.money(selectedVariant.price)
                : format.moneyRange(product.priceRange.min, product.priceRange.max)}
            </span>
            {compareAt && discount > 0 && (
              <>
                <span className="numeric text-muted-foreground text-base line-through">
                  {format.money(compareAt)}
                </span>
                <Badge variant="destructive">{t('product.save', { percent: discount })}</Badge>
              </>
            )}
          </div>

          {product.shortDescription && (
            <p className="text-muted-foreground mt-3 text-sm">
              {localized(product.shortDescription, locale)}
            </p>
          )}

          <Separator className="my-6" />

          {product.options.map((option) => (
            <fieldset key={option.code} className="mb-5">
              <legend className="mb-2 text-sm font-medium">{localized(option.name, locale)}</legend>
              <div className="flex flex-wrap gap-2">
                {option.values.map((value) => {
                  const isSelected = options[option.code] === value.code;
                  // Grey out combinations that do not exist rather than hiding
                  // them: a disappearing size looks like a rendering bug.
                  const exists = product.variants.some(
                    (variant) =>
                      variant.optionValues[option.code] === value.code && variant.isActive,
                  );

                  return (
                    <button
                      key={value.code}
                      type="button"
                      disabled={!exists}
                      onClick={() => setSelectedOptions({ ...options, [option.code]: value.code })}
                      aria-pressed={isSelected}
                      className={cn(
                        'flex min-w-11 items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                        isSelected
                          ? 'border-primary bg-primary/10 font-medium'
                          : 'hover:border-foreground/30',
                        !exists && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      {value.swatch && (
                        <span
                          className="size-4 rounded-full border"
                          style={{ backgroundColor: value.swatch }}
                          aria-hidden
                        />
                      )}
                      {localized(value.label, locale)}
                      {isSelected && <Check className="size-3.5" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-md border">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                disabled={quantity <= 1}
                aria-label="-"
              >
                <Minus className="size-4" aria-hidden />
              </Button>
              <span className="numeric w-10 text-center font-medium">{quantity}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  setQuantity((value) => Math.min(selectedVariant?.available ?? 99, value + 1))
                }
                disabled={quantity >= (selectedVariant?.available ?? 99)}
                aria-label="+"
              >
                <Plus className="size-4" aria-hidden />
              </Button>
            </div>

            <Button
              size="lg"
              className="flex-1"
              onClick={add}
              loading={addToCart.isPending}
              disabled={!selectedVariant?.inStock}
            >
              {selectedVariant?.inStock ? t('product.addToCart') : t('product.outOfStock')}
            </Button>
          </div>

          <WishlistButton
            productId={product.id}
            productName={name}
            variant="full"
            className="mt-3 w-full"
          />

          {selectedVariant?.isLowStock && (
            <p className="text-warning mt-3 text-sm font-medium">
              {t('product.onlyLeft', { count: selectedVariant.available })}
            </p>
          )}

          <dl className="text-muted-foreground mt-6 space-y-2 text-sm">
            {selectedVariant && (
              <div className="flex gap-2">
                <dt>{t('product.sku')}:</dt>
                <dd className="numeric font-mono">{selectedVariant.sku}</dd>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Truck className="size-4" aria-hidden />
              {t('home.freeShippingDesc')}
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4" aria-hidden />
              {t('home.securePaymentDesc')}
            </div>
          </dl>
        </div>
      </div>

      <Tabs defaultValue="description" className="mt-12">
        <TabsList>
          <TabsTrigger value="description">{t('product.description')}</TabsTrigger>
          {product.attributes.length > 0 && (
            <TabsTrigger value="specs">{t('product.specifications')}</TabsTrigger>
          )}
          <TabsTrigger value="reviews">
            {t('product.reviews')}
            {product.rating.count > 0 && (
              <span className="numeric ms-1">({product.rating.count})</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="description" className="prose max-w-3xl text-sm leading-relaxed">
          <p className="whitespace-pre-line">{localized(product.description, locale)}</p>
        </TabsContent>

        {product.attributes.length > 0 && (
          <TabsContent value="specs">
            <dl className="max-w-2xl divide-y rounded-lg border">
              {product.attributes.map((attribute, index) => (
                <div key={index} className="grid grid-cols-2 gap-4 p-3 text-sm">
                  <dt className="text-muted-foreground">{localized(attribute.key, locale)}</dt>
                  <dd>{localized(attribute.value, locale)}</dd>
                </div>
              ))}
            </dl>
          </TabsContent>
        )}

        <TabsContent value="reviews">
          {(reviews?.data.length ?? 0) === 0 ? (
            <p className="text-muted-foreground text-sm">{t('product.noReviews')}</p>
          ) : (
            <ul className="max-w-3xl space-y-6">
              {reviews!.data.map((review) => (
                <li key={review.id} className="border-b pb-6 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <RatingStars value={review.rating} />
                    <span className="text-sm font-medium">{review.user.name}</span>
                    {review.isVerifiedPurchase && (
                      <Badge variant="success" className="text-[10px]">
                        {t('product.verifiedPurchase')}
                      </Badge>
                    )}
                    <span className="numeric text-muted-foreground ms-auto text-xs">
                      {format.date(review.createdAt)}
                    </span>
                  </div>
                  {review.title && <h3 className="mt-2 font-medium">{review.title}</h3>}
                  <p className="text-muted-foreground mt-1 text-sm">{review.body}</p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      {(related?.length ?? 0) > 0 && (
        <section className="mt-14">
          <h2 className="font-display mb-5 text-xl font-bold">{t('product.relatedProducts')}</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {related!.map((entry) => (
              <ProductCard key={entry.id} product={entry} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="container grid gap-8 py-8 lg:grid-cols-2">
      <Skeleton className="aspect-square rounded-xl" />
      <div className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-3/4" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
