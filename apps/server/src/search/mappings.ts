import { INDEX } from './client';

import type { estypes } from '@elastic/elasticsearch';

type IndicesCreateRequest = estypes.IndicesCreateRequest;

/**
 * Index definition for the product catalogue.
 *
 * The interesting part is bilingual analysis. Arabic needs more than a stemmer:
 *  • `arabic_normalization` folds أ/إ/آ → ا and ة → ه, so "احمد" matches "أحمد"
 *    and "كنزه" matches "كنزة"، without it a third of Arabic queries miss.
 *  • `decimal_digit` maps Eastern Arabic numerals (٠١٢) to Latin, so "٤٢" and
 *    "42" find the same size.
 *  • Tashkeel is stripped by the same normalizer, so diacritics in the catalogue
 *    do not break matching against undiacritized queries.
 *
 * English gets `asciifolding` for the mirror problem (café/cafe) plus a light
 * stemmer. Each language is indexed into its own subfield so a query can be
 * analyzed with the right pipeline instead of one lowest-common-denominator.
 */
export const productIndexSettings: IndicesCreateRequest = {
  index: INDEX.products,
  settings: {
    number_of_shards: 1,
    // One replica so a single node loss does not lose the index; OpenSearch
    // deployments run 3 data nodes across AZs.
    number_of_replicas: 1,
    refresh_interval: '5s',
    max_result_window: 20_000,
    analysis: {
      filter: {
        english_stop: { type: 'stop', stopwords: '_english_' },
        english_stemmer: { type: 'stemmer', language: 'light_english' },
        english_possessive: { type: 'stemmer', language: 'possessive_english' },
        arabic_stop: { type: 'stop', stopwords: '_arabic_' },
        // Lucene's light Arabic stemmer. Registered as `arabic`: there is no
        // `light_arabic` alias, unlike the English family.
        arabic_stemmer: { type: 'stemmer', language: 'arabic' },
        edge_ngram_filter: { type: 'edge_ngram', min_gram: 2, max_gram: 20 },
      },
      char_filter: {
        // Collapse tatweel (ـ) which is decorative and never semantic.
        strip_tatweel: { type: 'pattern_replace', pattern: '\\u0640', replacement: '' },
      },
      analyzer: {
        english_text: {
          type: 'custom',
          tokenizer: 'standard',
          filter: [
            'lowercase',
            'english_possessive',
            'english_stop',
            'english_stemmer',
            'asciifolding',
          ],
        },
        arabic_text: {
          type: 'custom',
          char_filter: ['strip_tatweel'],
          tokenizer: 'standard',
          filter: [
            'lowercase',
            'decimal_digit',
            'arabic_normalization',
            'arabic_stop',
            'arabic_stemmer',
          ],
        },
        /** Index-time analyzer for as-you-type suggestions. */
        autocomplete_index: {
          type: 'custom',
          char_filter: ['strip_tatweel'],
          tokenizer: 'standard',
          filter: [
            'lowercase',
            'decimal_digit',
            'arabic_normalization',
            'asciifolding',
            'edge_ngram_filter',
          ],
        },
        /** Search-time twin: no ngrams, or every query would explode. */
        autocomplete_search: {
          type: 'custom',
          char_filter: ['strip_tatweel'],
          tokenizer: 'standard',
          filter: ['lowercase', 'decimal_digit', 'arabic_normalization', 'asciifolding'],
        },
      },
      normalizer: {
        keyword_lowercase: { type: 'custom', filter: ['lowercase', 'asciifolding'] },
      },
    },
  },
  mappings: {
    dynamic: 'strict',
    properties: {
      id: { type: 'keyword' },
      slug: { type: 'keyword' },
      status: { type: 'keyword' },

      name: {
        properties: {
          en: {
            type: 'text',
            analyzer: 'english_text',
            fields: {
              keyword: { type: 'keyword', normalizer: 'keyword_lowercase', ignore_above: 256 },
              autocomplete: {
                type: 'text',
                analyzer: 'autocomplete_index',
                search_analyzer: 'autocomplete_search',
              },
            },
          },
          ar: {
            type: 'text',
            analyzer: 'arabic_text',
            fields: {
              keyword: { type: 'keyword', normalizer: 'keyword_lowercase', ignore_above: 256 },
              autocomplete: {
                type: 'text',
                analyzer: 'autocomplete_index',
                search_analyzer: 'autocomplete_search',
              },
            },
          },
        },
      },

      description: {
        properties: {
          en: { type: 'text', analyzer: 'english_text' },
          ar: { type: 'text', analyzer: 'arabic_text' },
        },
      },

      brand: {
        type: 'text',
        analyzer: 'english_text',
        fields: {
          keyword: { type: 'keyword', normalizer: 'keyword_lowercase' },
          autocomplete: {
            type: 'text',
            analyzer: 'autocomplete_index',
            search_analyzer: 'autocomplete_search',
          },
        },
      },

      tags: { type: 'keyword', normalizer: 'keyword_lowercase' },
      sku: { type: 'keyword' },

      categoryIds: { type: 'keyword' },
      categoryPaths: { type: 'keyword' },
      categoryNames: {
        properties: {
          en: { type: 'text', analyzer: 'english_text' },
          ar: { type: 'text', analyzer: 'arabic_text' },
        },
      },

      // Nested so a filter on "size=M AND color=black" cannot match a product
      // that merely has an M in one variant and black in another.
      options: {
        type: 'nested',
        properties: {
          code: { type: 'keyword' },
          value: { type: 'keyword', normalizer: 'keyword_lowercase' },
        },
      },

      priceMin: { type: 'integer' },
      priceMax: { type: 'integer' },
      currency: { type: 'keyword' },
      compareAtPrice: { type: 'integer' },
      discountPercent: { type: 'integer' },

      inStock: { type: 'boolean' },
      totalStock: { type: 'integer' },
      isFeatured: { type: 'boolean' },

      ratingAverage: { type: 'half_float' },
      ratingCount: { type: 'integer' },
      soldCount: { type: 'integer' },

      imageKey: { type: 'keyword', index: false },
      blurhash: { type: 'keyword', index: false },

      createdAt: { type: 'date' },
      publishedAt: { type: 'date' },
      updatedAt: { type: 'date' },

      /** Precomputed popularity signal used to break relevance ties. */
      boost: { type: 'float' },
    },
  },
};

/** Lightweight index backing the search-as-you-type dropdown. */
export const suggestionIndexSettings: IndicesCreateRequest = {
  index: INDEX.suggestions,
  settings: {
    number_of_shards: 1,
    number_of_replicas: 1,
    analysis: {
      char_filter: {
        strip_tatweel: { type: 'pattern_replace', pattern: '\\u0640', replacement: '' },
      },
      filter: {
        edge_ngram_filter: { type: 'edge_ngram', min_gram: 1, max_gram: 20 },
      },
      analyzer: {
        suggest_index: {
          type: 'custom',
          char_filter: ['strip_tatweel'],
          tokenizer: 'standard',
          filter: [
            'lowercase',
            'decimal_digit',
            'arabic_normalization',
            'asciifolding',
            'edge_ngram_filter',
          ],
        },
        suggest_search: {
          type: 'custom',
          char_filter: ['strip_tatweel'],
          tokenizer: 'standard',
          filter: ['lowercase', 'decimal_digit', 'arabic_normalization', 'asciifolding'],
        },
      },
    },
  },
  mappings: {
    dynamic: 'strict',
    properties: {
      type: { type: 'keyword' },
      text: {
        type: 'text',
        analyzer: 'suggest_index',
        search_analyzer: 'suggest_search',
        fields: { keyword: { type: 'keyword' } },
      },
      locale: { type: 'keyword' },
      slug: { type: 'keyword' },
      imageKey: { type: 'keyword', index: false },
      weight: { type: 'integer' },
    },
  },
};
