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
import {ArgumentParser} from 'argparse';
import {createPrinter, createSourceFile, EmitHint, NewLineKind, ScriptKind, ScriptTarget} from 'typescript';

import {IsCloseMatch, IsSoftwareVersionOnly, IsSourceOnly, IsTestComment, JsonLdGraphItem, JsonLdGraphMember, JsonLdItem, JsonLdObjectReference, LD_COMMENT, LD_DOMAIN_INCLUDES, LD_ID, LD_LABEL, LD_RANGE_INCLUDES, LD_SUBCLASS_OF, LD_TYPES, ToArray} from '../lib/jsonld';
import {IsVerbose, SetupOptions} from '../lib/settings';
import {EnumValue, FindProperties, ProcessClasses} from '../lib/toClass';
import {PropertyType} from '../lib/toProperty';
import {GetTypes, HasEnumType} from '../lib/wellKnown';

import {load} from './reader';

interface Options {
  verbose: boolean;
  schema: string;
  layer: string;
  lang: string;
}
function ParseFlags(): Options|undefined {
  const parser = new ArgumentParser(
      {version: '0.0.1', addHelp: true, description: 'schema-dts generator'});
  parser.addArgument('--verbose', {defaultValue: false});
  parser.addArgument(
      '--schema',
      {defaultValue: '3.4', help: 'The version of the schema to load.'});
  parser.addArgument('--layer', {
    defaultValue: 'schema',
    help: 'Which layer of the schema to load? E.g. schema or all-layers.'
  });
  parser.addArgument('--lang', {
    defaultValue: 'en',
    help: 'Which language to default to when looking up' +
        ' strings with the "@language" property? Ignores all other strings.'
  });
  return parser.parseArgs();
}

type Mutable<T> = T extends object ? {
  -readonly[K in keyof T]: T[K];
} : T;

function combineString(
    first: JsonLdItem<string>|undefined,
    second: JsonLdItem<string>|undefined): ReadonlyArray<string> {
  return Array.from(new Set([...ToArray(first), ...ToArray(second)]).values());
}
function combineRef(
    first: JsonLdItem<JsonLdObjectReference>|undefined,
    second: JsonLdItem<JsonLdObjectReference>|
    undefined): ReadonlyArray<JsonLdObjectReference> {
  return Array
      .from(new Set([...ToArray(first), ...ToArray(second)].map(o => o[LD_ID]))
                .values())
      .map(id => ({[LD_ID]: id}));
}

function group(
    members: ReadonlyArray<JsonLdGraphMember>,
    map: Map<string, JsonLdGraphItem>) {
  for (const member of members) {
    if ('@graph' in member) {
      group(member['@graph'], map);
      continue;
    }

    if (IsSourceOnly(member) || IsSoftwareVersionOnly(member) ||
        IsCloseMatch(member)) {
      continue;  // We don't typically care about these.
    }
    if (IsTestComment(member)) {
      continue;  // We never care about this.
    }

    const alreadyExists = map.get(member[LD_ID]);
    if (alreadyExists) {
      const merge = alreadyExists as Mutable<JsonLdGraphItem>;
      if (IsVerbose()) {
        console.error(`Merging two items with ID ${member[LD_ID]}`);
      }
      if (member[LD_COMMENT]) {
        if (alreadyExists[LD_COMMENT]) {
          console.error(`Two comments found for ${member[LD_ID]}`);
        }
        merge[LD_COMMENT] = member[LD_COMMENT];
      }
      if (member[LD_LABEL]) {
        if (alreadyExists[LD_COMMENT]) {
          console.error(`Two comments found for ${member[LD_ID]}`);
        }
        merge[LD_LABEL] = member[LD_LABEL];
      }
      if (member[LD_DOMAIN_INCLUDES]) {
        merge[LD_DOMAIN_INCLUDES] =
            combineRef(merge[LD_DOMAIN_INCLUDES], member[LD_DOMAIN_INCLUDES]);
      }
      if (member[LD_RANGE_INCLUDES]) {
        merge[LD_RANGE_INCLUDES] =
            combineRef(merge[LD_RANGE_INCLUDES], member[LD_RANGE_INCLUDES]);
      }
      if (member[LD_SUBCLASS_OF]) {
        merge[LD_SUBCLASS_OF] =
            combineRef(merge[LD_SUBCLASS_OF], member[LD_SUBCLASS_OF]);
      }
      if (member[LD_TYPES]) {
        merge[LD_TYPES] = combineString(merge[LD_TYPES], member[LD_TYPES]);
      }
    } else {
      map.set(member[LD_ID], member);
    }
  }
}

async function main() {
  const options = ParseFlags();
  if (!options) return;
  SetupOptions(options);

  const result = load(options.schema, options.layer);
  const ontology = await result.toPromise();

  const byId = new Map<string, JsonLdGraphItem>();
  group(ontology['@graph'], byId);

  const items = Array.from(byId.values());


  const classes = ProcessClasses(items);
  const props = FindProperties(items);

  for (const prop of props) {
    const property = new PropertyType(prop);
    property.init(classes);
  }

  // Process Enums
  for (const item of items) {
    if (!HasEnumType(GetTypes(item))) continue;

    // Everything Here should be an enum.
    const enumValue = new EnumValue(item);
    enumValue.init(classes);
  }

  write('// tslint:disable\n\n');
  const source = createSourceFile(
      'result.ts', '', ScriptTarget.ES2015, /*setParentNodes=*/false,
      ScriptKind.TS);
  const printer = createPrinter({newLine: NewLineKind.LineFeed});

  for (const cls of classes.entries()) {
    for (const node of cls[1].toNode()) {
      const result = printer.printNode(EmitHint.Unspecified, node, source);
      write(result);
      write('\n');
    }
    write('\n');
  }
}

function write(content: string) {
  process.stdout.write(content, 'utf-8');
}

main()
    .then(() => {
      process.exit();
    })
    .catch(e => {
      console.error(e);
      process.abort();
    });
