import {isMap, parseDocument} from 'yaml';

type PairLike = {
  comment?: string;
  commentBefore?: string;
  key: NodeLike;
  value: unknown;
};

type MapLike = {
  delete: (key: string) => boolean;
  items: PairLike[];
  set: (key: string, value: unknown) => void;
};

type RewriteResult = {
  nextContent: string;
};

type NodeLike = {
  comment?: string;
  commentBefore?: string;
  value?: unknown;
} | null;

function asMapLike(value: unknown): MapLike | undefined {
  return isMap(value) ? (value as MapLike) : undefined;
}

function getNodeStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    'value' in value &&
    typeof (value as {value?: unknown}).value === 'string'
  ) {
    return (value as {value: string}).value;
  }

  return undefined;
}

function getPair(map: MapLike, key: string): PairLike | undefined {
  return map.items.find((pair) => getNodeStringValue(pair.key) === key);
}

function mergeLeadingComment(
  existingComment: string | undefined,
  incomingComment: string | undefined,
): string | undefined {
  if (!incomingComment) {
    return existingComment;
  }

  return existingComment
    ? `${incomingComment}\n${existingComment}`
    : incomingComment;
}

function deletePairPreservingComments(map: MapLike, key: string): boolean {
  const pairIndex = map.items.findIndex(
    (pair) => getNodeStringValue(pair.key) === key,
  );

  if (pairIndex === -1) {
    return false;
  }

  const [removedPair] = map.items.splice(pairIndex, 1);
  const nextPair = map.items[pairIndex];
  const mergedLeadingComment = mergeLeadingComment(
    removedPair?.commentBefore,
    removedPair?.key?.commentBefore,
  );

  if (nextPair && mergedLeadingComment) {
    if (nextPair.key) {
      const nextKeyComment = mergeLeadingComment(
        nextPair.key.commentBefore,
        mergedLeadingComment,
      );

      if (nextKeyComment) {
        nextPair.key.commentBefore = nextKeyComment;
      }
    } else {
      const nextPairComment = mergeLeadingComment(
        nextPair.commentBefore,
        mergedLeadingComment,
      );

      if (nextPairComment) {
        nextPair.commentBefore = nextPairComment;
      }
    }
  }

  return true;
}

function resolveObjectSection(root: MapLike, domain: string): MapLike {
  const domainPair = getPair(root, domain);
  const section = domainPair ? asMapLike(domainPair.value) : undefined;
  return section ?? root;
}

function parseYamlDocument(rawContent: string) {
  const document = parseDocument(rawContent, {
    prettyErrors: true,
    strict: false,
  });

  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join('; '));
  }

  return document;
}

export function renameConfigNamedObject(input: {
  content: string;
  domain: string;
  nextName: string;
  objectKey: string;
}): RewriteResult {
  const document = parseYamlDocument(input.content);
  const root = asMapLike(document.contents);

  if (!root) {
    throw new Error('Config source is not a YAML mapping.');
  }

  const section = resolveObjectSection(root, input.domain);
  const objectPair = getPair(section, input.objectKey);
  const objectMap = objectPair ? asMapLike(objectPair.value) : undefined;

  if (!objectMap) {
    throw new Error(
      `Could not find YAML object "${input.objectKey}" in the ${input.domain} section.`,
    );
  }

  objectMap.set('name', input.nextName);

  return {
    nextContent: document.toString(),
  };
}

export function removeConfigNamedObject(input: {
  content: string;
  domain: string;
  objectKey: string;
}): RewriteResult {
  const document = parseYamlDocument(input.content);
  const root = asMapLike(document.contents);

  if (!root) {
    throw new Error('Config source is not a YAML mapping.');
  }

  const section = resolveObjectSection(root, input.domain);

  if (!deletePairPreservingComments(section, input.objectKey)) {
    throw new Error(
      `Could not find YAML object "${input.objectKey}" in the ${input.domain} section.`,
    );
  }

  return {
    nextContent: document.toString(),
  };
}
