/**
 * Copyright 2018 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export interface JsonLdOntology extends JsonLdGraph {
  '@context': {'rdf': string; 'rdfs': string; 'xsd': string;};
}

export interface JsonLdGraph {
  '@id'?: string;
  '@graph': ReadonlyArray<JsonLdGraphMember>;
}

export type JsonLdGraphMember = JsonLdGraph|JsonLdGraphItem|JsonLdCloseMatch|
    JsonLdSourceOnly|JsonLdSoftwareVersionOnly|SchemaOrgMetaTestComment;

// Keys for JsonLdGraphItem:
export const LD_ID = '@id';
export const LD_TYPES = '@type';
export const LD_COMMENT = 'rdfs:comment';
export const LD_LABEL = 'rdfs:label';
export const LD_SUBCLASS_OF = 'rdfs:subClassOf';
export const LD_DOMAIN_INCLUDES = 'http://schema.org/domainIncludes';
export const LD_RANGE_INCLUDES = 'http://schema.org/rangeIncludes';

export interface JsonLdGraphItem {
  readonly '@id': string;
  readonly '@type': JsonLdItem<string>;

  // "Declaration" Properties: We'll consider a valid "Forward Declaration" to
  // be one htat includes these rdfs labels. If missing, they might be
  readonly 'rdfs:comment'?: JsonLdStringValue;
  readonly 'rdfs:label'?: JsonLdStringValue;

  // Class Properties:
  readonly 'rdfs:subClassOf'?: JsonLdItem<JsonLdObjectReference>;
  readonly 'http://www.w3.org/2002/07/owl#equivalentClass'?:
      JsonLdItem<JsonLdObjectReference>;

  // Property Properties:
  readonly 'http://schema.org/domainIncludes'?:
      JsonLdItem<JsonLdObjectReference>;
  readonly 'http://schema.org/rangeIncludes'?:
      JsonLdItem<JsonLdObjectReference>;
  readonly 'http://schema.org/inverseOf'?: JsonLdItem<JsonLdObjectReference>;
  readonly 'rdfs:subPropertyOf'?: JsonLdItem<JsonLdObjectReference>;
  readonly 'http://www.w3.org/2002/07/owl#equivalentProperty'?:
      JsonLdItem<JsonLdObjectReference>;

  // Currently Unused:
  readonly 'http://schema.org/supersededBy'?: JsonLdItem<JsonLdObjectReference>;
  readonly 'http://purl.org/dc/terms/source'?:
      JsonLdItem<JsonLdObjectReference>;
  readonly 'http://schema.org/category'?: JsonLdItem<JsonLdStringValue>;
  readonly 'http://schema.org/sameAs'?: JsonLdItem<JsonLdObjectReference>;
  /** For Graph Items within a Layer, describes what Layer it belongs to. */
  'http://schema.org/isPartOf'?: JsonLdItem<JsonLdObjectReference>;
}

export interface JsonLdObjectReference {
  readonly '@id': string;
}

export type JsonLdStringValue = string|{
  '@language': string;
  '@value': string;
};

export interface JsonLdCloseMatch {
  readonly '@id': string;
  readonly 'http://www.w3.org/2004/02/skos/core#closeMatch':
      JsonLdItem<JsonLdObjectReference>;
}
export function IsCloseMatch(item: JsonLdGraphMember):
    item is JsonLdCloseMatch {
  return 'http://www.w3.org/2004/02/skos/core#closeMatch' in item &&
      !(LD_TYPES in item);
}

export interface JsonLdSourceOnly {
  readonly '@id': string;
  readonly 'http://purl.org/dc/terms/source': JsonLdItem<JsonLdObjectReference>;
}
export function IsSourceOnly(item: JsonLdGraphMember):
    item is JsonLdSourceOnly {
  return 'http://purl.org/dc/terms/source' in item && !(LD_TYPES in item);
}

/** Appears in Bibliography schema layer. */
export interface JsonLdSoftwareVersionOnly {
  readonly '@id': string;
  readonly 'http://schema.org/softwareVersion': JsonLdStringValue;
}
export function IsSoftwareVersionOnly(item: JsonLdGraphMember):
    item is JsonLdSoftwareVersionOnly {
  return 'http://schema.org/softwareVersion' in item && !(LD_TYPES in item);
}

/**
 * meta.schema.org Subgraph includes a single test comment that doesn't
 * describe anything in particular and has no type.
 */
export interface SchemaOrgMetaTestComment {
  readonly '@id': 'http://meta.schema.org/';
  readonly 'rdfs:comment': 'A test comment.';
  readonly 'rdfs:label': 'meta';
}
export function IsTestComment(item: JsonLdGraphMember):
    item is SchemaOrgMetaTestComment {
  return item[LD_ID] === 'http://meta.schema.org/';
}

export type JsonLdItem<T> = T|ReadonlyArray<T>;

export function ToArray<T>(item: JsonLdItem<T>|undefined): ReadonlyArray<T> {
  if (!item) {
    return [];
  }
  if (Array.isArray(item)) {
    return item;
  }
  return [item as T];
}
