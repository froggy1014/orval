import { describe, expect, it } from 'vitest';

import type {
  ContextSpec,
  NormalizedInputOptions,
  NormalizedOutputOptions,
  OpenApiPathItemObject,
} from '../types';
import { FormDataArrayHandling, OutputClient } from '../types';
import { _filteredVerbs, generateVerbsOptions } from './verbs-options';

describe('_filteredVerbs', () => {
  it('should return all verbs if filters.tags is undefined', () => {
    const verbs = {
      get: {
        tags: ['tag1', 'tag2'],
        responses: {},
      },
      post: {
        tags: ['tag3', 'tag4'],
        responses: {},
      },
    };

    const filters = {
      tags: undefined,
    };

    expect(_filteredVerbs(verbs, filters)).toEqual(Object.entries(verbs));
  });

  it('should return verbs that match the tag filter', () => {
    const verbs = {
      get: {
        tags: ['tag1', 'tag2'],
        responses: {},
      },
      post: {
        tags: ['tag3', 'tag4'],
        responses: {},
      },
    };

    const filters: NormalizedInputOptions['filters'] = {
      tags: ['tag1'],
    };

    expect(_filteredVerbs(verbs, filters)).toEqual(
      Object.entries({ get: verbs.get }),
    );
  });

  it('should return verbs that match the regex filter', () => {
    const verbs = {
      get: {
        tags: ['tag1', 'tag2'],
        responses: {},
      },
      post: {
        tags: ['tag3', 'tag4'],
        responses: {},
      },
    };

    const filters: NormalizedInputOptions['filters'] = {
      tags: [/tag1/],
    };

    expect(_filteredVerbs(verbs, filters)).toEqual(
      Object.entries({ get: verbs.get }),
    );
  });

  describe('filters.mode', () => {
    it('should return verbs that match the tag filter', () => {
      const verbs = {
        get: {
          tags: ['tag1', 'tag2'],
          responses: {},
        },
        post: {
          tags: ['tag3', 'tag4'],
          responses: {},
        },
      };

      const filters: NormalizedInputOptions['filters'] = {
        tags: ['tag1'],
        mode: 'include',
      };

      expect(_filteredVerbs(verbs, filters)).toEqual(
        Object.entries({ get: verbs.get }),
      );
    });

    it('should return verbs that do not match the tag filter', () => {
      const verbs = {
        get: {
          tags: ['tag1', 'tag2'],
          responses: {},
        },
        post: {
          tags: ['tag3', 'tag4'],
          responses: {},
        },
      };

      const filters: NormalizedInputOptions['filters'] = {
        tags: ['tag1'],
        mode: 'exclude',
      };

      expect(_filteredVerbs(verbs, filters)).toEqual(
        Object.entries({ post: verbs.post }),
      );
    });
  });
});

describe('generateVerbsOptions', () => {
  const createOutput = (
    overrides: Partial<NormalizedOutputOptions> = {},
  ): NormalizedOutputOptions =>
    ({
      client: OutputClient.AXIOS,
      override: {
        operations: {},
        tags: {},
        formData: {
          disabled: true,
          arrayHandling: FormDataArrayHandling.SERIALIZE,
        },
        formUrlEncoded: false,
        components: {
          requestBodies: { suffix: 'Body' },
        },
        fetch: { jsonReviver: undefined },
      },
      ...overrides,
    }) as NormalizedOutputOptions;

  const createContext = (output: NormalizedOutputOptions): ContextSpec => ({
    output,
    target: 'spec',
    workspace: '',
    spec: {
      components: { schemas: {} },
    },
  });

  it('splits request bodies by content type and suffixes operationName', async () => {
    const output = createOutput();
    const context = createContext(output);
    const verbs: OpenApiPathItemObject = {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'string' },
            },
            'application/xml': {
              schema: { type: 'string' },
            },
          },
        },
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
    };

    const input = {
      filters: { tags: undefined },
    } as NormalizedInputOptions;

    const results = await generateVerbsOptions({
      verbs,
      input,
      output,
      route: '/pets',
      pathRoute: '/pets',
      context,
    });

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.operationName).toSorted()).toEqual(
      [
        'createPetWithApplicationJson',
        'createPetWithApplicationXml',
      ].toSorted(),
    );
    expect(results.map((result) => result.body.contentType).toSorted()).toEqual(
      ['application/json', 'application/xml'].toSorted(),
    );
  });

  it('keeps base operationName for single content type', async () => {
    const output = createOutput();
    const context = createContext(output);
    const verbs: OpenApiPathItemObject = {
      post: {
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'string' },
            },
          },
        },
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'string' },
              },
            },
          },
        },
      },
    };

    const input = {
      filters: { tags: undefined },
    } as NormalizedInputOptions;

    const results = await generateVerbsOptions({
      verbs,
      input,
      output,
      route: '/pets',
      pathRoute: '/pets',
      context,
    });

    expect(results).toHaveLength(1);
    expect(results[0].operationName).toBe('createPet');
    expect(results[0].body.contentType).toBe('application/json');
  });
});
