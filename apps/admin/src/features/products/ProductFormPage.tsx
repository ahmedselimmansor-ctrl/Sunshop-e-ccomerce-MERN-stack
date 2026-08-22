import { zodResolver } from '@hookform/resolvers/zod';
import {
  CURRENCIES,
  PRODUCT_STATUSES,
  createProductSchema,
  slugify,
  type CreateProductInput,
  type Currency,
} from '@sunshop/shared';
import { ArrowLeft, ImagePlus, Plus, Trash2, Wand2 } from 'lucide-react';
import {
  type ReactElement,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { useFieldArray, useForm, type Control, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ApiClientError } from '@/lib/api';
import { localized, useFormat } from '@/lib/format';
import {
  useAdminProduct,
  useCategoryTree,
  useCreateProduct,
  useUpdateProduct,
  useUploadImage,
} from '@/lib/queries';
import { imageUrl } from '@/lib/utils';

/**
 * Product editor.
 *
 * The one design decision worth explaining: **variants are generated, not typed**.
 * A merchant declares the option axes (size, colour) and their values, and the
 * form produces the cartesian product with a SKU per combination. Hand-entering
 * twenty rows for a four-size, five-colour shirt is how catalogues end up with
 * duplicate SKUs and missing combinations, both of which the API rejects at the
 * very end of a long form.
 *
 * Regeneration preserves the price and stock of any combination that already
 * existed, so adding one colour to a live product does not reset the other
 * nineteen rows.
 */

type FormValues = CreateProductInput;

const EMPTY_VARIANT = (currency: Currency) => ({
  sku: '',
  optionValues: {},
  price: { amount: 0, currency },
  compareAtPrice: null,
  stock: 0,
  reserved: 0,
  lowStockThreshold: 5,
  stockPolicy: 'deny' as const,
  isActive: true,
});

export function ProductFormPage() {
  const { id } = useParams();
  const isEditing = Boolean(id);

  const { t } = useTranslation();

  useDocumentTitle(isEditing ? t('products.edit') : t('products.create'));
  const navigate = useNavigate();
  const format = useFormat();

  const { data: categories } = useCategoryTree();
  const { data: existing, isLoading } = useAdminProduct(id ?? '');

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct(id ?? '');
  const uploadImage = useUploadImage();

  const [currency, setCurrency] = useState<Currency>('USD');
  const [tagInput, setTagInput] = useState('');

  const form = useForm<FormValues>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      name: { en: '', ar: '' },
      slug: '',
      description: { en: '', ar: '' },
      brand: '',
      categories: [],
      tags: [],
      images: [],
      options: [],
      variants: [EMPTY_VARIANT('USD')],
      status: 'draft',
      isFeatured: false,
      attributes: [],
    },
  });

  const variants = useFieldArray({ control: form.control, name: 'variants' });
  const options = useFieldArray({ control: form.control, name: 'options' });
  const images = useFieldArray({ control: form.control, name: 'images' });

  /** Flatten the category tree once for the picker. */
  const flatCategories = useMemo(() => {
    const rows: { id: string; label: string; depth: number }[] = [];
    const walk = (nodes: typeof categories, depth: number) => {
      for (const node of nodes ?? []) {
        rows.push({ id: node.id, label: localized(node.name, format.locale), depth });
        walk(node.children, depth + 1);
      }
    };
    walk(categories, 0);
    return rows;
  }, [categories, format.locale]);

  useEffect(() => {
    if (!existing || !isEditing) return;

    setCurrency(existing.priceRange.min.currency);
    form.reset({
      name: existing.name,
      slug: existing.slug,
      description: existing.description,
      shortDescription: existing.shortDescription,
      brand: existing.brand ?? '',
      categories: existing.categories,
      tags: existing.tags,
      images: existing.images.map((image) => ({
        key: image.key,
        alt: image.alt,
        position: image.position,
        width: image.width,
        height: image.height,
      })),
      options: existing.options,
      variants: existing.variants.map((variant) => ({
        sku: variant.sku,
        optionValues: variant.optionValues,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice ?? null,
        stock: variant.stock,
        reserved: variant.reserved,
        lowStockThreshold: variant.lowStockThreshold,
        stockPolicy: variant.stockPolicy,
        imageKey: variant.imageKey,
        isActive: variant.isActive,
      })),
      status: existing.status,
      isFeatured: existing.isFeatured,
      attributes: existing.attributes,
    });
  }, [existing, isEditing, form]);

  /**
   * Rebuilds the variant matrix from the declared options, carrying over the
   * price and stock of combinations that already exist.
   */
  function regenerateVariants() {
    const declared = form.getValues('options');
    const current = form.getValues('variants');

    if (declared.length === 0) {
      if (current.length === 0) form.setValue('variants', [EMPTY_VARIANT(currency)]);
      return;
    }

    const combinations = declared.reduce<Record<string, string>[]>(
      (accumulator, option) =>
        accumulator.flatMap((partial) =>
          option.values.map((value) => ({ ...partial, [option.code]: value.code })),
        ),
      [{}],
    );

    const keyOf = (values: Record<string, string>) =>
      Object.entries(values)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, value]) => `${code}:${value}`)
        .join('|');

    const previous = new Map(
      current.map((variant) => [keyOf(variant.optionValues ?? {}), variant]),
    );
    const baseSku =
      form
        .getValues('slug')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 10) || 'SKU';

    form.setValue(
      'variants',
      combinations.map((optionValues, index) => {
        const carried = previous.get(keyOf(optionValues));
        return {
          ...(carried ?? EMPTY_VARIANT(currency)),
          optionValues,
          sku: carried?.sku || `${baseSku}-${String(index + 1).padStart(3, '0')}`,
        };
      }),
      { shouldDirty: true },
    );

    toast.success(t('products.variantsGenerated', { count: combinations.length }));
  }

  async function onSubmit(values: FormValues) {
    try {
      const payload: FormValues = {
        ...values,
        slug: values.slug || slugify(values.name.en),
        brand: values.brand?.trim() ? values.brand : undefined,
        images: values.images.map((image, index) => ({ ...image, position: index })),
      };

      const saved = isEditing
        ? await updateProduct.mutateAsync(payload)
        : await createProduct.mutateAsync(payload);

      toast.success(t('common.saved'));
      navigate(`/products/${saved.id}/edit`, { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError) {
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          // Server paths are prefixed with the request part they came from.
          form.setError(path.replace(/^body\./, '') as never, { message });
        }
        toast.error(error.message);
      } else {
        toast.error(t('errors.generic'));
      }
    }
  }

  async function onPickImages(files: FileList | null) {
    if (!files?.length) return;

    for (const file of Array.from(files).slice(0, 8)) {
      try {
        const uploaded = await uploadImage.mutateAsync({ file, scope: 'product' });
        images.append({ key: uploaded.key, position: images.fields.length });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('errors.generic'));
      }
    }
  }

  if (isEditing && isLoading) return <Skeleton className="h-[40rem] w-full" />;

  const selectedCategories = form.watch('categories');
  const currentTags = form.watch('tags');

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-16" noValidate>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="icon" asChild>
          <Link to="/products" aria-label={t('products.title')}>
            <ArrowLeft className="rtl:rotate-180" aria-hidden />
          </Link>
        </Button>

        <h1 className="font-display text-2xl font-bold">
          {isEditing ? t('products.edit') : t('products.create')}
        </h1>

        {isEditing && existing && <Badge variant="secondary">{existing.status}</Badge>}

        <Button
          type="submit"
          className="ms-auto"
          loading={createProduct.isPending || updateProduct.isPending}
        >
          {t('common.save')}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('products.basics')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper
                  label={`${t('products.name')} (EN)`}
                  error={form.formState.errors.name?.en?.message}
                  required
                >
                  <Input
                    dir="ltr"
                    {...form.register('name.en', {
                      onChange: (event) => {
                        // Only auto-fill the slug while creating; changing a live
                        // slug silently would break every existing link to it.
                        if (!isEditing && !form.getValues('slug')) return;
                        if (!isEditing) form.setValue('slug', slugify(event.target.value));
                      },
                    })}
                  />
                </FieldWrapper>

                <FieldWrapper
                  label={`${t('products.name')} (AR)`}
                  error={form.formState.errors.name?.ar?.message}
                  required
                >
                  <Input dir="rtl" {...form.register('name.ar')} />
                </FieldWrapper>
              </div>

              <FieldWrapper
                label={t('products.slug')}
                error={form.formState.errors.slug?.message}
                required
              >
                {(id) => (
                  <div className="flex gap-2">
                    <Input
                      id={id}
                      dir="ltr"
                      className="font-mono text-sm"
                      {...form.register('slug')}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      aria-label={t('products.generateSlug')}
                      onClick={() => form.setValue('slug', slugify(form.getValues('name.en')))}
                    >
                      <Wand2 aria-hidden />
                    </Button>
                  </div>
                )}
              </FieldWrapper>

              <div className="grid gap-4 sm:grid-cols-2">
                <FieldWrapper label={`${t('products.description')} (EN)`}>
                  <Textarea dir="ltr" rows={5} {...form.register('description.en')} />
                </FieldWrapper>
                <FieldWrapper label={`${t('products.description')} (AR)`}>
                  <Textarea dir="rtl" rows={5} {...form.register('description.ar')} />
                </FieldWrapper>
              </div>

              <FieldWrapper label={t('products.brand')}>
                <Input {...form.register('brand')} />
              </FieldWrapper>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('products.images')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {images.fields.map((field, index) => (
                  <div key={field.id} className="group relative">
                    <img
                      src={imageUrl(form.getValues(`images.${index}.key`), 320) ?? undefined}
                      alt=""
                      className="bg-muted aspect-square w-full rounded-md border object-cover"
                    />
                    {index === 0 && (
                      <Badge className="absolute start-1 top-1 text-[10px]">
                        {t('products.primary')}
                      </Badge>
                    )}
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-sm"
                      className="absolute end-1 top-1 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label={t('common.delete')}
                      onClick={() => images.remove(index)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                ))}

                <label className="border-muted-foreground/30 hover:border-primary text-muted-foreground hover:text-primary flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-xs transition-colors">
                  <ImagePlus className="size-5" aria-hidden />
                  {uploadImage.isPending ? t('common.loading') : t('products.addImage')}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    multiple
                    className="sr-only"
                    onChange={(event) => void onPickImages(event.target.files)}
                  />
                </label>
              </div>

              <p className="text-muted-foreground text-xs">{t('products.imageHint')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle as="h2">{t('products.options')}</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  options.append({
                    code: `option${options.fields.length + 1}`,
                    name: { en: '', ar: '' },
                    values: [{ code: '', label: { en: '', ar: '' } }],
                  })
                }
              >
                <Plus aria-hidden />
                {t('products.addOption')}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {options.fields.length === 0 && (
                <p className="text-muted-foreground text-sm">{t('products.noOptions')}</p>
              )}

              {options.fields.map((field, index) => (
                <OptionEditor
                  key={field.id}
                  index={index}
                  control={form.control}
                  form={form}
                  onRemove={() => options.remove(index)}
                />
              ))}

              {options.fields.length > 0 && (
                <Button type="button" variant="secondary" onClick={regenerateVariants}>
                  <Wand2 aria-hidden />
                  {t('products.generateVariants')}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle as="h2">
                {t('products.variants')}{' '}
                <span className="numeric text-muted-foreground font-normal">
                  ({variants.fields.length})
                </span>
              </CardTitle>
              {options.fields.length === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => variants.append(EMPTY_VARIANT(currency))}
                >
                  <Plus aria-hidden />
                  {t('common.add')}
                </Button>
              )}
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">{t('products.sku')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('products.optionsCol')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('products.price')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('products.compareAt')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('products.stock')}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {variants.fields.map((field, index) => (
                    <tr key={field.id}>
                      <td className="px-3 py-2">
                        <Input
                          dir="ltr"
                          className="h-8 font-mono text-xs uppercase"
                          aria-label={t('products.variantFieldLabel', {
                            field: t('products.sku'),
                            n: index + 1,
                          })}
                          {...form.register(`variants.${index}.sku`)}
                        />
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-xs">
                        {Object.entries(form.getValues(`variants.${index}.optionValues`) ?? {})
                          .map(([code, value]) => `${code}: ${value}`)
                          .join(', ') || '-'}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          className="numeric h-8 w-28"
                          aria-label={t('products.variantFieldLabel', {
                            field: t('products.price'),
                            n: index + 1,
                          })}
                          {...form.register(`variants.${index}.price.amount`, {
                            valueAsNumber: true,
                          })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          className="numeric h-8 w-28"
                          aria-label={t('products.variantFieldLabel', {
                            field: t('products.compareAt'),
                            n: index + 1,
                          })}
                          {...form.register(`variants.${index}.compareAtPrice.amount`, {
                            valueAsNumber: true,
                          })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          className="numeric h-8 w-20"
                          aria-label={t('products.variantFieldLabel', {
                            field: t('products.stock'),
                            n: index + 1,
                          })}
                          {...form.register(`variants.${index}.stock`, { valueAsNumber: true })}
                        />
                      </td>
                      <td className="px-2">
                        {variants.fields.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('common.delete')}
                            onClick={() => variants.remove(index)}
                          >
                            <Trash2 className="text-destructive size-3.5" aria-hidden />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {form.formState.errors.variants?.message && (
                <p role="alert" className="text-destructive px-3 py-2 text-xs">
                  {form.formState.errors.variants.message}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('products.publishing')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldWrapper label={t('products.status')}>
                <Select
                  value={form.watch('status')}
                  onValueChange={(value) => form.setValue('status', value as never)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRODUCT_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldWrapper>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="featured"
                  checked={form.watch('isFeatured')}
                  onCheckedChange={(checked) => form.setValue('isFeatured', Boolean(checked))}
                />
                <Label htmlFor="featured" className="cursor-pointer font-normal">
                  {t('products.featured')}
                </Label>
              </div>

              <Separator />

              <FieldWrapper label={t('products.currency')}>
                <Select
                  value={currency}
                  onValueChange={(value) => {
                    const next = value as Currency;
                    setCurrency(next);
                    // Every variant must share one currency; the API rejects a mix.
                    form.getValues('variants').forEach((_, index) => {
                      form.setValue(`variants.${index}.price.currency`, next);
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((entry) => (
                      <SelectItem key={entry} value={entry}>
                        {entry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldWrapper>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{t('products.organisation')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FieldWrapper
                label={t('products.categories')}
                error={form.formState.errors.categories?.message}
                required
              >
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                  {flatCategories.map((category) => (
                    <label
                      key={category.id}
                      className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm"
                      style={{ paddingInlineStart: `${category.depth * 12 + 4}px` }}
                    >
                      <Checkbox
                        checked={selectedCategories.includes(category.id)}
                        onCheckedChange={(checked) =>
                          form.setValue(
                            'categories',
                            checked
                              ? [...selectedCategories, category.id]
                              : selectedCategories.filter((entry) => entry !== category.id),
                          )
                        }
                      />
                      <span className="truncate">{category.label}</span>
                    </label>
                  ))}
                </div>
              </FieldWrapper>

              <FieldWrapper label={t('products.tags')}>
                {(id) => (
                  <>
                    <div className="flex gap-2">
                      <Input
                        id={id}
                        value={tagInput}
                        onChange={(event) => setTagInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          const value = tagInput.trim().toLowerCase();
                          if (value && !currentTags.includes(value)) {
                            form.setValue('tags', [...currentTags, value]);
                          }
                          setTagInput('');
                        }}
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1">
                      {currentTags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="cursor-pointer"
                          onClick={() =>
                            form.setValue(
                              'tags',
                              currentTags.filter((entry) => entry !== tag),
                            )
                          }
                        >
                          {tag} x
                        </Badge>
                      ))}
                    </div>
                  </>
                )}
              </FieldWrapper>
            </CardContent>
          </Card>
        </aside>
      </div>
    </form>
  );
}

function OptionEditor({
  index,
  control,
  form,
  onRemove,
}: {
  index: number;
  control: Control<FormValues>;
  form: UseFormReturn<FormValues>;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const values = useFieldArray({ control, name: `options.${index}.values` });

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]">
        <Input
          placeholder="code"
          aria-label={t('products.optionCode', { n: index + 1 })}
          dir="ltr"
          className="font-mono text-xs"
          {...form.register(`options.${index}.code`)}
        />
        <Input
          placeholder="Name (EN)"
          aria-label={t('products.optionNameEn', { n: index + 1 })}
          dir="ltr"
          {...form.register(`options.${index}.name.en`)}
        />
        <Input
          placeholder="الاسم (AR)"
          aria-label={t('products.optionNameAr', { n: index + 1 })}
          dir="rtl"
          {...form.register(`options.${index}.name.ar`)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('common.delete')}
          onClick={onRemove}
        >
          <Trash2 className="text-destructive size-4" aria-hidden />
        </Button>
      </div>

      <div className="space-y-2 ps-2">
        {values.fields.map((field, valueIndex) => (
          <div key={field.id} className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr_auto]">
            <Input
              placeholder="code"
              aria-label={t('products.valueCode', { n: valueIndex + 1 })}
              dir="ltr"
              className="h-8 font-mono text-xs"
              {...form.register(`options.${index}.values.${valueIndex}.code`)}
            />
            <Input
              placeholder="Label (EN)"
              aria-label={t('products.valueLabelEn', { n: valueIndex + 1 })}
              dir="ltr"
              className="h-8"
              {...form.register(`options.${index}.values.${valueIndex}.label.en`)}
            />
            <Input
              placeholder="الاسم (AR)"
              aria-label={t('products.valueLabelAr', { n: valueIndex + 1 })}
              dir="rtl"
              className="h-8"
              {...form.register(`options.${index}.values.${valueIndex}.label.ar`)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.delete')}
              onClick={() => values.remove(valueIndex)}
            >
              <Trash2 className="text-destructive size-3.5" aria-hidden />
            </Button>
          </div>
        ))}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => values.append({ code: '', label: { en: '', ar: '' } })}
        >
          <Plus aria-hidden />
          {t('products.addValue')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Label + control + error message for one field.
 *
 * The label used to render beside the control with nothing joining them: no
 * `htmlFor`, no `id`, no wrapping label element. Every input on this form was
 * therefore anonymous: a screen reader announced eleven consecutive "edit
 * text" fields, and clicking a label focused nothing. Generating the id here
 * and handing it to both halves fixes that in one place rather than at ten
 * call sites.
 *
 * The error is wired up too: `role="alert"` alone announces the message once
 * when it appears, but leaves the field itself unmarked, so tabbing back to it
 * later gives no hint that it is the one that failed.
 */
function FieldWrapper({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  /**
   * A single control, which is wired up automatically, or a function receiving
   * the generated id. Fields that pair an input with a button (slug and tags)
   * wrap both in a flex row, and cloning would put the id on that wrapper
   * instead of the input, so those pass a function and place it themselves.
   */
  children: React.ReactNode | ((id: string) => React.ReactNode);
}) {
  const id = useId();
  const errorId = `${id}-error`;

  const described = {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
  };

  const control =
    typeof children === 'function'
      ? children(id)
      : isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, { id, ...described })
        : children;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {control}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
