import {
  getBody,
  getOperationId,
  getParameters,
  getParams,
  getProps,
  getQueryParams,
  getResponse,
  getResReqTypes,
} from '../getters';
import type {
  ContextSpec,
  GeneratorVerbOptions,
  GeneratorVerbsOptions,
  NormalizedInputOptions,
  NormalizedMutator,
  NormalizedOperationOptions,
  NormalizedOutputOptions,
  OutputClient,
  OpenApiComponentsObject,
  OpenApiOperationObject,
  OpenApiPathItemObject,
  Verbs,
} from '../types';
import {
  asyncReduce,
  camel,
  dynamicImport,
  isObject,
  isString,
  isVerb,
  jsDoc,
  mergeDeep,
  pascal,
  sanitize,
} from '../utils';
import { generateMutator } from './mutator';

const normalizeTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) {
    return [];
  }

  const result: string[] = [];
  for (const tag of tags) {
    if (typeof tag === 'string') {
      result.push(tag);
    }
  }

  return result;
};

const shouldSplitRequestBodyByContentType = (
  output: NormalizedOutputOptions,
) =>
  output.client === OutputClient.AXIOS ||
  output.client === OutputClient.AXIOS_FUNCTIONS ||
  output.client === OutputClient.FETCH;

export interface GenerateVerbOptionsParams {
  verb: Verbs;
  output: NormalizedOutputOptions;
  operation: OpenApiOperationObject;
  route: string;
  pathRoute: string;
  verbParameters?: OpenApiPathItemObject['parameters'];
  components?: OpenApiComponentsObject;
  context: ContextSpec;
  bodyContentType?: string;
}

export async function generateVerbOptions({
  verb,
  output,
  operation,
  route,
  pathRoute,
  verbParameters = [],
  context,
  bodyContentType,
}: GenerateVerbOptionsParams): Promise<GeneratorVerbOptions> {
  const {
    responses,
    requestBody,
    parameters: operationParameters,
    tags: rawTags = [],
    deprecated,
    description,
    summary,
  } = operation;
  const tags = normalizeTags(rawTags);
  const operationId = getOperationId(operation, route, verb);
  const overrideOperation = output.override.operations[operationId];
  let overrideTag: NormalizedOperationOptions = {};
  const operationNameSuffix = bodyContentType
    ? pascal(bodyContentType)
    : undefined;

  for (const [tag, options] of Object.entries(output.override.tags)) {
    if (tags.includes(tag) && options) {
      overrideTag = mergeDeep(overrideTag, options);
    }
  }

  const override = mergeDeep(
    mergeDeep(output.override, overrideTag),
    overrideOperation ?? {},
  );

  const overrideOperationName =
    overrideOperation?.operationName ?? output.override.operationName;
  const baseOperationName = overrideOperationName
    ? overrideOperationName(operation, route, verb)
    : sanitize(camel(operationId), { es5keyword: true });

  const operationName = operationNameSuffix
    ? sanitize(`${baseOperationName}With${operationNameSuffix}`, {
        es5keyword: true,
      })
    : baseOperationName;

  const response = getResponse({
    responses,
    operationName,
    context,
    contentType: override.contentType,
    preferredContentType: bodyContentType,
  });

  const bodyContentTypeOverride = bodyContentType
    ? { include: [bodyContentType] }
    : override.contentType;

  const body = getBody({
    requestBody: requestBody!,
    operationName,
    context,
    contentType: bodyContentTypeOverride,
  });

  const parameters = getParameters({
    parameters: [...verbParameters, ...(operationParameters ?? [])],
    context,
  });

  const queryParams = getQueryParams({
    queryParams: parameters.query,
    operationName,
    context,
  });

  const headers = output.headers
    ? getQueryParams({
        queryParams: parameters.header,
        operationName,
        context,
        suffix: 'headers',
      })
    : undefined;

  const params = getParams({
    route,
    pathParams: parameters.path,
    operationId,
    context,
    output,
  });

  const props = getProps({
    body,
    queryParams,
    params,
    headers,
    operationName,
    context,
  });

  const mutator = await generateMutator({
    output: output.target,
    name: operationName,
    mutator: override.mutator,
    workspace: context.workspace,
    tsconfig: context.output.tsconfig,
  });

  const formData =
    !override.formData.disabled && body.formData
      ? await generateMutator({
          output: output.target,
          name: operationName,
          mutator: override.formData.mutator,
          workspace: context.workspace,
          tsconfig: context.output.tsconfig,
        })
      : undefined;

  const formUrlEncoded =
    isString(override.formUrlEncoded) || isObject(override.formUrlEncoded)
      ? await generateMutator({
          output: output.target,
          name: operationName,
          mutator: override.formUrlEncoded,
          workspace: context.workspace,
          tsconfig: context.output.tsconfig,
        })
      : undefined;

  const paramsSerializer =
    isString(override.paramsSerializer) || isObject(override.paramsSerializer)
      ? await generateMutator({
          output: output.target,
          name: 'paramsSerializer',
          mutator: override.paramsSerializer as NormalizedMutator,
          workspace: context.workspace,
          tsconfig: context.output.tsconfig,
        })
      : undefined;

  const fetchReviver =
    isString(override.fetch.jsonReviver) || isObject(override.fetch.jsonReviver)
      ? await generateMutator({
          output: output.target,
          name: 'fetchReviver',
          mutator: override.fetch.jsonReviver as NormalizedMutator,
          workspace: context.workspace,
          tsconfig: context.output.tsconfig,
        })
      : undefined;
  const doc = jsDoc({ description, deprecated, summary });

  const verbOption: GeneratorVerbOptions = {
    verb: verb as Verbs,
    tags,
    route,
    pathRoute,
    summary: operation.summary,
    operationId,
    operationName,
    response,
    body,
    headers,
    queryParams,
    params,
    props,
    mutator,
    formData,
    formUrlEncoded,
    paramsSerializer,
    fetchReviver,
    override,
    doc,
    deprecated,
    originalOperation: operation,
  };

  const transformer = await dynamicImport(
    override.transformer,
    context.workspace,
  );

  return transformer ? transformer(verbOption) : verbOption;
}

export interface GenerateVerbsOptionsParams {
  verbs: OpenApiPathItemObject;
  input: NormalizedInputOptions;
  output: NormalizedOutputOptions;
  route: string;
  pathRoute: string;
  context: ContextSpec;
}

export function generateVerbsOptions({
  verbs,
  input,
  output,
  route,
  pathRoute,
  context,
}: GenerateVerbsOptionsParams): Promise<GeneratorVerbsOptions> {
  const splitRequestBodyByContentType =
    shouldSplitRequestBodyByContentType(output);
  return asyncReduce(
    _filteredVerbs(verbs, input.filters),
    async (acc, [verb, operation]: [string, OpenApiOperationObject]) => {
      if (isVerb(verb)) {
        const requestBody = operation.requestBody;
        if (requestBody && splitRequestBodyByContentType) {
          const operationId = getOperationId(operation, route, verb);
          const overrideOperation = output.override.operations[operationId];
          const operationTags = normalizeTags(operation.tags);
          let overrideTag: NormalizedOperationOptions = {};

          for (const [tag, options] of Object.entries(output.override.tags)) {
            if (operationTags.includes(tag) && options) {
              overrideTag = mergeDeep(overrideTag, options);
            }
          }

          const override = mergeDeep(
            mergeDeep(output.override, overrideTag),
            overrideOperation ?? {},
          );

          const overrideOperationName =
            overrideOperation?.operationName ?? output.override.operationName;
          const baseOperationName = overrideOperationName
            ? overrideOperationName(operation, route, verb)
            : sanitize(camel(operationId), { es5keyword: true });

          const allBodyTypes = getResReqTypes(
            [
              [
                context.output.override.components.requestBodies.suffix,
                requestBody,
              ],
            ],
            baseOperationName,
            context,
            'unknown',
            (type) => `${type.contentType}:${type.value}`,
          );

          const filteredBodyTypes = override.contentType
            ? allBodyTypes.filter((type) => {
                let include = true;
                let exclude = false;

                if (override.contentType?.include) {
                  include = override.contentType.include.includes(
                    type.contentType,
                  );
                }

                if (override.contentType?.exclude) {
                  exclude = override.contentType.exclude.includes(
                    type.contentType,
                  );
                }

                return include && !exclude;
              })
            : [...allBodyTypes];

          const bodyContentTypes: string[] = [
            ...new Set(
              filteredBodyTypes.map((type) => type.contentType).filter(Boolean),
            ),
          ];

          if (bodyContentTypes.length > 1) {
            const verbOptions = await Promise.all(
              bodyContentTypes.map((contentType) =>
                generateVerbOptions({
                  verb,
                  output,
                  verbParameters: verbs.parameters,
                  route,
                  pathRoute,
                  operation,
                  context,
                  bodyContentType: contentType,
                }),
              ),
            );

            acc.push(...verbOptions);
            return acc;
          }

          const verbOptions = await generateVerbOptions({
            verb,
            output,
            verbParameters: verbs.parameters,
            route,
            pathRoute,
            operation,
            context,
          });

          acc.push(verbOptions);
          return acc;
        }

        const verbOptions = await generateVerbOptions({
          verb,
          output,
          verbParameters: verbs.parameters,
          route,
          pathRoute,
          operation,
          context,
        });

        acc.push(verbOptions);
      }

      return acc;
    },
    [] as GeneratorVerbsOptions,
  );
}

export function _filteredVerbs(
  verbs: OpenApiPathItemObject,
  filters: NormalizedInputOptions['filters'],
) {
  if (filters?.tags === undefined) {
    return Object.entries(verbs);
  }

  const filterTags = filters.tags;
  const filterMode = filters.mode ?? 'include';

  const entries = Object.entries(verbs) as Array<[string, unknown]>;

  return entries.filter(([, operation]) => {
    const operationTags = normalizeTags(
      typeof operation === 'object' && operation !== null
        ? (operation as { tags?: unknown }).tags
        : undefined,
    );

    const isMatch = operationTags.some((tag) =>
      filterTags.some((filterTag) =>
        filterTag instanceof RegExp ? filterTag.test(tag) : filterTag === tag,
      ),
    );

    return filterMode === 'exclude' ? !isMatch : isMatch;
  });
}
