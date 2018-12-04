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

import {JsonLdGraphItem, LD_COMMENT, LD_ID, LD_SUBCLASS_OF, LD_TYPES, ToArray} from './jsonld';

export function GetComments(
    item: JsonLdGraphItem, preferredLanguage: string): ReadonlyArray<string> {
  const comments = ToArray(item[LD_COMMENT]);

  return comments
      .map(c => {
        if (typeof c === 'string') return c;

        if (c['@language'] === preferredLanguage) {
          return c['@value'];
        }

        return undefined;
      })
      .filter((c): c is string => !!c);
}

export function GetSubClassOf(item: JsonLdGraphItem): ReadonlyArray<string> {
  return ToArray(item[LD_SUBCLASS_OF]).map(i => i[LD_ID]);
}

export function GetTypes(item: JsonLdGraphItem): ReadonlyArray<string> {
  // Some published schema includes local files, unbelievably. Simply skip
  // those.
  if (item[LD_ID].startsWith('file:')) return [];

  const types = item[LD_TYPES];
  if (Array.isArray(types)) {
    if (types.length === 0) {
      throw new Error(`Empty type found for item ${item[LD_ID]}`);
    }
    return types;
  }

  if (typeof types === 'string') {
    return [types];
  }

  throw new Error(`No type found for item ${item[LD_ID]}.`);
}

export function IsClassType(type: string): boolean {
  return type === 'rdfs:Class';
}
export function IsPropertyType(type: string): boolean {
  return type === 'rdf:Property';
}

export function IsDataType(type: string): boolean {
  return type === 'http://schema.org/DataType';
}

export function HasEnumType(types: ReadonlyArray<string>): boolean {
  for (const type of types) {
    // Skip well-known types.
    if (IsClassType(type) || IsPropertyType(type) || IsDataType(type)) continue;

    // If we're here, this is a 'Type' that is not well known.
    return true;
  }
  // Types are only well-known.
  return false;
}
